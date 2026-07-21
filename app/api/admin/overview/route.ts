import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { isPlatformAdmin, touchUser } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Authentification requise" },{status:401});
  if (!isPlatformAdmin(user.email)) return Response.json({ error:"Accès administrateur requis" },{status:403});
  await touchUser(user);
  const db = getD1();
  const [users,active,applications,recentApps,statuses,recentUsers,activity] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM users").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE last_seen_at >= datetime('now','-7 days')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM applications").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM applications WHERE created_at >= datetime('now','-7 days')").first<{count:number}>(),
    db.prepare("SELECT status, COUNT(*) AS count FROM applications GROUP BY status ORDER BY count DESC").all(),
    db.prepare("SELECT email,display_name,created_at,last_seen_at FROM users ORDER BY last_seen_at DESC LIMIT 20").all(),
    db.prepare("SELECT user_email,event_type,description,created_at FROM activity_events ORDER BY id DESC LIMIT 30").all(),
  ]);
  return Response.json({ connection:{status:"connected",source:"Fala AI",checkedAt:new Date().toISOString()},summary:{users:users?.count??0,active7d:active?.count??0,applications:applications?.count??0,newApplications7d:recentApps?.count??0},statuses:statuses.results,recentUsers:recentUsers.results,activity:activity.results });
}
