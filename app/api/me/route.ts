import { getChatGPTUser } from "../../chatgpt-auth";
import { isPlatformAdmin, touchUser } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user:null, isAdmin:false });
  await touchUser(user);
  return Response.json({ user, isAdmin:isPlatformAdmin(user.email) });
}
