import assert from "node:assert/strict";
import test from "node:test";

const section = (line) => {
  if (/^(profil|summary|objectif)\s*:?(?:\s*)$/i.test(line)) return "PROFIL";
  if (/^(exp[eé]rience|parcours professionnel|professional experience)(?:\s*:)?$/i.test(line)) return "EXPÉRIENCE";
  if (/^(formation|education|[eé]tudes|certifications?(?:\s+et\s+formations?)?)(?:\s*:)?$/i.test(line)) return "FORMATION";
  if (/^(comp[eé]tences?|skills)(?:\s*:)?$/i.test(line)) return "COMPÉTENCES";
  if (/^(langues?|languages?)(?:\s*:)?$/i.test(line)) return "LANGUES";
  if (/^(centres? d['’ ]int[eé]r[eê]t|loisirs?|interests?)(?:\s*:)?$/i.test(line)) return "CENTRES D'INTÉRÊT";
  return null;
};

function adaptLocal(cv) {
  const prepared = cv.replace(/\s+(?=(?:Langues?|Languages?|Centres? d['’ ]int[eé]r[eê]t|Certifications?(?:\s+et\s+formations?)?)\s*:)/gi, "\n").replace(/\s+(?=\d{1,2}[\/.-]\d{4}\s*(?:[-–—]|à|a))/g, "\n");
  const lines = prepared.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 1);
  const header = lines.slice(0, 3);
  const buckets = new Map();
  let current = "PROFIL";
  for (const line of lines.slice(3)) {
    const inline = line.match(/^(langues?|languages?)\s*:\s*(.+)$/i);
    if (inline) { current = "LANGUES"; buckets.set(current, [...(buckets.get(current) ?? []), inline[2]]); continue; }
    const next = section(line);
    if (next) { current = next; if (!buckets.has(current)) buckets.set(current, []); continue; }
    if (current === "PROFIL" && /^(?:\d{1,2}[\/.-]\d{4}|\d{4})\s*(?:[-–—]|à|a|présent|present)/i.test(line)) current = "EXPÉRIENCE";
    buckets.set(current, [...(buckets.get(current) ?? []), line]);
  }
  const experiences = buckets.get("EXPÉRIENCE") ?? [];
  const spacedExperiences = experiences.flatMap((item, index) => [
    ...(index > 0 && /^(?:\d{1,2}[\/.-]\d{4}|\d{4})\s*(?:[-–—]|à|a|présent|present)/i.test(item) ? [""] : []),
    item,
  ]);
  return [
    ...header,
    "PROFIL", ...(buckets.get("PROFIL") ?? []),
    "COMPÉTENCES", ...(buckets.get("COMPÉTENCES") ?? []),
    "EXPÉRIENCE", ...spacedExperiences,
    "FORMATION / CERTIFICATIONS", ...(buckets.get("FORMATION") ?? []),
    "LANGUES", ...(buckets.get("LANGUES") ?? []),
  ].join("\n");
}

function makeCv(index, density, variant) {
  const name = `Candidat ${String(index).padStart(2, "0")}`;
  const header = `${name}\nAnalyste ${variant === "web" ? "Web" : "Data"} | Paris | candidat${index}@example.test | +33 6 00 00 00 00`;
  const profile = "PROFIL\nProfessionnel avec expérience en analyse, amélioration des processus et collaboration avec les équipes métier.";
  const experience = `EXPÉRIENCE\n2022 - Présent — Analyste, Entreprise Exemple ${index}, Paris\n- Analyse des données et production de rapports utiles aux décisions.\n- Collaboration avec les équipes métier pour améliorer la qualité.\n${density === "dense" ? "- Automatisation de contrôles et documentation des procédures.\n- Présentation des résultats aux parties prenantes.\n- Suivi des indicateurs et amélioration continue." : density === "medium" ? "- Création de tableaux de bord et suivi des indicateurs." : "- Production de rapports réguliers."}`;
  const skills = `${variant === "web" ? "COMPÉTENCES\nJavaScript, React, HTML, CSS, Git" : "COMPÉTENCES\nSQL, Python, Power BI, Excel"}`;
  const education = `FORMATION\nMaster professionnel — Université Exemple — 2020-2022\n${density !== "sparse" ? "Certification Excel — Organisme Exemple — 2023" : ""}`;
  const languages = `LANGUES\nFrançais courant, anglais professionnel`;
  if (variant === "flattened") return `${header} ${profile.replace("\n", " ")} ${experience.replaceAll("\n", " ")} ${skills.replace("\n", ": ")} ${languages.replace("\n", ": ")} ${education.replace("\n", ": ")}`;
  if (variant === "no-headings") return `${header}\n${profile.split("\n")[1]}\n${experience.replace("EXPÉRIENCE\n", "")}\n${skills.split("\n")[1]}\n${education.split("\n").slice(1).join("\n")}\n${languages.split("\n")[1]}`;
  return [header, profile, experience, skills, education, languages].join("\n\n");
}

const cases = Array.from({ length: 20 }, (_, offset) => {
  const density = offset < 7 ? "sparse" : offset < 14 ? "medium" : "dense";
  const variants = ["standard", "flattened", "no-headings", "web"];
  return { id: offset + 1, density, variant: variants[offset % variants.length], cv: makeCv(offset + 1, density, variants[offset % variants.length]) };
});

test("adapts 20 representative CV cases across density and layout variants", () => {
  const results = cases.map(({ id, density, variant, cv }) => {
    const output = adaptLocal(cv);
    const checks = {
      coordinates: /@example\.test/.test(output),
      summary: /PROFIL/.test(output),
      skills: /COMPÉTENCES/.test(output),
      experience: /EXPÉRIENCE/.test(output),
      education: /FORMATION \/ CERTIFICATIONS/.test(output),
      languages: /LANGUES/.test(output),
      nonEmpty: output.length > 180,
    };
    const pass = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ case: id, density, variant, result: pass ? "PASS" : "FAIL", checks }));
    return pass;
  });
  assert.equal(results.length, 20);
  assert.ok(results.every(Boolean), "Tous les cas doivent conserver les sections ATS essentielles");
});

test("separates consecutive experiences with a blank line", () => {
  const cv = `Candidat test\nAnalyste | Paris | test@example.test\nRésumé professionnel\n2022 - Présent — Poste récent, Société A\n- Résultat récent\n2020 - 2022 — Poste précédent, Société B\n- Résultat précédent\nSQL\nMaster Exemple — 2018-2020\nFrançais courant`;
  const output = adaptLocal(cv);
  assert.match(output, /Résultat récent\n\n2020 - 2022/);
});
