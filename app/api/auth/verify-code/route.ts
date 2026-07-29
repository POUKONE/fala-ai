import { getD1 } from "../../../../db/d1";
import { enforceRateLimit } from "../../../../db/security";
import { verifyPassword } from "../../../email-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; code?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(code)) return Response.json({ error: "Adresse et code valides requis" }, { status: 400 });
  if (!await enforceRateLimit(email, "verify-code", 10, 900)) return Response.json({ error: "Trop de tentatives. Demandez un nouveau code." }, { status: 429 });
  const row = await getD1().prepare("SELECT verification_token,email_verified_at,password_hash FROM users WHERE lower(email)=lower(?)").bind(email).first<{verification_token:string|null;email_verified_at:string|null;password_hash:string|null}>();
  if (!row || row.email_verified_at || row.password_hash || !row.verification_token) return Response.json({ error: "Code invalide ou adresse déjà utilisée" }, { status: 400 });
  let challenge: {hash:string;expires:string;attempts:number}; try { challenge = JSON.parse(row.verification_token); } catch { return Response.json({ error: "Code invalide ou expiré" }, { status: 400 }); }
  if (new Date(challenge.expires).getTime() < Date.now() || challenge.attempts >= 5) return Response.json({ error: "Code expiré. Demandez un nouveau code." }, { status: 400 });
  if (!await verifyPassword(code, challenge.hash)) { await getD1().prepare("UPDATE users SET verification_token=? WHERE lower(email)=lower(?)").bind(JSON.stringify({ ...challenge, attempts: challenge.attempts + 1 }), email).run(); return Response.json({ error: "Code incorrect" }, { status: 400 }); }
  await getD1().prepare("UPDATE users SET email_verified_at=?,verification_token=? WHERE lower(email)=lower(?)").bind(new Date().toISOString(), "verified", email).run();
  return Response.json({ ok: true, message: "Adresse vérifiée. Choisissez maintenant votre mot de passe." });
}
