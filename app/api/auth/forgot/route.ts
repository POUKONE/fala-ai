import { getD1 } from "../../../../db/d1";
import { enforceRateLimit } from "../../../../db/security";

export const dynamic = "force-dynamic";

/**
 * Starts a password recovery request. The response is intentionally generic so
 * it never reveals whether an address belongs to a Fala AI account. A mail
 * provider can consume reset_token/reset_token_expires_at when configured.
 */
export async function POST(request: Request) {
  const body = await request.json() as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Adresse e-mail invalide" }, { status: 400 });
  if (!await enforceRateLimit(`recovery:${email}`, "password-reset", 3, 3600)) return Response.json({ error: "Trop de demandes. Réessayez plus tard." }, { status: 429 });
  const token = crypto.randomUUID();
  await getD1().prepare("UPDATE users SET reset_token=?,reset_token_expires_at=? WHERE lower(email)=lower(?)")
    .bind(token, new Date(Date.now() + 60 * 60 * 1000).toISOString(), email).run();
  return Response.json({ ok: true, message: "Si cette adresse existe, les instructions de récupération seront envoyées." });
}
