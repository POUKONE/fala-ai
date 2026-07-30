import { getChatGPTUser } from "../../../chatgpt-auth";
import { parseOfferText } from "../../../../db/offer-parser";
import { enforceRateLimit, getAccountState, logSystemError } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function compact(value: string) { return normalize(value).replace(/[^a-z0-9]+/g, ""); }
function qualityReport(source: string, output: string, matchedKeywords: string[]) {
  const normalized = normalize(output);
  const sections = ["experience", "formation", "competences", "profil"].filter((section) => normalized.includes(section));
  const coverage = matchedKeywords.length ? Math.round(matchedKeywords.filter((keyword) => compact(output).includes(compact(keyword))).length / matchedKeywords.length * 100) : 0;
  const warnings: string[] = [];
  if (compact(source) === compact(output)) warnings.push("Le contenu ressemble au CV source : vérifiez la restructuration.");
  if (output.length < Math.max(120, Math.round(source.length * 0.35))) warnings.push("Le résultat est nettement plus court que le CV source.");
  if (sections.length < 2) warnings.push("Moins de deux sections ATS standard ont été détectées.");
  return { sourceCharacters: source.length, resultCharacters: output.length, sections, keywordCoverage: coverage, warnings };
}
const STOP_WORDS = new Set("avec pour dans une des les aux sur par vous votre nous notre cette comme plus sont être avoir poste entreprise expérience travail recherche niveau afin ainsi chez depuis sous entre selon sans très aux du de et ou en le la un une au ce se qui que est".split(" "));
const SECTION_ALIASES = [
  {name:"EXPÉRIENCE", test:/^(exp[eé]rience|exp[eé]riences|parcours professionnel|emploi|professional experience)/i},
  {name:"FORMATION", test:/^(formation|formations|education|[eé]tudes|dipl[oô]mes?)/i},
  {name:"COMPÉTENCES", test:/^(comp[eé]tences?|skills|savoir[- ]faire|expertise)/i},
  {name:"PROFIL", test:/^(profil|r[eé]sum[eé]|objectif|summary|about)/i},
];
function canonicalSection(line:string) { return SECTION_ALIASES.find((section)=>section.test.test(line))?.name ?? null; }
function usefulCvLine(line:string) { return line.length>1 && !/r[eé]sumez vos responsabilit[eé]s|utilisez la langue|soyez concis|exemple de cv|votre nom|[x]{3,}/i.test(normalize(line)); }
function buildLocalAdaptation(cv:string,target:string,matchedSkills:string[]) {
  const lines=cv.split(/\r?\n/).map((line)=>line.trim()).filter(usefulCvLine);
  const firstHeading=lines.findIndex((line)=>Boolean(canonicalSection(line)));
  const header=lines.slice(0,firstHeading<0?Math.min(3,lines.length):firstHeading).slice(0,3);
  const sections=new Map<string,string[]>(); let current="EXPÉRIENCE";
  for(const line of lines.slice(header.length)) { const next=canonicalSection(line); if(next){current=next; if(!sections.has(current)) sections.set(current,[]); continue;} sections.set(current,[...(sections.get(current)??[]),line]); }
  const output=[...header,"",...(target?["PROFIL CIBLE",target,""]:[])];
  for(const section of ["EXPÉRIENCE","FORMATION","COMPÉTENCES","PROFIL"]) { const items=sections.get(section)??[]; if(!items.length && section!=="COMPÉTENCES") continue; output.push(section); if(section==="COMPÉTENCES"){ const skills=[...new Set([...items,...matchedSkills])]; output.push(...(skills.length?skills:["Compétences présentes dans le CV à vérifier"])); } else output.push(...items); output.push(""); }
  return output.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

async function adaptWithQwen(offer: string, cv: string) {
  const base = String(process.env.AI_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return null;
  const model = String(process.env.AI_MODEL ?? "Qwen/Qwen3-8B").trim();
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const endpoint = `${base}${base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response:Response;
  try {
    response = await fetch(endpoint, { signal:controller.signal, method:"POST", headers:{"content-type":"application/json", ...(apiKey?{authorization:`Bearer ${apiKey}`}:{})}, body:JSON.stringify({ model, temperature:0.15, max_tokens:3000, messages:[{role:"system",content:"Tu es un assistant de recrutement. Réorganise un CV pour les ATS en français et respecte ce modèle A4 sobre : première ligne NOM, deuxième ligne TITRE CIBLE, troisième ligne CONTACT ; ensuite les sections EXPÉRIENCE, FORMATION et COMPÉTENCES. Utilise exclusivement les faits présents dans le CV : n’invente jamais de poste, diplôme, compétence, date ou résultat. Retourne uniquement le CV final en texte brut. Pour une information absente, omets-la plutôt que de la remplacer par un exemple."},{role:"user",content:`OFFRE D'EMPLOI:\n${offer}\n\nCV À RESTRUCTURER:\n${cv}`} ]}) });
  } finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as {choices?:Array<{message?:{content?:string}}>};
  const content = String(data.choices?.[0]?.message?.content ?? "").replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const normalized=normalize(content);
  const headings=["experience","formation","competences","profil"].filter((heading)=>normalized.includes(heading));
  const containsTemplateText=/resumez vos|utilisez la langue|soyez concis|exemple de cv|a completer|placeholder|je ne peux/i.test(normalized);
  // A model can return the input unchanged while still satisfying the basic
  // heading checks. Treat that as a failed adaptation and use the deterministic
  // fallback instead of presenting a false positive to the user.
  const unchanged = compact(content) === compact(cv) || (compact(content).length > 0 && compact(cv).includes(compact(content)) && compact(content).length / compact(cv).length > 0.96);
  return content.length >= 120 && headings.length >= 2 && !containsTemplateText && !unchanged ? content : null;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({ error: "Compte suspendu" }, { status: 403 });
  if (!await enforceRateLimit(user.email, "cv-adapt", 8, 3600)) return Response.json({ error: "Limite d’adaptations atteinte pour cette heure" }, { status: 429 });
  try {
    const body = await request.json().catch(() => ({})) as { offer?: string; cv?: string };
    const offer = String(body.offer ?? "").trim().slice(0, 30000);
    const cv = String(body.cv ?? "").trim().slice(0, 50000);
    if (offer.length < 40 || cv.length < 80) return Response.json({ error: "Saisissez une annonce et un CV suffisamment détaillés." }, { status: 400 });
    let modelAdapted = null;
    try { modelAdapted = await adaptWithQwen(offer, cv); } catch { modelAdapted = null; }
    let parsed;
    try { parsed = parseOfferText(offer); } catch { parsed = { role: "", requiredSkills: "" }; }
    const cvNormalized = normalize(cv);
    const requested = String(parsed.requiredSkills ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const offerTerms = normalize(offer).split(/[^a-z0-9+#.]+/).filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
    const keywords = [...new Set([...requested.map(normalize), ...offerTerms])].slice(0, 80);
    const matchedKeywords = keywords.filter((keyword) => cvNormalized.includes(keyword));
    const matchedSkills = requested.filter((skill) => cvNormalized.includes(normalize(skill)));
    const target = String(parsed.role ?? "").trim();
    const adapted = buildLocalAdaptation(cv,target,matchedSkills);
    const provider = modelAdapted ? "Qwen3-8B" : "moteur local";
    const adaptedCv = modelAdapted ?? adapted;
    await recordActivity(user, "cv.adapted", `CV adapté pour ${target || "une offre"} (${provider})`);
    return Response.json({ ok: true, adaptedCv, matchedSkills, matchedKeywords, targetRole: target, provider, quality: qualityReport(cv, adaptedCv, matchedKeywords), note: "Le contenu est réorganisé et priorisé à partir de votre CV. Vérifiez chaque formulation avant envoi : Fala AI n'invente aucune expérience." });
  } catch (error) {
    try { await logSystemError("/api/cv/adapt", error, user.email); } catch { /* journalisation best-effort */ }
    return Response.json({ error: "Adaptation du CV momentanément indisponible" }, { status: 500 });
  }
}
