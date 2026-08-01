import { getChatGPTUser } from "../../../chatgpt-auth";
import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

const csvCell = (value: unknown) => {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
};
const recordValue = (record: unknown, key: string) => record && typeof record === "object" ? (record as Record<string, unknown>)[key] : "";
function toCsv(applications: unknown[]) {
  const columns = ["id", "entreprise", "poste", "localisation", "statut", "score", "source", "competences_demandees", "experience_requise", "formation_requise", "langues", "secteur", "salaire_min", "date_candidature", "prochaine_action", "entretien", "notes", "date_creation", "date_mise_a_jour", "donnees_completes"];
  const rows: string[][] = [];
  applications.forEach((record) => {
    const get = (key: string) => recordValue(record, key);
    rows.push([get("id"), get("company"), get("role"), get("location"), get("status"), get("score"), get("source"), get("required_skills"), get("experience_required"), get("education_required"), get("languages"), get("sector"), get("salary_min"), get("applied_at"), get("next_action_at"), get("interview_at"), get("notes"), get("created_at"), get("updated_at"), record].map(csvCell));
  });
  return `\uFEFF${[columns, ...rows].map((row) => row.join(",")).join("\r\n")}\r\n`;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Authentification requise"},{status:401});
  if (!await enforceRateLimit(user.email,"data-export",3,3600)) return Response.json({error:"Un export est déjà disponible. Réessayez plus tard."},{status:429});
  const db = getPostgresDb();
  const applications = await db.prepare("SELECT id,company,role,location,status,score,source,required_skills,experience_required,education_required,languages,sector,salary_min,applied_at,next_action_at,interview_at,notes,created_at,updated_at FROM applications WHERE user_email=? ORDER BY id").bind(user.email).all();
  await recordActivity(user,"privacy.export","Export des données personnelles généré");
  const content = toCsv(applications.results);
  return new Response(content,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="fala-ai-export-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
}
