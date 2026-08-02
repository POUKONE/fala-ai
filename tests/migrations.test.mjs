import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationRoot = new URL("../supabase/migrations/", import.meta.url);

test("les migrations Supabase sont présentes, ordonnées et couvrent le runtime", async () => {
  const files = (await readdir(migrationRoot)).filter((file) => file.endsWith(".sql")).sort();
  assert.ok(files.length >= 3, "au moins les migrations initiales doivent être présentes");
  assert.deepEqual(files.slice(0, 3), ["0001_fala_sql_rpc.sql", "0002_auth_login_protection.sql", "0003_runtime_schema.sql"]);
  files.forEach((file, index) => assert.equal(file.slice(0, 4), String(index + 1).padStart(4, "0"), `${file} doit suivre l'ordre des migrations`));
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, migrationRoot), "utf8")));
  const runtime = sources.join("\n");
  for (const table of ["users", "auth_sessions", "rate_limits", "activity_events", "profiles", "applications", "user_roles", "reports", "system_errors", "notification_preferences", "auth_login_failures"]) {
    assert.match(runtime, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), `${table} doit être versionnée`);
  }
  assert.match(runtime, /create index if not exists applications_user_email_idx/i);
  assert.match(runtime, /auth_login_failures/i);
  assert.match(runtime, /notification_events/i);
});
