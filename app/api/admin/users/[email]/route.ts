import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getD1 } from "../../../../../db/d1";
import { enforceRateLimit, hasAdminAccess } from "../../../../../db/security";
import { isPlatformAdmin, recordActivity } from "../../../../../db/user-activity";

export const dynamic="force-dynamic";

export async function PATCH(request:Request,context:{params:Promise<{email:string}>}){
  const admin=await getChatGPTUser();
  if(!admin||!await hasAdminAccess(admin.email))return Response.json({error:"Accès administrateur requis"},{status:403});
  if(!await enforceRateLimit(admin.email,"admin-user-action",30,300))return Response.json({error:"Trop d’actions rapprochées"},{status:429});
  const {email:encoded}=await context.params;const email=decodeURIComponent(encoded).toLowerCase();
  const body=await request.json() as {action?:string;reason?:string;role?:string};
  if(email===admin.email.toLowerCase()&&body.action==="suspend")return Response.json({error:"Vous ne pouvez pas suspendre votre propre compte"},{status:400});
  if(isPlatformAdmin(email)&&body.action==="suspend")return Response.json({error:"Le propriétaire principal ne peut pas être suspendu"},{status:400});
  const db=getD1();const now=new Date().toISOString();
  if(body.action==="suspend")await db.prepare("UPDATE users SET suspended_at=?,suspension_reason=? WHERE lower(email)=lower(?)").bind(now,String(body.reason??"Suspendu par un administrateur").slice(0,300),email).run();
  else if(body.action==="reactivate")await db.prepare("UPDATE users SET suspended_at=NULL,suspension_reason=NULL WHERE lower(email)=lower(?)").bind(email).run();
  else if(body.action==="setRole"){
    if(!isPlatformAdmin(admin.email))return Response.json({error:"Seul le propriétaire principal peut définir les administrateurs"},{status:403});
    await db.prepare("DELETE FROM user_roles WHERE lower(user_email)=lower(?)").bind(email).run();
    if(body.role==="admin")await db.prepare("INSERT INTO user_roles (user_email,role,granted_by,created_at) VALUES (?,'admin',?,?)").bind(email,admin.email,now).run();
  } else return Response.json({error:"Action invalide"},{status:400});
  await recordActivity(admin,"admin.user_action",`${body.action} · ${email}`);
  return Response.json({ok:true});
}
