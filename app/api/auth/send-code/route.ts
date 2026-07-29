import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";
import { hashPassword } from "../../../email-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; displayName?: string; consent?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Adresse e-mail valide requise" }, { status: 400 });
  if (!body.consent) return Response.json({ error: "Votre consentement est requis pour créer le compte" }, { status: 400 });
  if (!await enforceRateLimit(email, "signup-code", 3, 900)) return Response.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  const db = getPostgresDb();
  const existing = await db.prepare("SELECT email,email_verified_at,password_hash FROM users WHERE lower(email)=lower(?)").bind(email).first<{email:string;email_verified_at:string|null;password_hash:string|null}>();
  if (existing?.email_verified_at || existing?.password_hash) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashPassword(code);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const name = String(body.displayName ?? "").trim().slice(0, 120) || email.split("@")[0];
  await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,verification_token) VALUES (?,?,?,?,NULL,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,verification_token=excluded.verification_token")
    .bind(email, name, new Date().toISOString(), new Date().toISOString(), JSON.stringify({ hash: codeHash, expires, attempts: 0 })).run();
  const delivery = await sendTransactionalMail({ to: email, subject: "Votre code de vérification — Fala AI", html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c1925;line-height:1.6"><h2>Vérifiez votre adresse e-mail</h2><p>Bonjour,</p><p>Voici votre code pour commencer votre inscription sur Fala AI :</p><p style="font-size:32px;letter-spacing:8px;font-weight:800">${code}</p><p>Ce code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.</p><p>À bientôt,<br>L’équipe Fala AI</p></div>` });
  if (!delivery.configured) return Response.json({ error: "Le service d’envoi d’e-mails n’est pas configuré." }, { status: 503 });
  return Response.json({ ok: true, message: "Un code de vérification vient d’être envoyé." });
}
