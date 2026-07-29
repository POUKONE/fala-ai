import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";
import { CONSENT_VERSION, enforceRateLimit } from "../../../db/security";
import { recordActivity } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Authentification requise"},{status:401});
  if (!await enforceRateLimit(user.email,"consent",5,300)) return Response.json({error:"Trop de tentatives"},{status:429});
  const body = await request.json() as {accepted?:boolean};
  if (body.accepted !== true) return Response.json({error:"Votre accord explicite est requis pour utiliser l’espace personnel."},{status:400});
  const now = new Date().toISOString();
  await getPostgresDb().prepare("UPDATE users SET consent_version=?,consented_at=? WHERE email=?").bind(CONSENT_VERSION,now,user.email).run();
  await recordActivity(user,"privacy.consent","Politique de confidentialité et conditions acceptées");
  return Response.json({ok:true,version:CONSENT_VERSION,consentedAt:now});
}
