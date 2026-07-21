import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { enforceRateLimit, hasAdminAccess } from "../../../../db/security";

export const dynamic="force-dynamic";
const csv=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
export async function GET(){
  const admin=await getChatGPTUser();if(!admin||!await hasAdminAccess(admin.email))return Response.json({error:"Accès administrateur requis"},{status:403});
  if(!await enforceRateLimit(admin.email,"admin-export",5,3600))return Response.json({error:"Limite d’export atteinte"},{status:429});
  const rows=await getD1().prepare("SELECT u.email,u.display_name,u.created_at,u.last_seen_at,u.suspended_at,COUNT(a.id) AS applications FROM users u LEFT JOIN applications a ON a.user_email=u.email GROUP BY u.email ORDER BY u.created_at DESC").all<Record<string,unknown>>();
  const content=["email,nom,inscription,derniere_activite,suspension,candidatures",...rows.results.map(r=>[r.email,r.display_name,r.created_at,r.last_seen_at,r.suspended_at,r.applications].map(csv).join(","))].join("\n");
  return new Response(content,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="fala-ai-admin-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
}
