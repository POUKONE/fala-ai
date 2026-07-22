import { getD1 } from "../../../../db/d1";
import { CONSENT_VERSION } from "../../../../db/security";
import { createSession, hashPasswordSafe, SESSION_COOKIE } from "../../../email-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string; displayName?: string; consent?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.displayName ?? "").trim().slice(0, 120) || email.split("@")[0];
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return Response.json({ error: "Adresse valide et mot de passe de 8 caractères minimum requis" }, { status: 400 });
  if (!body.consent) return Response.json({ error: "Votre consentement est requis pour créer le compte" }, { status: 400 });
  const db = getD1();
  if (await db.prepare("SELECT email FROM users WHERE lower(email)=lower(?)").bind(email).first()) return Response.json({ error: "Cette adresse est déjà inscrite" }, { status: 409 });
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,consent_version,consented_at) VALUES (?,?,?,?,?,?,?)")
    .bind(email, name, now, now, await hashPasswordSafe(password), CONSENT_VERSION, now).run();
  const session = await createSession(email);
  const response = Response.json({ ok: true, user: { email, displayName: name }, message: "Votre compte Fala AI est créé." });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return response;
}
