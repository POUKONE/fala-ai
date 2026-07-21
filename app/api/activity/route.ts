import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";
import { touchUser } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  await touchUser(user);
  const activity = await getD1().prepare(
    "SELECT event_type,description,created_at FROM activity_events WHERE user_email=? ORDER BY id DESC LIMIT 50",
  ).bind(user.email).all();
  return Response.json({ activity: activity.results });
}
