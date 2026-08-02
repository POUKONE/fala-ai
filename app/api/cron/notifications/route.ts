import { getPostgresDb } from "../../../../db/postgres";
import { sendTransactionalMail } from "../../../../db/mailer";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function ensureTable() {
  const db = getPostgresDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS notification_events (
    id TEXT PRIMARY KEY, user_email TEXT NOT NULL, application_id BIGINT NOT NULL,
    type TEXT NOT NULL, due_at TIMESTAMPTZ NOT NULL, company TEXT NOT NULL, role TEXT NOT NULL,
    status TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL, email_sent_at TIMESTAMPTZ
  )`).run();
  await db.prepare("ALTER TABLE notification_events ALTER COLUMN due_at TYPE TIMESTAMPTZ USING due_at::timestamptz").run();
  await db.prepare("ALTER TABLE notification_events ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz").run();
  await db.prepare("ALTER TABLE notification_events ALTER COLUMN read_at TYPE TIMESTAMPTZ USING read_at::timestamptz").run();
  await db.prepare("ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS email_sent_at TEXT").run();
  await db.prepare("ALTER TABLE notification_events ALTER COLUMN email_sent_at TYPE TIMESTAMPTZ USING email_sent_at::timestamptz").run();
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  await ensureTable();
  const db = getPostgresDb();
  const due = await db.prepare(`SELECT e.id,e.user_email,e.type,e.due_at,e.company,e.role,u.display_name
    FROM notification_events e JOIN users u ON u.email=e.user_email
    JOIN notification_preferences p ON p.user_email=e.user_email AND p.enabled=TRUE
    WHERE e.due_at <= CURRENT_TIMESTAMP AND e.due_at >= (CURRENT_TIMESTAMP - INTERVAL '1 day')
      AND e.type = 'Entretien'
      AND e.email_sent_at IS NULL ORDER BY e.due_at ASC LIMIT 100`).all<Record<string, unknown>>();
  let sent = 0;
  for (const item of due.results) {
    const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(String(item.due_at)));
    const result = await sendTransactionalMail({
      to: String(item.user_email),
      subject: `Fala AI — ${String(item.type)} : ${String(item.role)}`,
      text: `Bonjour ${String(item.display_name || "")},\n\nVotre rappel Fala AI est arrivé : ${String(item.type).toLowerCase()} pour ${String(item.role)} chez ${String(item.company)} (${date}).\n\nConnectez-vous à votre espace Fala AI pour consulter la candidature et préparer votre prochaine action.`,
      html: `<p>Bonjour ${String(item.display_name || "")},</p><p>Votre rappel Fala AI est arrivé : <strong>${String(item.type).toLowerCase()}</strong> pour <strong>${String(item.role)}</strong> chez <strong>${String(item.company)}</strong>.</p><p>Date : ${date}</p><p>Connectez-vous à votre espace Fala AI pour consulter la candidature et préparer votre prochaine action.</p>`,
    });
    if (result.sent) {
      await db.prepare("UPDATE notification_events SET email_sent_at=? WHERE id=? AND email_sent_at IS NULL")
        .bind(new Date().toISOString(), item.id).run();
      sent += 1;
    }
  }
  return Response.json({ ok: true, due: due.results.length, sent, configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) });
}
