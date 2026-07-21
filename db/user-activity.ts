import type { ChatGPTUser } from "../app/chatgpt-auth";
import { env } from "cloudflare:workers";
import { getD1 } from "./d1";

export function isPlatformAdmin(email: string) {
  const configured = (String((env as unknown as Record<string, unknown>).ADMIN_EMAILS ?? ""))
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return configured.includes(email.toLowerCase());
}

export async function touchUser(user: ChatGPTUser) {
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO users (email,display_name,created_at,last_seen_at) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at`)
    .bind(user.email,user.displayName,now,now).run();
}

export async function recordActivity(user: ChatGPTUser, eventType: string, description: string) {
  await touchUser(user);
  await getD1().prepare("INSERT INTO activity_events (user_email,event_type,description,created_at) VALUES (?,?,?,?)")
    .bind(user.email,eventType,description,new Date().toISOString()).run();
}
