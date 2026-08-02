import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { sendTransactionalMail } from "../../../../db/mailer";
import { verificationEmail } from "../../../../db/email-templates";
import { hashPassword } from "../../../email-auth";
import { supabaseAdminDeleteOrphan } from "../../../supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; displayName?: string; consent?: boolean };
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.displayName ?? "").trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Adresse e-mail valide requise" }, { status: 400 });
  if (name.length < 2) return Response.json({ error: "Votre nom est requis pour créer le compte" }, { status: 400 });
  if (!body.consent) return Response.json({ error: "Votre consentement est requis pour créer le compte" }, { status: 400 });
  if (!await enforceRateLimit(email, "signup-code", 3, 900)) return Response.json({ error: "Trop de demandes. Réessayez dans quelques minutes." }, { status: 429 });
  const db = getPostgresDb();
  const existing = await db.prepare("SELECT email,password_hash FROM users WHERE lower(email)=lower(?)").bind(email).first<{email:string;password_hash:string|null}>();
  if (existing?.password_hash) return Response.json({ error: "Cette adresse est déjà occupée" }, { status: 409 });
  // A previous password step may have created a Supabase Auth identity before
  // the application row was committed. It is not a finalized account, so
  // remove that orphan and let the candidate restart verification.
  try { await supabaseAdminDeleteOrphan(email); } catch (error) {
    console.error("[signup] orphan identity cleanup failed", error);
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashPassword(code);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO signup_challenges (email,display_name,code_hash,expires_at,attempts,verified_at,created_at) VALUES (?,?,?,?,0,NULL,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,verified_at=NULL,created_at=excluded.created_at")
    .bind(email, name, codeHash, expires, new Date().toISOString()).run();
  const message = verificationEmail(code);
  const delivery = await sendTransactionalMail({ to: email, ...message });
  if (!delivery.configured) {
    await db.prepare("DELETE FROM signup_challenges WHERE lower(email)=lower(?)").bind(email).run();
    return Response.json({ error: "Le service d’envoi d’e-mails n’est pas configuré." }, { status: 503 });
  }
  return Response.json({ ok: true, message: "Un code de vérification vient d’être envoyé." });
}
