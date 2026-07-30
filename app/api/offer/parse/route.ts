import { getChatGPTUser } from "../../../chatgpt-auth";
import { parseOfferText } from "../../../../db/offer-parser";
import { enforceRateLimit, getAccountState, logSystemError } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic="force-dynamic";
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:"Authentification requise"},{status:401});
  const state=await getAccountState(user.email);if(state?.suspended_at)return Response.json({error:"Compte suspendu"},{status:403});
  if(!await enforceRateLimit(user.email,"offer-parse",20,3600))return Response.json({error:"Limite d’analyses atteinte pour cette heure"},{status:429});
  try{const body=await request.json() as {text?:string};const text=String(body.text??"").slice(0,30000);const parsed=parseOfferText(text);await recordActivity(user,"offer.parsed","Annonce analysée automatiquement");return Response.json({parsed});}
  catch(error){await logSystemError("/api/offer/parse",error,user.email);return Response.json({error:error instanceof Error?error.message:"Analyse impossible"},{status:400});}
}
