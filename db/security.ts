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
    // Read and update the window in one Postgres round-trip. This endpoint is
    // on the login hot path, so a SELECT followed by an INSERT/UPDATE made a
    // normal sign-in wait on several sequential HTTP requests.
    current = await db.prepare(`
      INSERT INTO rate_limits (key,window_start,count)
      VALUES (?,CURRENT_TIMESTAMP,1)
      ON CONFLICT(key) DO UPDATE SET
        window_start = CASE WHEN rate_limits.window_start < (CURRENT_TIMESTAMP - INTERVAL '${windowSeconds} seconds') THEN CURRENT_TIMESTAMP ELSE rate_limits.window_start END,
        count = CASE WHEN rate_limits.window_start < (CURRENT_TIMESTAMP - INTERVAL '${windowSeconds} seconds') THEN 1 ELSE rate_limits.count + 1 END
      RETURNING window_start,count
    `).bind(key).first<{window_start:string;count:number}>();
  } catch (error) {
    if (!String(error).includes("no such table: rate_limits")) throw error;
    await db.prepare("CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY NOT NULL, window_start TEXT NOT NULL, count INTEGER DEFAULT 0 NOT NULL)").run();
    current = await db.prepare(`
      INSERT INTO rate_limits (key,window_start,count) VALUES (?,CURRENT_TIMESTAMP,1)
      ON CONFLICT(key) DO UPDATE SET window_start=CURRENT_TIMESTAMP,count=1
      RETURNING window_start,count
    `).bind(key).first<{window_start:string;count:number}>();
  }
  return Boolean(current && current.count <= limit);
}

export function getClientIp(request: Request) {
  // Vercel sets these headers at the edge. Prefer the platform-provided
  // address, then fall back to the first forwarded hop for local proxies.
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

type LoginFailure = {
  identity: string;
  failed_count: number;
  first_failed_at: string;
  locked_until: string | null;
  updated_at: string;
};

async function ensureLoginFailuresTable() {
  const db = getPostgresDb();
  try {
    await db.prepare("SELECT identity FROM auth_login_failures LIMIT 1").all();
  } catch (error) {
    if (!/no such table|does not exist/i.test(String(error))) throw error;
    await db.prepare("CREATE TABLE IF NOT EXISTS auth_login_failures (identity TEXT PRIMARY KEY NOT NULL, failed_count INTEGER NOT NULL DEFAULT 0, first_failed_at TEXT NOT NULL, locked_until TEXT, updated_at TEXT NOT NULL)").run();
  }
}

export async function getLoginLock(identity: string) {
  const row = await getPostgresDb().prepare("SELECT identity,failed_count,first_failed_at,locked_until,updated_at FROM auth_login_failures WHERE identity=?")
    .bind(identity.toLowerCase()).first<LoginFailure>();
  if (!row?.locked_until) return row;
  if (new Date(row.locked_until).getTime() > Date.now()) return row;
  await getPostgresDb().prepare("DELETE FROM auth_login_failures WHERE identity=?").bind(identity.toLowerCase()).run();
  return null;
}

export async function recordLoginFailure(identities: string[], windowSeconds = 900, maxFailures = 5, lockSeconds = 900) {
  await ensureLoginFailuresTable();
  const db = getPostgresDb();
  const now = new Date();
  const first = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  for (const raw of identities) {
    const identity = raw.toLowerCase();
    const current = await db.prepare("SELECT identity,failed_count,first_failed_at,locked_until,updated_at FROM auth_login_failures WHERE identity=?")
      .bind(identity).first<LoginFailure>();
    const count = current && current.first_failed_at > first ? current.failed_count + 1 : 1;
    const lockedUntil = count >= maxFailures ? new Date(now.getTime() + lockSeconds * 1000).toISOString() : null;
    await db.prepare("INSERT INTO auth_login_failures (identity,failed_count,first_failed_at,locked_until,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET failed_count=excluded.failed_count,first_failed_at=excluded.first_failed_at,locked_until=excluded.locked_until,updated_at=excluded.updated_at")
      .bind(identity, count, current && current.first_failed_at > first ? current.first_failed_at : now.toISOString(), lockedUntil, now.toISOString()).run();
  }
}

export async function clearLoginFailures(identities: string[]) {
  const values = identities.map((identity) => identity.toLowerCase());
  if (!values.length) return;
  const placeholders = values.map(() => "?").join(",");
  await getPostgresDb().prepare(`DELETE FROM auth_login_failures WHERE lower(identity) IN (${placeholders})`).bind(...values).run();
}

export async function verifyTurnstile(token: string | undefined, ip: string) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY ?? "").trim();
  if (!secret) return { configured: false, success: false };
  if (!token) return { configured: true, success: false };
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip === "unknown" ? undefined : ip }),
    });
    const result = await response.json() as { success?: boolean };
    return { configured: true, success: response.ok && result.success === true };
  } catch {
    return { configured: true, success: false };
  }
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
