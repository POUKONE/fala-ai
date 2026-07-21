import { getD1 } from "../../../../db/d1";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { email } = await request.json() as { email?: string };
  const value = String(email ?? "").trim().toLowerCase();
  const generic = { ok: true, message: "Si cette adresse existe, un lien de récupération sera envoyé." };
  if (!/^\S+@\S+\.\S+$/.test(value)) return Response.json(generic);
  if (!await enforceRateLimit(value, "password-reset", 3, 3600)) return Response.json({ error: "Trop de demandes" }, { status: 429 });
  const token = crypto.randomUUID();
  const account = await getD1().prepare("SELECT email FROM users WHERE lower(email)=lower(?)").bind(value).first<{ email: string }>();
  if (account) {
    await getD1().prepare("UPDATE users SET reset_token=?,reset_token_expires_at=? WHERE lower(email)=lower(?)").bind(token, new Date(Date.now() + 3600000).toISOString(), value).run();
    void sendTransactionalMail({ to: value, subject: "Récupérer votre accès Fala AI", html: `<p><a href="${new URL(`/auth?mode=reset&token=${encodeURIComponent(token)}`, request.url)}">Réinitialiser mon mot de passe</a></p>` }).catch(() => {});
  }
  return Response.json(generic);
}
