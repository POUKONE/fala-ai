import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";
import { resetEmail } from "../../../../db/email-templates";
import { hashOpaqueToken } from "../../../email-auth";

export const dynamic = "force-dynamic";
const RESET_TTL_SECONDS = 3600;

export async function POST(request: Request) {
  const { email } = await request.json() as { email?: string };
  const value = String(email ?? "").trim().toLowerCase();
  const generic = { ok: true, message: "Si cette adresse existe, un lien de récupération sera envoyé.", expiresInSeconds: RESET_TTL_SECONDS };
  if (!/^\S+@\S+\.\S+$/.test(value)) return Response.json(generic);
  // Five requests per 15 minutes is enough for normal retries while keeping
  // automated abuse contained. The v2 key also avoids locking users who were
  // caught by the previous one-hour window during the initial rollout.
  if (!await enforceRateLimit(value, "password-reset-v2", 5, 900)) return Response.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  const token = crypto.randomUUID();
  const account = await getPostgresDb().prepare("SELECT email FROM users WHERE lower(email)=lower(?)").bind(value).first<{ email: string }>();
  if (account) {
    const expiresAt = new Date(Date.now() + RESET_TTL_SECONDS * 1000);
    await getPostgresDb().prepare("UPDATE users SET reset_token=?,reset_token_expires_at=? WHERE lower(email)=lower(?)").bind(await hashOpaqueToken(token), expiresAt.toISOString(), value).run();
    const resetUrl = new URL(`/auth?mode=reset&token=${encodeURIComponent(token)}&expires=${expiresAt.getTime()}`, request.url).toString();
    const delivery = await sendTransactionalMail({ to: value, ...resetEmail(resetUrl) });
    if (!delivery.configured) console.error("[Fala AI] password recovery email service is not configured");
  }
  return Response.json(generic);
}
