import { getChatGPTUser } from "../../chatgpt-auth";
import { recordSessionActivity } from "../../../db/user-activity";
import { CONSENT_VERSION, getAccountState, hasAdminAccess } from "../../../db/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user:null, isAdmin:false });
  // Activity logging must not block the first screen after login. The session
  // is already authenticated; record the event opportunistically while the
  // account state and role checks run in parallel.
  void recordSessionActivity(user).catch((error) => console.error("[Fala AI] session activity logging failed", error));
  const [state, isAdmin] = await Promise.all([getAccountState(user.email), hasAdminAccess(user.email)]);
  return Response.json({ user, isAdmin, consentRequired:state?.consent_version!==CONSENT_VERSION, suspended:Boolean(state?.suspended_at), suspensionReason:state?.suspension_reason??null });
}
