import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Fala AI public shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Fala AI — Pilotez votre recherche d’emploi<\/title>/i);
  assert.match(html, /Ouverture de Fala AI/);
  assert.match(html, /name="description"/i);
  assert.match(html, /href="\/favicon\.svg"/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview|react-loading-skeleton/i);
});

test("le projet ne dépend plus de l'ancien squelette de prévisualisation", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Fala AI/);
  assert.match(layout, /Fala AI — Pilotez votre recherche d’emploi/);
  assert.doesNotMatch(page, /SkeletonPreview|_sites-preview|codex-preview/i);
  assert.doesNotMatch(layout, /_sites-preview|codex-preview/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const previewFiles = await readdir(new URL("app/_sites-preview", root));
  assert.deepEqual(previewFiles, []);
});
