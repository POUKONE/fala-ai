import { getChatGPTUser } from "../../chatgpt-auth";
import { isPlatformAdmin, recordSessionActivity } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user:null, isAdmin:false });
  await recordSessionActivity(user);
  return Response.json({ user, isAdmin:isPlatformAdmin(user.email) });
}
