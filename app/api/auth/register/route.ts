import { getD1 } from "../../../../db/d1";
import { CONSENT_VERSION } from "../../../../db/security";
import { createSession, SESSION_COOKIE } from "../../../email-auth";
import { supabaseSignUp } from "../../../supabase-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string; displayName?: string; consent?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.displayName ?? "").trim().slice(0, 120) || email.split("@")[0];
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return Response.json({ error: "Adresse valide et mot de passe de 8 caractères minimum requis" }, { status: 400 });
  if (!body.consent) return Response.json({ error: "Votre consentement est requis pour créer le compte" }, { status: 400 });
  const db = getD1();
  const existing = await db.prepare("SELECT email,email_verified_at,password_hash FROM users WHERE lower(email)=lower(?)").bind(email).first<{email:string;email_verified_at:string|null;password_hash:string|null}>();
  if (existing && (existing.email_verified_at || existing.password_hash)) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 });
  if (!existing?.email_verified_at) return Response.json({ error: "Vérifiez d’abord votre adresse e-mail avec le code reçu" }, { status: 400 });
  let authResult;
  try { authResult = await supabaseSignUp(email, password, name); } catch (error) { const message = error instanceof Error ? error.message : "Impossible de créer le compte"; if (/already|registered|exists|occup/i.test(message)) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 }); return Response.json({ error: message }, { status: 400 }); }
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,consent_version,consented_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,password_hash=excluded.password_hash,consent_version=excluded.consent_version,consented_at=excluded.consented_at")
    .bind(email, name, now, now, "supabase", CONSENT_VERSION, now).run();
  if (!authResult.access_token) return Response.json({ ok: true, requiresEmailConfirmation: true, user: { email, displayName: name }, message: "Votre compte est créé. Confirmez votre adresse e-mail avant de vous connecter." });
  const session = await createSession(email);
  const response = Response.json({ ok: true, user: { email, displayName: name }, message: "Votre compte Fala AI est créé." });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return response;
}
