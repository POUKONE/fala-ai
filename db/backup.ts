import { getPostgresDb } from "./postgres";

type BackupPayload = { exportedAt: string; users: unknown[]; profiles: unknown[]; applications: unknown[]; activity: unknown[]; reports: unknown[]; roles: unknown[] };

/** Stores a daily JSON snapshot in a private Supabase Storage bucket. */
export async function createDailyBackup() {
  const base = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  if (!base || !key) return { stored: false, reason: "Supabase Storage non configuré" };

  const db = getPostgresDb();
  const [users, profiles, applications, activity, reports, roles] = await Promise.all([
    db.prepare("SELECT email,display_name,created_at,last_seen_at,consent_version,consented_at,suspended_at,suspension_reason FROM users").all(),
    db.prepare("SELECT * FROM profiles").all(),
    db.prepare("SELECT * FROM applications").all(),
    db.prepare("SELECT * FROM activity_events").all(),
    db.prepare("SELECT * FROM reports").all(),
    db.prepare("SELECT * FROM user_roles").all(),
  ]);
  const payload: BackupPayload = { exportedAt: new Date().toISOString(), users: users.results, profiles: profiles.results, applications: applications.results, activity: activity.results, reports: reports.results, roles: roles.results };
  const bucket = "fala-backups";
  await fetch(`${base}/storage/v1/bucket`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ id: bucket, name: bucket, public: false }) });
  const date = new Date().toISOString().slice(0, 10);
  const objectKey = `daily/fala-ai-${date}.json`;
  const upload = await fetch(`${base}/storage/v1/object/${bucket}/${objectKey}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", "x-upsert": "true" }, body: JSON.stringify(payload) });
  if (!upload.ok) throw new Error(`Échec de la sauvegarde Supabase Storage (${upload.status})`);
  return { stored: true, key: objectKey, bucket };
}
