import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";
import { enforceRateLimit } from "../../../db/security";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Authentification requise"},{status:401});
  if (!await enforceRateLimit(user.email,"account-delete",3,3600)) return Response.json({error:"Trop de tentatives"},{status:429});
  const body = await request.json() as {confirmation?:string};
  if (body.confirmation !== "SUPPRIMER") return Response.json({error:"Confirmation invalide"},{status:400});
  const db = getPostgresDb();
  await db.batch([
    db.prepare("DELETE FROM applications WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM profiles WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM activity_events WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM reports WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM system_errors WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM user_roles WHERE user_email=?").bind(user.email),
    db.prepare("DELETE FROM rate_limits WHERE key LIKE ?").bind(`${user.email.toLowerCase()}:%`),
    db.prepare("DELETE FROM users WHERE email=?").bind(user.email),
  ]);
  return Response.json({ok:true,signOut:"/api/auth/logout"});
}
