import { getChatGPTUser } from "../../../chatgpt-auth";
import { getPostgresDb } from "../../../../db/postgres";
import { enforceRateLimit } from "../../../../db/security";
import { recordActivity } from "../../../../db/user-activity";

export const dynamic = "force-dynamic";

const value = (row: unknown, key: string) => row && typeof row === "object" ? (row as Record<string, unknown>)[key] : "";
const csvCell = (input: unknown) => {
  const text = typeof input === "string" ? input : input == null ? "" : JSON.stringify(input);
  return '"' + text.replaceAll('"', '""') + '"';
};
const fields = ["id", "company", "role", "location", "status", "score", "source", "required_skills", "experience_required", "education_required", "languages", "sector", "salary_min", "applied_at", "next_action_at", "interview_at", "notes", "created_at", "updated_at", "full_record"];

function applicationsCsv(rows: unknown[]) {
  const data = rows.map((row) => [...fields.slice(0, -1).map((field) => value(row, field)), row].map(csvCell).join(","));
  return "\uFEFF" + [fields.join(","), ...data].join("\r\n") + "\r\n";
}

const pdfSafe = (input: unknown) => String(input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ").replace(/[\\()]/g, (char) => "\\" + char);
function applicationsPdf(rows: unknown[]) {
  const lines = ["FALA AI - MES CANDIDATURES", "Export des candidatures", "", "Entreprise | Poste | Statut | Score | Localisation", "-".repeat(92)];
  rows.forEach((row) => {
    lines.push(String(value(row, "company")) + " | " + String(value(row, "role")) + " | " + String(value(row, "status")) + " | " + String(value(row, "score") || "-") + "/100 | " + String(value(row, "location")));
    if (value(row, "next_action_at")) lines.push("  Prochaine action : " + String(value(row, "next_action_at")));
  });
  const contentLines = ["0.08 0.22 0.38 rg", "BT /F2 18 Tf 50 750 Td (FALA AI - MES CANDIDATURES) Tj ET", "0.25 0.25 0.25 rg"];
  lines.slice(1, 48).forEach((line, index) => contentLines.push("BT /" + (index === 2 ? "F2" : "F1") + " " + (index === 2 ? "10" : "9") + " Tf 50 " + (720 - index * 15) + " Td (" + pdfSafe(line.slice(0, 110)) + ") Tj ET"));
  const content = contentLines.join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>", "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream"];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += String(index + 1) + " 0 obj\n" + object + "\nendobj\n"; });
  const xref = pdf.length;
  const entries = offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + entries + "\ntrailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return new TextEncoder().encode(pdf);
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if (!await enforceRateLimit(user.email, "data-export", 3, 3600)) return Response.json({ error: "Un export est déjà disponible. Réessayez plus tard." }, { status: 429 });
  const rows = await getPostgresDb().prepare("SELECT id,company,role,location,status,score,source,required_skills,experience_required,education_required,languages,sector,salary_min,applied_at,next_action_at,interview_at,notes,created_at,updated_at FROM applications WHERE user_email=? ORDER BY id").bind(user.email).all();
  await recordActivity(user, "privacy.export", "Export des candidatures généré");
  const date = new Date().toISOString().slice(0, 10);
  if (new URL(request.url).searchParams.get("format") === "pdf") return new Response(applicationsPdf(rows.results), { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"fala-ai-candidatures-" + date + ".pdf\"", "cache-control": "no-store" } });
  return new Response(applicationsCsv(rows.results), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"fala-ai-candidatures-" + date + ".csv\"", "cache-control": "no-store" } });
}
