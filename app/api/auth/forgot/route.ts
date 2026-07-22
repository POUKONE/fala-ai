import { getD1 } from "../../../../db/d1";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";
import { supabaseResetPassword } from "../../../supabase-auth";

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
  try { await supabaseResetPassword(value, new URL("/auth?mode=reset", request.url).toString()); } catch { /* Keep the response generic. */ }
  const token = crypto.randomUUID();
  const account = await getD1().prepare("SELECT email FROM users WHERE lower(email)=lower(?)").bind(value).first<{ email: string }>();
  if (account) {
    await getD1().prepare("UPDATE users SET reset_token=?,reset_token_expires_at=? WHERE lower(email)=lower(?)").bind(token, new Date(Date.now() + 3600000).toISOString(), value).run();
    const resetUrl = new URL(`/auth?mode=reset&token=${encodeURIComponent(token)}`, request.url).toString();
    const delivery = await sendTransactionalMail({
      to: value,
      subject: "Réinitialisez votre mot de passe — Fala AI",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c1925;line-height:1.6"><h2>Réinitialisation de votre mot de passe</h2><p>Bonjour,</p><p>Vous avez demandé à modifier le mot de passe de votre compte Fala AI.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:7px;background:#1c1925;color:#fff;text-decoration:none;font-weight:700">Choisir un nouveau mot de passe</a></p><p>Ce lien est valable pendant <strong>1 heure</strong> et ne peut être utilisé qu’une seule fois.</p><p>Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.</p><p>À bientôt,<br>L’équipe Fala AI</p></div>`
    });
    if (!delivery.configured) return Response.json({ error: "La récupération par e-mail n’est pas encore configurée. L’administrateur doit connecter un service d’e-mail transactionnel." }, { status: 503 });
  }
  return Response.json(generic);
}
