import { env } from "cloudflare:workers";
import { getD1 } from "./d1";

export const CONSENT_VERSION = "2026-07-22";

function configuredAdmins() {
  // Keep the platform owner protected even when the hosted runtime has not yet
  // injected the optional ADMIN_EMAILS variable. Additional administrators can
  // still be granted from the control centre by the owner.
  return String((env as unknown as Record<string, unknown>).ADMIN_EMAILS ?? "ibrahimapoukone@gmail.com")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export async function hasAdminAccess(email: string) {
  if (configuredAdmins().includes(email.toLowerCase())) return true;
  const role = await getD1().prepare("SELECT 1 AS ok FROM user_roles WHERE lower(user_email)=lower(?) AND role='admin' LIMIT 1")
    .bind(email).first<{ok:number}>();
  return Boolean(role?.ok);
}

export async function getAccountState(email: string) {
  return await getD1().prepare("SELECT consent_version,consented_at,suspended_at,suspension_reason FROM users WHERE email=?")
    .bind(email).first<{consent_version:string|null;consented_at:string|null;suspended_at:string|null;suspension_reason:string|null}>();
}

export async function enforceRateLimit(identity: string, action: string, limit = 30, windowSeconds = 60) {
  const db = getD1();
  const key = `${identity.toLowerCase()}:${action}`;
  const current = await db.prepare("SELECT window_start,count FROM rate_limits WHERE key=?").bind(key).first<{window_start:string;count:number}>();
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
  await getD1().prepare("INSERT INTO system_errors (user_email,route,message,created_at) VALUES (?,?,?,?)")
    .bind(userEmail ?? null,route,message.slice(0,500),new Date().toISOString()).run();
}

export async function applyRetentionPolicy() {
  const db = getD1();
  const result = await db.batch([
    db.prepare("DELETE FROM rate_limits WHERE window_start < datetime('now','-2 days')"),
    db.prepare("DELETE FROM system_errors WHERE created_at < datetime('now','-90 days')"),
    db.prepare("DELETE FROM activity_events WHERE created_at < datetime('now','-12 months')"),
  ]);
  return result.reduce((sum,item) => sum + Number(item.meta.changes ?? 0),0);
}
