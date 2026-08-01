import { cookies } from "next/headers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getPostgresDb } from "../../../../db/postgres";
import { SESSION_COOKIE } from "../../../email-auth";

export const dynamic = "force-dynamic";

const INACTIVITY_DAYS = 30;

function deviceLabel(userAgent: string | null) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value) ? "Edge" : /Chrome\//.test(value) ? "Chrome" : /Firefox\//.test(value) ? "Firefox" : /Safari\//.test(value) ? "Safari" : "Navigateur";
  const device = /Mobile|Android|iPhone|iPad/i.test(value) ? "mobile" : "ordinateur";
  return `${browser} · ${device}`;
}

async function currentUser() {
  const user = await getChatGPTUser();
  return user?.email ? user : null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const db = getPostgresDb();
  const cutoff = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  try {
    await db.prepare("DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen_at<=?").bind(now, cutoff).run();
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    const result = await db.prepare("SELECT token,created_at,last_seen_at,expires_at,user_agent FROM auth_sessions WHERE lower(user_email)=lower(?) ORDER BY last_seen_at DESC").bind(user.email).all<{ token:string; created_at:string; last_seen_at:string; expires_at:string; user_agent:string|null }>();
    return Response.json({ sessions: result.results.map((session) => ({ createdAt: session.created_at, lastSeenAt: session.last_seen_at, expiresAt: session.expires_at, device: deviceLabel(session.user_agent), current: Boolean(token && session.token === token) })) });
  } catch (error) {
    if (!/no such column|does not exist/i.test(String(error))) throw error;
    const result = await db.prepare("SELECT created_at,created_at AS last_seen_at,expires_at FROM auth_sessions WHERE lower(user_email)=lower(?) ORDER BY created_at DESC").bind(user.email).all<{ created_at:string; last_seen_at:string; expires_at:string }>();
    return Response.json({ sessions: result.results.map((session) => ({ createdAt: session.created_at, lastSeenAt: session.last_seen_at, expiresAt: session.expires_at, device: "Appareil non identifié", current: false })) });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  await getPostgresDb().prepare("DELETE FROM auth_sessions WHERE lower(user_email)=lower(?)").bind(user.email).run();
  const response = Response.json({ ok: true, message: "Toutes les sessions ont été déconnectées." });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
