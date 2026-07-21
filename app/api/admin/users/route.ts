import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { hasAdminAccess } from "../../../../db/security";
export const dynamic="force-dynamic";
export async function GET(request:Request){const admin=await getChatGPTUser(); if(!admin||!await hasAdminAccess(admin.email))return Response.json({error:"Accès administrateur requis"},{status:403}); const url=new URL(request.url), q=(url.searchParams.get("q")??"").trim().slice(0,100); const pattern=`%${q.replaceAll("%","\\%").replaceAll("_","\\_")}%`; const users=await getD1().prepare("SELECT email,display_name,created_at,last_seen_at,suspended_at,suspension_reason,consented_at FROM users WHERE email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY last_seen_at DESC LIMIT 100").bind(pattern,pattern).all(); return Response.json({users:users.results});}
