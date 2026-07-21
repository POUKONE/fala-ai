import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";
import { recordActivity, touchUser } from "../../../db/user-activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  await touchUser(user);
  const row = await getD1().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(user.email).first();
  return Response.json({ profile: row ?? null });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const email = user.email;
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
  await recordActivity(user,"profile.updated","Profil de scoring mis à jour");
  return Response.json({ ok: true });
}
