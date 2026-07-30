import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getPostgresDb } from "../../../../../db/postgres";
import { hasAdminAccess } from "../../../../../db/security";
import { recordActivity } from "../../../../../db/user-activity";

export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const admin=await getChatGPTUser();if(!admin||!await hasAdminAccess(admin.email))return Response.json({error:"Accès administrateur requis"},{status:403});
  const {id}=await context.params;const body=await request.json() as {status?:string;adminNote?:string};
  const status=["open","in_progress","resolved","dismissed"].includes(String(body.status))?String(body.status):"open";
  const updated=await getPostgresDb().prepare("UPDATE reports SET status=?,admin_note=?,updated_at=? WHERE id=? RETURNING *").bind(status,String(body.adminNote??"").slice(0,1000),new Date().toISOString(),id).first();
  if(!updated)return Response.json({error:"Signalement introuvable"},{status:404});
  await recordActivity(admin,"admin.report_updated",`Signalement #${id} · ${status}`);return Response.json({report:updated});
}
