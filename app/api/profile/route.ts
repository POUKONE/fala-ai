import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";

export const dynamic = "force-dynamic";

async function currentEmail() {
  const user = await getChatGPTUser();
  return user?.email ?? null;
}

export async function GET() {
  const email = await currentEmail();
  if (!email) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const row = await getD1().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(email).first();
  return Response.json({ profile: row ?? null });
}

export async function PUT(request: Request) {
  const email = await currentEmail();
  if (!email) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const value = (key: string) => String(body[key] ?? "").trim();
  const salaryMin = Math.max(0, Number(body.salaryMin ?? 0) || 0);
  const now = new Date().toISOString();
  await getD1().prepare(`INSERT INTO profiles
    (user_email,target_title,location,contract_type,skills,experience_level,education_level,languages,sectors,salary_min,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_email) DO UPDATE SET target_title=excluded.target_title,location=excluded.location,
    contract_type=excluded.contract_type,skills=excluded.skills,experience_level=excluded.experience_level,
    education_level=excluded.education_level,languages=excluded.languages,sectors=excluded.sectors,
    salary_min=excluded.salary_min,updated_at=excluded.updated_at`)
    .bind(email,value("targetTitle"),value("location"),value("contractType"),value("skills"),value("experienceLevel"),value("educationLevel"),value("languages"),value("sectors"),salaryMin,now).run();
  return Response.json({ ok: true });
}
