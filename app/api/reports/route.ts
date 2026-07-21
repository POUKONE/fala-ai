import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";
import { enforceRateLimit } from "../../../db/security";
import { recordActivity } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function POST(request: Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Authentification requise"},{status:401});
  if(!await enforceRateLimit(user.email,"report",5,3600))return Response.json({error:"Limite de signalements atteinte"},{status:429});
  const body=await request.json() as {category?:string;message?:string};
  const category=String(body.category??"Autre").trim().slice(0,80);const message=String(body.message??"").trim().slice(0,2000);
  if(message.length<10)return Response.json({error:"Décrivez le problème en au moins 10 caractères"},{status:400});
  const now=new Date().toISOString();
  const report=await getD1().prepare("INSERT INTO reports (user_email,category,message,status,admin_note,created_at,updated_at) VALUES (?,?,?,'open','',?,?) RETURNING *")
    .bind(user.email,category,message,now,now).first();
  await recordActivity(user,"report.created",`Signalement transmis · ${category}`);
  return Response.json({report},{status:201});
}
