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
  return Response.json({ error: "Identifiants invalides" }, { status: 401, headers: { "Cache-Control": "no-store" } });
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
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 256) return invalidCredentials();

  const emailAllowed = await enforceRateLimit(email, "auth-login", 10, 900);
  const ipAllowed = ip === "unknown" ? true : await enforceRateLimit(`ip:${ip}`, "auth-login", 30, 900);
  if (!emailAllowed || !ipAllowed) return limited(Response.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, { status: 429 }));

  const [emailLock, ipLock] = await Promise.all([getLoginLock(email), ip === "unknown" ? null : getLoginLock(`ip:${ip}`)]);
  if (emailLock?.locked_until || ipLock?.locked_until) {
    return limited(Response.json({ error: "Trop de tentatives échouées. Réessayez dans 15 minutes." }, { status: 429 }));
  }

  const failures = Math.max(emailLock?.failed_count ?? 0, ipLock?.failed_count ?? 0);
  if (failures >= 3) {
    const captcha = await verifyTurnstile(body?.captchaToken, ip);
    if (captcha.configured && !captcha.success) {
      return limited(Response.json({ error: "Vérification anti-abus requise avant de continuer.", captchaRequired: true }, { status: 403 }), 60);
    }
  }

  const db = getPostgresDb();
  // The local account lookup and Supabase authentication are independent;
  // run them together so login latency is bounded by the slower dependency,
  // not the sum of both round trips.
  let [user, remote] = await Promise.all([
    db.prepare("SELECT email,display_name,password_hash,suspended_at FROM users WHERE lower(email)=lower(?)")
      .bind(email).first<LoginUser>(),
    supabasePasswordGrant(email, password),
  ]);
  let authenticated = Boolean(remote?.user);
  if (!authenticated && user?.password_hash && user.password_hash !== "supabase") {
    authenticated = await verifyPassword(password, user.password_hash);
  }
  if (!authenticated) {
    await registerFailure(email, ip);
    return invalidCredentials();
  }

  if (user?.suspended_at) return Response.json({ error: "Compte suspendu" }, { status: 403 });
  if (remote?.user && !user) {
    const now = new Date().toISOString();
    const displayName = String(remote.user.user_metadata?.display_name || email.split("@")[0]);
    await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,consent_version,consented_at) VALUES (?,?,?,?,?,?,?)")
      .bind(email, displayName, now, now, "supabase", "v1", now).run();
    user = { email, display_name: displayName, password_hash: "supabase", suspended_at: null };
  }

  const sessionEmail = user?.email ?? email;
  await db.prepare("UPDATE users SET last_seen_at=? WHERE lower(email)=lower(?)").bind(new Date().toISOString(), sessionEmail).run();
  // Rotate the account's sessions after a successful authentication so tokens
  // from a previous login cannot remain valid indefinitely.
  try { await invalidateSessions(sessionEmail); } catch { /* the new session may still be created if cleanup is unavailable */ }
  await clearLoginFailures(ip === "unknown" ? [email] : [email, `ip:${ip}`]);
  const session = await createSession(sessionEmail);
  const response = Response.json({ ok: true, user: { email: sessionEmail, displayName: user?.display_name ?? email.split("@")[0] } });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
