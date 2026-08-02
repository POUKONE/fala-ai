import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("les notifications sont strictement isolées par utilisateur", async () => {
  const route = await read("app/api/notifications/route.ts");
  const migration = await read("supabase/migrations/0008_notification_events.sql");

  assert.match(route, /const user = await getChatGPTUser\(\)/);
  assert.match(route, /FROM notification_events WHERE user_email=\?/i);
  assert.match(route, /FROM applications WHERE user_email=\?/i);
  assert.match(
    route,
    /UPDATE notification_events SET read_at=\? WHERE id=\? AND user_email=\? AND read_at IS NULL/i,
    "marquer une notification comme lue doit vérifier son propriétaire",
  );
  assert.doesNotMatch(route, /body\.(?:email|userEmail)/i);
  assert.match(migration, /user_email text not null references public\.users\(email\) on delete cascade/i);
  assert.match(migration, /notification_events_user_due_idx/i);
});

test("les rappels d'entretien et la relance J+3 sont déterministes", async () => {
  const route = await read("app/api/notifications/route.ts");

  assert.match(route, /\$\{id\}:interview/);
  assert.match(route, /\$\{id\}:follow-up/);
  assert.match(route, /, "Entretien", row\.interview_at/);
  assert.match(route, /, "Relance après entretien", new Date\(interviewTime \+ 3 \* 86400000\)/);
  assert.match(route, /interviewTime \+ 3 \* 86400000/);
  assert.match(
    route,
    /ON CONFLICT\(id\) DO UPDATE SET due_at=excluded\.due_at,company=excluded\.company,role=excluded\.role,status=excluded\.status/,
    "un rafraîchissement ne doit pas dupliquer ni réinitialiser l'état lu",
  );
});

test("les e-mails cron sont réservés aux rappels d'entretien", async () => {
  const route = await readFile("app/api/cron/notifications/route.ts", "utf8");
  assert.match(route, /AND e\.type = 'Entretien'/);
});

test("le client confirme localement l'état lu et resynchronise en cas d'échec", async () => {
  const page = await read("app/page.tsx");

  assert.match(page, /setNotificationReminders\(\(current\)=>current\.map/);
  assert.match(page, /action:\"read\", notificationId:item\.notification_id/);
  assert.match(page, /if \(!response\.ok\) \{[\s\S]*await syncNotifications\(false\)/);
  assert.match(page, /item\.read\?" · Lu":" · Nouveau"/);
});
