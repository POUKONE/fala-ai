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
function toCsv(account: unknown, profile: unknown, applications: unknown[], activity: unknown[], reports: unknown[]) {
  const columns = ["section", "id", "email", "nom", "entreprise", "poste", "localisation", "statut", "score", "source", "competences_demandees", "experience_requise", "formation_requise", "langues", "secteur", "salaire_min", "date_candidature", "prochaine_action", "entretien", "type_evenement", "description", "categorie", "message", "statut_signalement", "note_admin", "date_creation", "date_mise_a_jour", "donnees_completes"];
  const rows: string[][] = [];
  const add = (section: string, record: unknown, values: Record<string, unknown> = {}) => {
    const get = (key: string) => values[key] ?? recordValue(record, key);
    rows.push([section, get("id"), get("email"), get("display_name") ?? get("nom"), get("company"), get("role"), get("location"), get("status"), get("score"), get("source"), get("required_skills"), get("experience_required"), get("education_required"), get("languages"), get("sector"), get("salary_min"), get("applied_at"), get("next_action_at"), get("interview_at"), get("event_type"), get("description"), get("category"), get("message"), get("report_status"), get("admin_note"), get("created_at"), get("updated_at"), record].map(csvCell));
  };
  add("compte", account);
  if (profile) add("profil", profile, { email: recordValue(profile, "user_email") });
  applications.forEach((record) => add("candidature", record, { email: recordValue(record, "user_email") }));
  activity.forEach((record) => add("activite", record, { email: recordValue(record, "user_email") }));
  reports.forEach((record) => add("signalement", record, { email: recordValue(record, "user_email"), report_status: recordValue(record, "status") }));
  return `\uFEFF${[columns, ...rows].map((row) => row.join(",")).join("\r\n")}\r\n`;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Authentification requise"},{status:401});
  if (!await enforceRateLimit(user.email,"data-export",3,3600)) return Response.json({error:"Un export est déjà disponible. Réessayez plus tard."},{status:429});
  const db = getPostgresDb();
  const [account,profile,applications,activity,reports] = await Promise.all([
    db.prepare("SELECT email,display_name,created_at,last_seen_at,consent_version,consented_at FROM users WHERE email=?").bind(user.email).first(),
    db.prepare("SELECT * FROM profiles WHERE user_email=?").bind(user.email).first(),
    db.prepare("SELECT * FROM applications WHERE user_email=? ORDER BY id").bind(user.email).all(),
    db.prepare("SELECT event_type,description,created_at FROM activity_events WHERE user_email=? ORDER BY id").bind(user.email).all(),
    db.prepare("SELECT category,message,status,admin_note,created_at,updated_at FROM reports WHERE user_email=? ORDER BY id").bind(user.email).all(),
  ]);
  await recordActivity(user,"privacy.export","Export des données personnelles généré");
  const content = toCsv(account, profile, applications.results, activity.results, reports.results);
  return new Response(content,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="fala-ai-export-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
}
