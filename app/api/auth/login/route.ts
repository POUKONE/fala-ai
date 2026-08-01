import { getPostgresDb } from "../../../../db/postgres";
import {
  clearLoginFailures,
  enforceRateLimit,
  getClientIp,
  getLoginLock,
  recordLoginFailure,
  verifyTurnstile,
} from "../../../../db/security";
import { createSession, invalidateSessions, verifyPassword, SESSION_COOKIE } from "../../../email-auth";
import { supabasePasswordGrant } from "../../../supabase-auth";
import { authPreflight, finalizeAuth } from "../../../../db/auth-rpc";

export const dynamic = "force-dynamic";

type LoginUser = {
  email: string;
  display_name: string;
  password_hash: string | null;
  suspended_at: string | null;
};

function limited(response: Response, seconds = 900) {
  response.headers.set("Retry-After", String(seconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function invalidCredentials() {
  return Response.json({ error: "Identifiants incorrects" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

async function registerFailure(email: string, ip: string) {
  await recordLoginFailure(ip === "unknown" ? [email] : [email, `ip:${ip}`]);
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 20_000) return Response.json({ error: "Requête trop volumineuse" }, { status: 413 });

  const body = await request.json().catch(() => null) as { email?: string; password?: string; captchaToken?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? undefined;
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 256) return invalidCredentials();

  const fastPreflight = await authPreflight(email, ip);
  let failures = 0;
  if (fastPreflight) {
    if (fastPreflight.allowed !== true) return limited(Response.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 }));
    if (fastPreflight.emailLocked === true || fastPreflight.ipLocked === true) return limited(Response.json({ error: "Trop de tentatives échouées. Réessayez dans 15 minutes." }, { status: 429 }));
    failures = Number(fastPreflight.failedCount ?? 0);
  } else {
    const emailAllowed = await enforceRateLimit(email, "auth-login", 10, 900);
    const ipAllowed = ip === "unknown" ? true : await enforceRateLimit(`ip:${ip}`, "auth-login", 30, 900);
    if (!emailAllowed || !ipAllowed) return limited(Response.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 }));
    const [emailLock, ipLock] = await Promise.all([getLoginLock(email), ip === "unknown" ? null : getLoginLock(`ip:${ip}`)]);
    if (emailLock?.locked_until || ipLock?.locked_until) return limited(Response.json({ error: "Trop de tentatives échouées. Réessayez dans 15 minutes." }, { status: 429 }));
    failures = Math.max(emailLock?.failed_count ?? 0, ipLock?.failed_count ?? 0);
  }
  if (failures >= 3) {
    const captcha = await verifyTurnstile(body?.captchaToken, ip);
    if (captcha.configured && !captcha.success) {
      return limited(Response.json({ error: "Vérification anti-abus requise avant de continuer.", captchaRequired: true }, { status: 403 }), 60);
    }
  }

  const db = getPostgresDb();
  // Supabase Auth is the source of truth for current accounts. The local
  // lookup is retained only as a compatibility fallback for legacy hashes.
  const remote = await supabasePasswordGrant(email, password);
  let user: LoginUser | null = null;
  let authenticated = Boolean(remote?.user);
  if (!authenticated) {
    user = await db.prepare("SELECT email,display_name,password_hash,suspended_at FROM users WHERE lower(email)=lower(?)").bind(email).first<LoginUser>();
    if (user?.password_hash && user.password_hash !== "supabase") authenticated = await verifyPassword(password, user.password_hash);
  }
  if (!authenticated) {
    await registerFailure(email, ip);
    return invalidCredentials();
  }

  if (user?.suspended_at) return Response.json({ error: "Compte suspendu" }, { status: 403 });
  const sessionEmail = user?.email ?? email;
  const displayName = user?.display_name ?? String(remote?.user?.user_metadata?.display_name || email.split("@")[0]);
  if (remote?.user && fastPreflight) {
    const now = new Date();
    const sessionToken = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    const expires = new Date(now.getTime() + 2592000000);
    const finalized = await finalizeAuth(sessionEmail, ip, displayName, sessionToken, now.toISOString(), expires.toISOString(), userAgent);
    if (finalized?.suspended === true) return Response.json({ error: "Compte suspendu" }, { status: 403 });
    if (finalized?.ok === true) {
      const response = Response.json({ ok: true, user: { email: sessionEmail, displayName } });
      response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  }
  // If the fast RPC is not installed yet, retain the local account check
  // before the compatibility upsert so suspended legacy accounts cannot
  // bypass the suspension guard during the transition.
  if (remote?.user && !user) {
    user = await db.prepare("SELECT email,display_name,password_hash,suspended_at FROM users WHERE lower(email)=lower(?)").bind(email).first<LoginUser>();
    if (user?.suspended_at) return Response.json({ error: "Compte suspendu" }, { status: 403 });
  }
  if (remote?.user && !user) {
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,consent_version,consented_at) VALUES (?,?,?,?,?,?,?)")
      .bind(email, displayName, now, now, "supabase", "v1", now).run();
    user = { email, display_name: displayName, password_hash: "supabase", suspended_at: null };
  }
  // Rotate the account's sessions after a successful authentication so tokens
  // from a previous login cannot remain valid indefinitely.
  await db.prepare("UPDATE users SET last_seen_at=? WHERE lower(email)=lower(?)").bind(new Date().toISOString(), sessionEmail).run();
  try { await invalidateSessions(sessionEmail); } catch { /* the new session may still be created if cleanup is unavailable */ }
  await clearLoginFailures(ip === "unknown" ? [email] : [email, `ip:${ip}`]);
  const session = await createSession(sessionEmail, { userAgent, ip });
  const response = Response.json({ ok: true, user: { email: sessionEmail, displayName: user?.display_name ?? email.split("@")[0] } });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
