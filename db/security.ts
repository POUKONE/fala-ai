import { getPostgresDb } from "./postgres";

export const CONSENT_VERSION = "2026-07-22";

function configuredAdmins() {
  // Keep the platform owner protected even when the hosted runtime has not yet
  // injected the optional ADMIN_EMAILS variable. Additional administrators can
  // still be granted from the control centre by the owner.
  return String(process.env.ADMIN_EMAILS ?? "ibrahimapoukone@gmail.com")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export async function hasAdminAccess(email: string) {
  if (configuredAdmins().includes(email.toLowerCase())) return true;
  const role = await getPostgresDb().prepare("SELECT 1 AS ok FROM user_roles WHERE lower(user_email)=lower(?) AND role='admin' LIMIT 1")
    .bind(email).first<{ok:number}>();
  return Boolean(role?.ok);
}

export async function getAccountState(email: string) {
  return await getPostgresDb().prepare("SELECT consent_version,consented_at,suspended_at,suspension_reason FROM users WHERE email=?")
    .bind(email).first<{consent_version:string|null;consented_at:string|null;suspended_at:string|null;suspension_reason:string|null}>();
}

export async function enforceRateLimit(identity: string, action: string, limit = 30, windowSeconds = 60) {
  const db = getPostgresDb();
  const key = `${identity.toLowerCase()}:${action}`;
  let current: {window_start:string;count:number} | null;
  try {
    current = await db.prepare("SELECT window_start,count FROM rate_limits WHERE key=?").bind(key).first<{window_start:string;count:number}>();
  } catch (error) {
    if (!String(error).includes("no such table: rate_limits")) throw error;
    await db.prepare("CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY NOT NULL, window_start TEXT NOT NULL, count INTEGER DEFAULT 0 NOT NULL)").run();
    current = await db.prepare("SELECT window_start,count FROM rate_limits WHERE key=?").bind(key).first<{window_start:string;count:number}>();
  }
  const now = new Date();
  if (!current || now.getTime() - new Date(current.window_start).getTime() >= windowSeconds * 1000) {
    await db.prepare("INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=1")
      .bind(key,now.toISOString()).run();
    return true;
  }
  if (current.count >= limit) return false;
  await db.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(key).run();
  return true;
}

export async function logSystemError(route: string, error: unknown, userEmail?: string | null) {
  const message = error instanceof Error ? error.message : String(error ?? "Erreur inconnue");
  await getPostgresDb().prepare("INSERT INTO system_errors (user_email,route,message,created_at) VALUES (?,?,?,?)")
    .bind(userEmail ?? null,route,message.slice(0,500),new Date().toISOString()).run();
}

export async function applyRetentionPolicy() {
  const db = getPostgresDb();
  const result = await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE window_start < (CURRENT_TIMESTAMP - INTERVAL '2 days')"),
    db.prepare("DELETE FROM system_errors WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '90 days')"),
    db.prepare("DELETE FROM activity_events WHERE created_at < (CURRENT_TIMESTAMP - INTERVAL '12 months')"),
  ]);
  return result.reduce((sum,item) => sum + Number(item.meta.changes ?? 0),0);
}
