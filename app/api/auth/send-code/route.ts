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
  const existing = await db.prepare("SELECT email,email_verified_at,password_hash,verification_token FROM users WHERE lower(email)=lower(?)").bind(email).first<{email:string;email_verified_at:string|null;password_hash:string|null;verification_token:string|null}>();
  if (existing?.password_hash) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashPassword(code);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const name = String(body.displayName ?? "").trim().slice(0, 120) || email.split("@")[0];
  await db.prepare("INSERT INTO users (email,display_name,created_at,last_seen_at,password_hash,verification_token,email_verified_at) VALUES (?,?,?,?,NULL,?,NULL) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,password_hash=NULL,verification_token=excluded.verification_token,email_verified_at=NULL")
    .bind(email, name, new Date().toISOString(), new Date().toISOString(), JSON.stringify({ hash: codeHash, expires, attempts: 0 })).run();
  const delivery = await sendTransactionalMail({
    to: email,
    subject: "Votre code d’accès Fala AI",
    text: `Bonjour,\n\nVotre code d’accès Fala AI est : ${code}\n\nIl reste valable 10 minutes. Si vous n’avez pas demandé ce code, vous pouvez ignorer ce message.\n\nL’équipe Fala AI`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:28px 20px;color:#1c1925;line-height:1.6"><p style="margin:0 0 20px;font-weight:700;color:#5131ea">Fala AI</p><h2 style="margin:0 0 12px;font-size:22px">Votre code d’accès</h2><p>Bonjour,</p><p>Utilisez le code ci-dessous pour confirmer votre adresse et poursuivre votre inscription :</p><p style="margin:24px 0;padding:16px;text-align:center;border:1px solid #e5e1ff;border-radius:10px;background:#f7f5ff;font-size:32px;letter-spacing:8px;font-weight:800;color:#3f2b9e">${code}</p><p style="font-size:13px;color:#6d6b78">Ce code reste valable 10 minutes. Si vous n’avez pas demandé ce code, vous pouvez ignorer ce message.</p><p>À bientôt,<br>L’équipe Fala AI</p></div>`
  });
  if (!delivery.configured) return Response.json({ error: "Le service d’envoi d’e-mails n’est pas configuré." }, { status: 503 });
  return Response.json({ ok: true, message: "Un code de vérification vient d’être envoyé." });
}
