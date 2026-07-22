import { env } from "cloudflare:workers";
import { getD1 } from "./d1";

type BackupPayload = { exportedAt: string; users: unknown[]; profiles: unknown[]; applications: unknown[]; activity: unknown[]; reports: unknown[]; roles: unknown[] };

/** Creates one encrypted-at-rest R2 snapshot per day when BACKUPS is bound. */
export async function createDailyBackup() {
  const bucket = (env as unknown as { BACKUPS?: R2Bucket }).BACKUPS;
  if (!bucket) return { stored: false, reason: "R2 non configuré" };
  const date = new Date().toISOString().slice(0, 10);
  const key = `daily/fala-ai-${date}.json`;
  if (await bucket.head(key)) return { stored: false, reason: "snapshot déjà présent" };
  const db = getD1();
  const [users, profiles, applications, activity, reports, roles] = await Promise.all([
    db.prepare("SELECT email,display_name,created_at,last_seen_at,consent_version,consented_at,suspended_at,suspension_reason FROM users").all(),
    db.prepare("SELECT * FROM profiles").all(),
    db.prepare("SELECT * FROM applications").all(),
    db.prepare("SELECT * FROM activity_events").all(),
    db.prepare("SELECT * FROM reports").all(),
    db.prepare("SELECT * FROM user_roles").all(),
  ]);
  const payload: BackupPayload = { exportedAt: new Date().toISOString(), users: users.results, profiles: profiles.results, applications: applications.results, activity: activity.results, reports: reports.results, roles: roles.results };
  await bucket.put(key, JSON.stringify(payload), { httpMetadata: { contentType: "application/json" }, customMetadata: { retentionDays: "30" } });
  const cutoff = Date.now() - 30 * 86400000;
  const objects = await bucket.list({ prefix: "daily/" });
  const old = objects.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
  if (old.length) await bucket.delete(old);
  return { stored: true, key };
}
