import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const fixtureRoot = new URL("./fixtures/cv-cases/", import.meta.url);
const requiredCases = [
  "01-standard.txt",
  "02-flattened-pdf.txt",
  "03-no-headings.txt",
  "04-multilingual-certifications.txt",
];

test("keeps representative CV parsing cases available", async () => {
  const files = (await readdir(fixtureRoot)).sort();
  assert.deepEqual(files, requiredCases);
  for (const file of files) {
    const content = await readFile(join(fixtureRoot.pathname, file), "utf8");
    assert.ok(content.length > 180, `${file} doit contenir un CV exploitable`);
    assert.match(content, /@example\.test/);
    assert.match(content, /\d{4}/);
  }
});

test("covers the failure modes found during real CV review", async () => {
  const corpus = await Promise.all(requiredCases.map((file) => readFile(join(fixtureRoot.pathname, file), "utf8")));
  const all = corpus.join("\n").toLowerCase();
  assert.match(all, /profil|summary/);
  assert.match(all, /langues?|languages?/);
  assert.match(all, /certification/);
  assert.match(all, /power bi|react|sql/);
  assert.match(all, /présent|present/);
});
