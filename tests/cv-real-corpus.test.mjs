import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Corpus local fourni par l'utilisateur. Les fichiers restent dans Downloads :
// le test vérifie le lecteur sans copier les coordonnées personnelles dans le
// dépôt ni les envoyer à un service distant.
const downloads = join(process.env.HOME ?? "/Users/poukoneyogneibrahima", "Downloads");
const patterns = [
  /^Cv alternance grace it\.pdf$/i,
  /^CV de Marc BEAS.*\.pdf$/i,
  /^CV DURAND\.UGA\.STAGE\.pdf$/i,
  /^cv stage france final(?: 2)?\.pdf$/i,
  /^CV_Administrateur .*\.pdf$/i,
  /^CV_Alex_Fouha.*\.pdf$/i,
  /^CV_Alt_Khaleb.*\.pdf$/i,
  /^CV-NGAHA R\.pdf$/i,
  /^CVlisa\.pdf$/i,
  /^Steve Wafo CV\.pdf$/i,
  /^Synthia_MORNONSOUBOH.*\.pdf$/i,
  /^Urielle_Mohou.*\.pdf$/i,
];

const files = existsSync(downloads)
  ? readdirSync(downloads).filter((name) => patterns.some((pattern) => pattern.test(name)))
  : [];

async function extract(file) {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(join(downloads, file))),
    useSystemFonts: true,
    disableWorker: true,
  }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.filter((item) => String(item.str ?? "").trim()).map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

test("lit le corpus PDF réel fourni sans perdre les CV denses", async (t) => {
  if (!files.length) {
    t.skip("Corpus local absent : test exécuté uniquement sur la machine de développement.");
    return;
  }
  assert.ok(files.length >= 10, `Au moins 10 CV du corpus doivent être disponibles (${files.length})`);
  const results = [];
  for (const file of files) {
    const text = await extract(file);
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const checks = {
      content: text.length >= 900,
      dates: /(?:19|20)\d{2}/.test(text),
      sections: /(competences?|skills|experience|formation|education|profil|objectif|projet)/.test(normalized),
      contactOrName: /@|\+?\d[\d .()-]{6,}/.test(text),
      noReplacementFlood: (text.match(/�/g) ?? []).length < 6,
    };
    const pass = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ file, pages: text.split("\n").length, chars: text.length, result: pass ? "PASS" : "FAIL", checks }));
    results.push(pass);
  }
  assert.ok(results.every(Boolean), "Chaque CV réel doit conserver un texte exploitable");
});

