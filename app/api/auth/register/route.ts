import { getPostgresDb } from "../../../../db/postgres";
import { CONSENT_VERSION } from "../../../../db/security";
import { createSession, SESSION_COOKIE } from "../../../email-auth";
import { supabaseSignUp } from "../../../supabase-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; password?: string; displayName?: string; consent?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const submittedName = String(body.displayName ?? "").trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || submittedName.length < 2 || password.length < 8) return Response.json({ error: "Nom, adresse valide et mot de passe de 8 caractères minimum requis" }, { status: 400 });
  if (!body.consent) return Response.json({ error: "Votre consentement est requis pour créer le compte" }, { status: 400 });
  const db = getPostgresDb();
  const existing = await db.prepare("SELECT email,password_hash FROM users WHERE lower(email)=lower(?)").bind(email).first<{email:string;password_hash:string|null}>();
  // A verified address without a password is an interrupted registration, not
  // an occupied account. Allow the user to finish it after a transient error.
  if (existing?.password_hash) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 });
  const challenge = await db.prepare("SELECT display_name,verified_at FROM signup_challenges WHERE lower(email)=lower(?)").bind(email).first<{display_name:string;verified_at:string|null}>();
  if (!challenge?.verified_at) return Response.json({ error: "Vérifiez d’abord votre adresse e-mail avec le code reçu" }, { status: 400 });
  if (challenge.display_name !== submittedName) return Response.json({ error: "Le nom doit rester identique à celui validé au début de l’inscription" }, { status: 400 });
  const name = challenge.display_name;
  let authResult;
  try { authResult = await supabaseSignUp(email, password, name); } catch (error) { const message = error instanceof Error ? error.message : "Impossible de créer le compte"; if (/already|registered|exists|occup/i.test(message)) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 }); return Response.json({ error: message }, { status: 400 }); }
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,consent_version,consented_at,email_verified_at,verification_token) VALUES (?,?,?,?,?,?,?, ?,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,password_hash=excluded.password_hash,consent_version=excluded.consent_version,consented_at=excluded.consented_at,email_verified_at=excluded.email_verified_at,verification_token=NULL")
    .bind(email, name, now, now, "supabase", CONSENT_VERSION, now, challenge.verified_at, "verified").run();
  await db.prepare("DELETE FROM signup_challenges WHERE lower(email)=lower(?)").bind(email).run();
  if (!authResult.access_token) return Response.json({ ok: true, requiresEmailConfirmation: true, user: { email, displayName: name }, message: "Votre compte est créé. Confirmez votre adresse e-mail avant de vous connecter." });
  const session = await createSession(email);
  const response = Response.json({ ok: true, user: { email, displayName: name }, message: "Votre compte Fala AI est créé." });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return response;
}
