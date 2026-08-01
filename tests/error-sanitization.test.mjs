import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la réinitialisation ne renvoie pas les détails internes", async () => {
  const source = await readFile(new URL("../app/api/auth/reset-password/route.ts", import.meta.url), "utf8");
  assert.match(source, /const GENERIC_FAILURE/);
  assert.match(source, /return Response\.json\(\{ error: GENERIC_FAILURE \}/);
  assert.doesNotMatch(source, /Impossible de finaliser la réinitialisation \(\$\{stage\}/);
  assert.match(source, /console\.error\("\[Fala AI\] reset-password failed"/);
});
