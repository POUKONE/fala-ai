import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const files = (await readdir(root)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
if (!files.length) throw new Error("Aucune migration Supabase trouvée.");
for (const [index, file] of files.entries()) {
  const expected = `${String(index + 1).padStart(4, "0")}_`;
  if (!file.startsWith(expected)) throw new Error(`Migrations Supabase non séquentielles : ${file} (attendu ${expected}...).`);
  const sql = await readFile(join(root, file), "utf8");
  if (!sql.trim()) throw new Error(`Migration vide : ${file}`);
}
console.log(`Migrations Supabase valides : ${files.join(", ")}`);
