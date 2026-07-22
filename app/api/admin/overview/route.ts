import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { touchUser } from "../../../../db/user-activity";
import { applyRetentionPolicy, hasAdminAccess } from "../../../../db/security";
import { createDailyBackup } from "../../../../db/backup";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error:"Authentification requise" },{status:401});
  if (!await hasAdminAccess(user.email)) return Response.json({ error:"Accès administrateur requis" },{status:403});
  await touchUser(user);
  await applyRetentionPolicy();
  void createDailyBackup().catch(() => {});
  const db = getD1();
  const [users,active,applications,recentApps,statuses,recentUsers,activity,reports,errors,roles] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM users").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE last_seen_at >= datetime('now','-7 days')").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM applications").first<{count:number}>(),
    db.prepare("SELECT COUNT(*) AS count FROM applications WHERE created_at >= datetime('now','-7 days')").first<{count:number}>(),
    db.prepare("SELECT status, COUNT(*) AS count FROM applications GROUP BY status ORDER BY count DESC").all(),
    db.prepare("SELECT email,display_name,created_at,last_seen_at,suspended_at,suspension_reason,consented_at FROM users ORDER BY last_seen_at DESC LIMIT 50").all(),
    db.prepare("SELECT user_email,event_type,description,created_at FROM activity_events ORDER BY id DESC LIMIT 30").all(),
    db.prepare("SELECT id,user_email,category,message,status,admin_note,created_at,updated_at FROM reports ORDER BY id DESC LIMIT 30").all(),
    db.prepare("SELECT id,user_email,route,message,created_at FROM system_errors ORDER BY id DESC LIMIT 30").all(),
    db.prepare("SELECT user_email,role,granted_by,created_at FROM user_roles ORDER BY created_at DESC").all(),
  ]);
  return Response.json({ connection:{status:"connected",source:"Fala AI",checkedAt:new Date().toISOString()},summary:{users:users?.count??0,active7d:active?.count??0,applications:applications?.count??0,newApplications7d:recentApps?.count??0},statuses:statuses.results,recentUsers:recentUsers.results,activity:activity.results,reports:reports.results,errors:errors.results,roles:roles.results });
}
