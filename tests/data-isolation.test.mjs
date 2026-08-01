import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readRoute = (path) => readFile(new URL(path, root), "utf8");

test("les routes utilisateur dérivent l'identité de la session serveur", async () => {
  const routes = [
    "app/api/applications/route.ts",
    "app/api/applications/[id]/route.ts",
    "app/api/profile/route.ts",
    "app/api/activity/route.ts",
    "app/api/notifications/route.ts",
    "app/api/account/route.ts",
    "app/api/account/export/route.ts",
    "app/api/reports/route.ts",
    "app/api/consent/route.ts",
    "app/api/cv/adapt/route.ts",
    "app/api/cv/analyze/route.ts",
    "app/api/offer/parse/route.ts",
  ];
  const sources = await Promise.all(routes.map(readRoute));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /getChatGPTUser\(\)/, `${routes[index]} doit utiliser la session serveur`);
    assert.doesNotMatch(source, /body\.(?:email|userEmail)|body\[['"](?:email|userEmail)['"]\]/, `${routes[index]} ne doit pas accepter l'identité depuis le navigateur`);
  }
});

test("les candidatures sont systématiquement filtrées par propriétaire", async () => {
  const collection = await readRoute("app/api/applications/route.ts");
  const item = await readRoute("app/api/applications/[id]/route.ts");
  assert.match(collection, /applications\s+WHERE\s+user_email\s*=\s*\?/i);
  assert.match(collection, /UPDATE applications SET[\s\S]*WHERE id=\? AND user_email=\?/i);
  assert.match(item, /SELECT \* FROM applications WHERE id = \? AND user_email = \?/i);
  assert.match(item, /UPDATE applications SET[\s\S]*WHERE id=\? AND user_email=\?/i);
  assert.match(item, /DELETE FROM applications WHERE id = \? AND user_email = \?/i);
});

test("les lectures de profil, activité, notifications et exports sont cloisonnées", async () => {
  const [profile, activity, notifications, accountExport] = await Promise.all([
    readRoute("app/api/profile/route.ts"),
    readRoute("app/api/activity/route.ts"),
    readRoute("app/api/notifications/route.ts"),
    readRoute("app/api/account/export/route.ts"),
  ]);
  assert.match(profile, /profiles WHERE user_email\s*=\s*\?/i);
  assert.match(activity, /activity_events WHERE user_email\s*=\s*\?/i);
  assert.match(notifications, /notification_preferences WHERE user_email=\?/i);
  assert.match(notifications, /FROM applications WHERE user_email=\?/i);
  assert.match(accountExport, /profiles WHERE user_email=\?/i);
  assert.match(accountExport, /applications WHERE user_email=\?/i);
  assert.match(accountExport, /activity_events WHERE user_email=\?/i);
  assert.match(accountExport, /reports WHERE user_email=\?/i);
});
