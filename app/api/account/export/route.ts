import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { enforceRateLimit } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Authentification requise"},{status:401});
  if (!await enforceRateLimit(user.email,"data-export",3,3600)) return Response.json({error:"Un export est déjà disponible. Réessayez plus tard."},{status:429});
  const db = getD1();
  const [account,profile,applications,activity,reports] = await Promise.all([
    db.prepare("SELECT email,display_name,created_at,last_seen_at,consent_version,consented_at FROM users WHERE email=?").bind(user.email).first(),
    db.prepare("SELECT * FROM profiles WHERE user_email=?").bind(user.email).first(),
    db.prepare("SELECT * FROM applications WHERE user_email=? ORDER BY id").bind(user.email).all(),
    db.prepare("SELECT event_type,description,created_at FROM activity_events WHERE user_email=? ORDER BY id").bind(user.email).all(),
    db.prepare("SELECT category,message,status,admin_note,created_at,updated_at FROM reports WHERE user_email=? ORDER BY id").bind(user.email).all(),
  ]);
  await recordActivity(user,"privacy.export","Export des données personnelles généré");
  const payload = JSON.stringify({exportedAt:new Date().toISOString(),account,profile:profile??null,applications:applications.results,activity:activity.results,reports:reports.results},null,2);
  return new Response(payload,{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="fala-ai-export-${new Date().toISOString().slice(0,10)}.json"`,"cache-control":"no-store"}});
}
