import type { ChatGPTUser } from "../app/chatgpt-auth";
import { getPostgresDb } from "./postgres";
export { hasAdminAccess } from "./security";

export function isPlatformAdmin(email: string) {
  const configured = (String(process.env.ADMIN_EMAILS ?? "ibrahimapoukone@gmail.com"))
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return configured.includes(email.toLowerCase());
}

export async function touchUser(user: ChatGPTUser) {
  const now = new Date().toISOString();
  await getPostgresDb().prepare(`INSERT INTO users (email,display_name,created_at,last_seen_at) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at`)
    .bind(user.email,user.displayName,now,now).run();
}

export async function recordActivity(user: ChatGPTUser, eventType: string, description: string) {
  await touchUser(user);
  await getPostgresDb().prepare("INSERT INTO activity_events (user_email,event_type,description,created_at) VALUES (?,?,?,?)")
    .bind(user.email,eventType,description,new Date().toISOString()).run();
}

export async function recordSessionActivity(user: ChatGPTUser) {
  await touchUser(user);
  const latest = await getPostgresDb().prepare("SELECT created_at FROM activity_events WHERE user_email=? AND event_type='session.opened' ORDER BY id DESC LIMIT 1")
    .bind(user.email).first<{created_at:string}>();
  const lastOpenedAt = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
  if (Date.now() - lastOpenedAt < 30 * 60 * 1000) return;
  await getPostgresDb().prepare("INSERT INTO activity_events (user_email,event_type,description,created_at) VALUES (?,?,?,?)")
    .bind(user.email,"session.opened","Connexion à l’espace personnel",new Date().toISOString()).run();
}
