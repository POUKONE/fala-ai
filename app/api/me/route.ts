import { getChatGPTUser } from "../../chatgpt-auth";
import { recordSessionActivity } from "../../../db/user-activity";
import { CONSENT_VERSION, getAccountState, hasAdminAccess } from "../../../db/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user:null, isAdmin:false });
  await recordSessionActivity(user);
  const state = await getAccountState(user.email);
  return Response.json({ user, isAdmin:await hasAdminAccess(user.email), consentRequired:state?.consent_version!==CONSENT_VERSION, suspended:Boolean(state?.suspended_at), suspensionReason:state?.suspension_reason??null });
}
