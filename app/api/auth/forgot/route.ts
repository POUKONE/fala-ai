import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";
import { hashOpaqueToken } from "../../../email-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { email } = await request.json() as { email?: string };
  const value = String(email ?? "").trim().toLowerCase();
  const generic = { ok: true, message: "Si cette adresse existe, un lien de récupération sera envoyé." };
  if (!/^\S+@\S+\.\S+$/.test(value)) return Response.json(generic);
  // Five requests per 15 minutes is enough for normal retries while keeping
  // automated abuse contained. The v2 key also avoids locking users who were
  // caught by the previous one-hour window during the initial rollout.
  if (!await enforceRateLimit(value, "password-reset-v2", 5, 900)) return Response.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  const token = crypto.randomUUID();
  const account = await getPostgresDb().prepare("SELECT email FROM users WHERE lower(email)=lower(?)").bind(value).first<{ email: string }>();
  if (account) {
    await getPostgresDb().prepare("UPDATE users SET reset_token=?,reset_token_expires_at=? WHERE lower(email)=lower(?)").bind(await hashOpaqueToken(token), new Date(Date.now() + 3600000).toISOString(), value).run();
    const resetUrl = new URL(`/auth?mode=reset&token=${encodeURIComponent(token)}`, request.url).toString();
    const delivery = await sendTransactionalMail({
      to: value,
      subject: "Modifier votre mot de passe Fala AI",
      text: `Bonjour,\n\nVous avez demandé à modifier le mot de passe de votre compte Fala AI. Ouvrez ce lien pour choisir un nouveau mot de passe : ${resetUrl}\n\nLe lien reste valable 1 heure et ne peut être utilisé qu’une seule fois. Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer ce message.\n\nL’équipe Fala AI`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:28px 20px;color:#1c1925;line-height:1.6"><p style="margin:0 0 20px;font-weight:700;color:#5131ea">Fala AI</p><h2 style="margin:0 0 12px;font-size:22px">Modifier votre mot de passe</h2><p>Bonjour,</p><p>Une demande de modification a été faite pour votre compte Fala AI.</p><p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#1c1925;color:#fff;text-decoration:none;font-weight:700">Choisir un nouveau mot de passe</a></p><p style="font-size:13px;color:#6d6b78">Ce lien reste valable 1 heure et ne peut être utilisé qu’une seule fois. Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer ce message.</p><p>À bientôt,<br>L’équipe Fala AI</p></div>`
    });
    if (!delivery.configured) console.error("[Fala AI] password recovery email service is not configured");
  }
  return Response.json(generic);
}
