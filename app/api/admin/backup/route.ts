import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { enforceRateLimit, hasAdminAccess } from "../../../../db/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getChatGPTUser();
  if (!admin || !await hasAdminAccess(admin.email)) return Response.json({ error: "Accès administrateur requis" }, { status: 403 });
  if (!await enforceRateLimit(admin.email, "admin-backup", 2, 86400)) return Response.json({ error: "Limite de sauvegardes atteinte" }, { status: 429 });
  const db = getD1();
  const [users, profiles, applications, activity, reports, roles] = await Promise.all([
    db.prepare("SELECT email,display_name,created_at,last_seen_at,consent_version,consented_at,suspended_at,suspension_reason FROM users").all(),
    db.prepare("SELECT * FROM profiles").all(),
    db.prepare("SELECT * FROM applications").all(),
    db.prepare("SELECT * FROM activity_events").all(),
    db.prepare("SELECT * FROM reports").all(),
    db.prepare("SELECT * FROM user_roles").all(),
  ]);
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), users: users.results, profiles: profiles.results, applications: applications.results, activity: activity.results, reports: reports.results, roles: roles.results }, null, 2);
  return new Response(payload, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="fala-ai-backup-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
}
