import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { verifyPassword } from "../../../email-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string; code?: string };
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(code)) return Response.json({ error: "Adresse et code valides requis" }, { status: 400 });
  if (!await enforceRateLimit(email, "verify-code", 10, 900)) return Response.json({ error: "Trop de tentatives. Demandez un nouveau code." }, { status: 429 });
  const db = getPostgresDb();
  const row = await db.prepare("SELECT code_hash,expires_at,attempts,verified_at FROM signup_challenges WHERE lower(email)=lower(?)").bind(email).first<{code_hash:string;expires_at:string;attempts:number;verified_at:string|null}>();
  if (!row || row.verified_at) return Response.json({ error: "Code invalide ou adresse déjà utilisée" }, { status: 400 });
  if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= 5) return Response.json({ error: "Code expiré. Demandez un nouveau code." }, { status: 400 });
  if (!await verifyPassword(code, row.code_hash)) { await db.prepare("UPDATE signup_challenges SET attempts=attempts+1 WHERE lower(email)=lower(?)").bind(email).run(); return Response.json({ error: "Code incorrect" }, { status: 400 }); }
  await db.prepare("UPDATE signup_challenges SET verified_at=? WHERE lower(email)=lower(?)").bind(new Date().toISOString(), email).run();
  return Response.json({ ok: true, message: "Adresse vérifiée. Choisissez maintenant votre mot de passe." });
}
