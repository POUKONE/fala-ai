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

export interface ResumeATS {
  header:{fullName:string;targetTitle:string;email:string;phone:string;location:string;linkedinUrl?:string;mobility?:string};
  summary:string;
  skills:{category:string;items:string[]}[];
  experiences:{jobTitle:string;company:string;location:string;startDate:string;endDate:string;bulletPoints:string[]}[];
  education:{degree:string;institution:string;location:string;startYear:string;endYear:string}[];
  languages?:{language:string;proficiency:string}[];
  projects?:{title:string;description:string;technologies:string[]}[];
};

function formatStructuredAdaptation(result:ResumeATS) {
  const header=result.header; const contact=[header.email,header.phone,header.location,header.linkedinUrl,header.mobility].filter(Boolean).join(" | ");
  const lines=[header.fullName,header.targetTitle,contact,"","PROFIL",result.summary.trim(),""];
  if(result.skills.length) lines.push("COMPÉTENCES",...result.skills.flatMap((group)=>[`${group.category}:`,...group.items.map((item)=>`• ${item}`),""]));
  if(result.experiences.length) lines.push("EXPÉRIENCE",...result.experiences.flatMap((experience)=>[`${experience.jobTitle} | ${experience.company} | ${experience.location} | ${experience.startDate} - ${experience.endDate}`,...experience.bulletPoints.map((item)=>`• ${item}`),""]));
  if(result.education.length) lines.push("FORMATION",...result.education.map((item)=>`${item.degree} | ${item.institution} | ${item.location} | ${item.startYear} - ${item.endYear}`),"");
  if(result.languages?.length) lines.push("LANGUES",...result.languages.map((item)=>`${item.language}: ${item.proficiency}`),"");
  if(result.projects?.length) lines.push("PROJETS",...result.projects.flatMap((item)=>[item.title,item.description,`Technologies: ${item.technologies.join(", ")}`,""]));
  return lines.join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

function parseResumeATS(value:unknown):ResumeATS|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const item=value as Record<string,unknown>; const header=item.header as Record<string,unknown>;
  const text=(entry:unknown)=>typeof entry==="string"?entry.trim():"";
  const strings=(entry:unknown)=>Array.isArray(entry)&&entry.every((value)=>typeof value==="string")?(entry as string[]).map((value)=>value.trim()).filter(Boolean):null;
  if(!header||typeof header!=="object"||Array.isArray(header)||!text(header.fullName)||!text(header.targetTitle)||!text(item.summary))return null;
  if(!Array.isArray(item.skills)||!Array.isArray(item.experiences)||!Array.isArray(item.education))return null;
  const skills=item.skills.map((entry)=>{const group=entry as Record<string,unknown>;const items=strings(group.items);return items&&text(group.category)?{category:text(group.category),items}:null;}).filter(Boolean) as ResumeATS["skills"];
  const experiences=item.experiences.map((entry)=>{const value=entry as Record<string,unknown>;const bulletPoints=strings(value.bulletPoints);return bulletPoints?{jobTitle:text(value.jobTitle),company:text(value.company),location:text(value.location),startDate:text(value.startDate),endDate:text(value.endDate),bulletPoints}:null;}).filter(Boolean) as ResumeATS["experiences"];
  const education=item.education.map((entry)=>{const value=entry as Record<string,unknown>;return {degree:text(value.degree),institution:text(value.institution),location:text(value.location),startYear:text(value.startYear),endYear:text(value.endYear)};});
  const languages=Array.isArray(item.languages)?item.languages.map((entry)=>{const value=entry as Record<string,unknown>;return {language:text(value.language),proficiency:text(value.proficiency)};}).filter((value)=>value.language):undefined;
  const projects=Array.isArray(item.projects)?item.projects.map((entry)=>{const value=entry as Record<string,unknown>;return {title:text(value.title),description:text(value.description),technologies:strings(value.technologies)??[]};}).filter((value)=>value.title||value.description):undefined;
  return {header:{fullName:text(header.fullName),targetTitle:text(header.targetTitle),email:text(header.email),phone:text(header.phone),location:text(header.location),linkedinUrl:text(header.linkedinUrl)||undefined,mobility:text(header.mobility)||undefined},summary:text(item.summary),skills,experiences,education,languages,projects};
}

async function adaptWithQwen(offer: string, cv: string): Promise<{ text: string; structured: ResumeATS } | null> {
  const base = String(process.env.AI_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return null;
  const model = String(process.env.AI_MODEL ?? "Qwen/Qwen3-8B").trim();
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const endpoint = `${base}${base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response:Response;
  const systemPrompt = `Tu es une API de parsing de CV ultra-rigoureuse, experte en recrutement Tech/Data et en architectures ATS (Applicant Tracking Systems).

OBJECTIF : convertir le texte brut d'un CV, éventuellement bruité par un OCR ou une extraction PDF/DOCX, en un objet JSON ResumeATS propre, hiérarchisé et fidèle aux seules données source.

ALGORITHME DE NETTOYAGE (À APPLIQUER À TOUT LE TEXTE) :
1. Corrige les entités HTML et les mauvaises conversions UTF-8 lorsque le contexte permet de retrouver le caractère original (par exemple dâ experience → d'expérience, â€ → -, &amp; → &).
2. Supprime les puces décoratives/exotiques (emoji, •, ▪, ✈, ➢, espaces insécables), déduplique les espaces et répare les retours à la ligne au milieu d'une phrase.
3. Si une suite de technologies est artificiellement collée à une phrase d'expérience, retire cette pollution de la puce et place les compétences uniquement dans skills lorsqu'elles sont réellement présentes dans le CV.
4. Trie expériences et formations en ordre chronologique inverse. Vérifie les dates et corrige seulement leur ordre (par exemple 2024-2022 devient 2022-2024), sans inventer de date.

RÈGLES DE MAPPING :
- header : extrais uniquement le nom, le titre visé, l'email, le téléphone, la localisation et les liens réellement présents. Utilise linkedinUrl pour LinkedIn et mobility si elle est explicitement fournie.
- summary : place uniquement l'accroche globale ici, jamais dans une expérience. Si elle manque, retourne une chaîne vide.
- experiences : conserve les intitulés et entreprises exacts, sépare la localisation, utilise MM/YYYY, YYYY ou Présent, et formule des puces Action + contexte + résultat. N'ajoute une métrique que si elle apparaît dans le CV.
- skills : regroupe les compétences techniques, méthodologies et outils en catégories cohérentes (Data & AI, Cloud & DevOps, Langages, Frameworks Web, etc.).
- education : conserve les diplômes, établissements, lieux et années réellement présents.

RÈGLE ABSOLUE ANTI-HALLUCINATION : n'invente aucune donnée (nom, date, compétence, responsabilité, entreprise, diplôme ou résultat). Ne duplique aucun mot-clé sans lien avec le contenu source.

FORMAT DE SORTIE STRICT : retourne uniquement un objet JSON valide conforme à ResumeATS, avec les clés header, summary, skills, experiences, education, languages et projects. Les champs obligatoires doivent toujours exister ; pour une donnée absente, utilise une chaîne vide ou un tableau vide. Aucun texte explicatif et aucun bloc Markdown.`;
  try {
    response = await fetch(endpoint, { signal:controller.signal, method:"POST", headers:{"content-type":"application/json", ...(apiKey?{authorization:`Bearer ${apiKey}`}:{})}, body:JSON.stringify({ model, temperature:0.1, max_tokens:3000, response_format:{type:"json_object"}, messages:[{role:"system",content:systemPrompt},{role:"user",content:`### OFFRE D'EMPLOI ###\n${offer}\n\n### CV À OPTIMISER ###\n${cv}\n\nRetourne uniquement un objet JSON conforme au modèle ResumeATS avec les clés header, summary, skills, experiences, education, languages et projects.`}]}) });
  } finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as {choices?:Array<{message?:{content?:string}}>};
  const raw = String(data.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let structured: ResumeATS|null;
  try { structured = parseResumeATS(JSON.parse(raw)); } catch { return null; }
  if(!structured) return null;
  const content = formatStructuredAdaptation(structured);
  const normalized=normalize(content);
  const headings=["experience","formation","competences","profil"].filter((heading)=>normalized.includes(heading));
  const containsTemplateText=/resumez vos|utilisez la langue|soyez concis|exemple de cv|a completer|placeholder|je ne peux/i.test(normalized);
  // A model can return the input unchanged while still satisfying the basic
  // heading checks. Treat that as a failed adaptation and use the deterministic
  // fallback instead of presenting a false positive to the user.
  const unchanged = compact(content) === compact(cv) || (compact(content).length > 0 && compact(cv).includes(compact(content)) && compact(content).length / compact(cv).length > 0.96);
  return content.length >= 120 && headings.length >= 2 && !containsTemplateText && !unchanged ? {text:content, structured} : null;
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
    const adaptedCv = modelAdapted?.text ?? adapted;
    await recordActivity(user, "cv.adapted", `CV adapté pour ${target || "une offre"} (${provider})`);
    return Response.json({ ok: true, adaptedCv, structured: modelAdapted?.structured ?? null, matchedSkills, matchedKeywords, targetRole: target, provider, quality: qualityReport(cv, adaptedCv, matchedKeywords), note: "Le contenu est réorganisé et priorisé à partir de votre CV. Vérifiez chaque formulation avant envoi : Fala AI n'invente aucune expérience." });
  } catch (error) {
    try { await logSystemError("/api/cv/adapt", error, user.email); } catch { /* journalisation best-effort */ }
    return Response.json({ error: "Adaptation du CV momentanément indisponible" }, { status: 500 });
  }
}
