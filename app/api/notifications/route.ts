import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";

export const dynamic = "force-dynamic";

async function ensureTable() {
  const db = getPostgresDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS notification_preferences (
    user_email TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TEXT NOT NULL,
    last_notified_at TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    application_id BIGINT NOT NULL,
    type TEXT NOT NULL,
    due_at TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
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
  const nowIso = new Date().toISOString();
  for (const row of rows.results as Array<Record<string, unknown>>) {
    const id = String(row.id);
    const common = [user.email, row.id, row.company, row.role, row.status, nowIso];
    if (row.next_action_at) await db.prepare(`INSERT INTO notification_events (id,user_email,application_id,type,due_at,company,role,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,company=excluded.company,role=excluded.role,status=excluded.status`)
      .bind(`${id}:next-action`, ...common.slice(0,1), row.id, "Prochaine action", row.next_action_at, ...common.slice(2)).run();
    if (row.interview_at) {
      await db.prepare(`INSERT INTO notification_events (id,user_email,application_id,type,due_at,company,role,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,company=excluded.company,role=excluded.role,status=excluded.status`)
        .bind(`${id}:interview`, ...common.slice(0,1), row.id, "Entretien", row.interview_at, ...common.slice(2)).run();
      const interviewTime = new Date(String(row.interview_at)).getTime();
      if (Number.isFinite(interviewTime)) await db.prepare(`INSERT INTO notification_events (id,user_email,application_id,type,due_at,company,role,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,company=excluded.company,role=excluded.role,status=excluded.status`)
        .bind(`${id}:follow-up`, ...common.slice(0,1), row.id, "Relance après entretien", new Date(interviewTime + 3 * 86400000).toISOString(), ...common.slice(2)).run();
    }
  }
  const eventRows = await db.prepare(`SELECT id AS notification_id,application_id AS id,type,due_at AS date,company,role,status,read_at
    FROM notification_events WHERE user_email=? AND due_at >= (CURRENT_TIMESTAMP - INTERVAL '1 day') AND due_at <= (CURRENT_TIMESTAMP + INTERVAL '7 days')
    ORDER BY due_at ASC LIMIT 50`).bind(user.email).all();
  const now = Date.now();
  const reminders = eventRows.results.map((item) => ({ ...item, read: Boolean(item.read_at) })).filter((item) => { const timestamp = new Date(String(item.date)).getTime(); return Number.isFinite(timestamp) && timestamp >= now - 86400000 && timestamp <= now + 7 * 86400000; });
  return Response.json({ enabled: preference?.enabled === true || preference?.enabled === "true", reminders });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { enabled?: boolean; notificationId?: string; action?: string };
  await ensureTable();
  const db = getPostgresDb();
  if (body.action === "read" && body.notificationId) {
    const result = await db.prepare("UPDATE notification_events SET read_at=? WHERE id=? AND user_email=? AND read_at IS NULL RETURNING id")
      .bind(new Date().toISOString(), body.notificationId, user.email).run();
    return Response.json({ ok: true, read: Boolean(result.meta.changes) });
  }
  const enabled = body.enabled === true;
  await db.prepare(`INSERT INTO notification_preferences (user_email,enabled,updated_at)
    VALUES (?,?,?) ON CONFLICT(user_email) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .bind(user.email, enabled, new Date().toISOString()).run();
  return Response.json({ ok: true, enabled });
}
