import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";

export const dynamic = "force-dynamic";

async function ensureTable() {
  await getPostgresDb().prepare(`CREATE TABLE IF NOT EXISTS notification_preferences (
    user_email TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TEXT NOT NULL,
    last_notified_at TEXT
  )`).run();
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  await ensureTable();
  const db = getPostgresDb();
  const preference = await db.prepare("SELECT enabled FROM notification_preferences WHERE user_email=?").bind(user.email).first<{ enabled: boolean | string }>();
  const rows = await db.prepare(`SELECT id,company,role,next_action_at,interview_at,status
    FROM applications WHERE user_email=? AND (next_action_at IS NOT NULL OR interview_at IS NOT NULL)
    ORDER BY COALESCE(interview_at,next_action_at) ASC LIMIT 30`).bind(user.email).all();
  const now = Date.now();
  const reminders = rows.results.flatMap((row) => {
    const item = row as Record<string, unknown>;
    return [
      item.next_action_at ? { id: item.id, type: "Prochaine action", date: item.next_action_at, company: item.company, role: item.role, status: item.status } : null,
      item.interview_at ? { id: item.id, type: "Entretien", date: item.interview_at, company: item.company, role: item.role, status: item.status } : null,
    ].filter(Boolean);
  }).filter((item) => { const timestamp = new Date(String(item!.date)).getTime(); return Number.isFinite(timestamp) && timestamp >= now - 86400000 && timestamp <= now + 7 * 86400000; });
  return Response.json({ enabled: preference?.enabled === true || preference?.enabled === "true", reminders });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { enabled?: boolean };
  await ensureTable();
  const enabled = body.enabled === true;
  await getPostgresDb().prepare(`INSERT INTO notification_preferences (user_email,enabled,updated_at)
    VALUES (?,?,?) ON CONFLICT(user_email) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .bind(user.email, enabled, new Date().toISOString()).run();
  return Response.json({ ok: true, enabled });
}
