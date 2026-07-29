import { getChatGPTUser } from "../../../chatgpt-auth";
import { parseOfferText } from "../../../../db/offer-parser";

export const dynamic = "force-dynamic";

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
const STOP_WORDS = new Set("avec pour dans une des les aux sur par vous votre nous notre cette comme plus sont être avoir poste entreprise expérience travail recherche niveau afin ainsi chez depuis sous entre selon sans très aux du de et ou en le la un une au ce se qui que est".split(" "));

async function adaptWithQwen(offer: string, cv: string) {
  const base = String(process.env.AI_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return null;
  const model = String(process.env.AI_MODEL ?? "Qwen/Qwen3-8B").trim();
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const response = await fetch(`${base}/v1/chat/completions`, { method:"POST", headers:{"content-type":"application/json", ...(apiKey?{authorization:`Bearer ${apiKey}`}:{})}, body:JSON.stringify({ model, temperature:0.15, max_tokens:3000, messages:[{role:"system",content:"Tu es un assistant de recrutement. Réorganise un CV pour les ATS en français. Utilise exclusivement les faits présents dans le CV : n’invente jamais de poste, diplôme, compétence, date ou résultat. Retourne uniquement le CV final en texte brut, avec les sections PROFIL CIBLE, COMPÉTENCES, EXPÉRIENCE, FORMATION et AUTRES INFORMATIONS."},{role:"user",content:`OFFRE D'EMPLOI:\n${offer}\n\nCV À RESTRUCTURER:\n${cv}`} ]}) });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as {choices?:Array<{message?:{content?:string}}>};
  const content = String(data.choices?.[0]?.message?.content ?? "").replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return content.length >= 80 ? content : null;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
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
  const lines = cv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.slice(0, Math.min(4, lines.length));
  const bodyLines = lines.slice(header.length);
  const ranked = bodyLines.map((line, index) => ({ line, index, score: keywords.reduce((total, keyword) => total + (normalize(line).includes(keyword) ? 1 : 0), 0) }));
  const relevant = ranked.filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.index - right.index).map((item) => item.line);
  const remaining = ranked.filter((item) => item.score === 0).map((item) => item.line);
  const target = String(parsed.role ?? "").trim();
  const adapted = [
    ...header,
    "",
    "PROFIL CIBLE",
    target ? `Candidature ciblée : ${target}` : "Candidature ciblée selon les mots-clés de l'offre",
    "",
    "COMPETENCES CLES PRESENTES DANS LE CV",
    (matchedSkills.length ? matchedSkills : matchedKeywords.slice(0, 18)).join(" · ") || "Aucune compétence commune détectée — vérifiez le contenu du CV",
    "",
    "EXPERIENCE ET ELEMENTS PERTINENTS",
    ...(relevant.length ? relevant : ["Aucun élément correspondant automatiquement — vérifiez vos expériences."]),
    "",
    "AUTRES ELEMENTS DU CV",
    ...remaining,
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return Response.json({ ok: true, adaptedCv: modelAdapted ?? adapted, matchedSkills, matchedKeywords, targetRole: target, provider: modelAdapted ? "Qwen3-8B" : "moteur local", note: "Le contenu est réorganisé et priorisé à partir de votre CV. Vérifiez chaque formulation avant envoi : Fala AI n'invente aucune expérience." });
}
