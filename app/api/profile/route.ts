import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";
import { recordActivity, touchUser } from "../../../db/user-activity";
import { calculateScoreWithAI, type ScoringProfile } from "../../../db/scoring";
import { enforceRateLimit, getAccountState } from "../../../db/security";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  await touchUser(user);
  const row = await getPostgresDb().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(user.email).first();
  return Response.json({ profile: row ?? null });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  if (!await enforceRateLimit(user.email,"profile-update",20,3600)) return Response.json({error:"Limite de modifications atteinte"},{status:429});
  const email = user.email;
  const body = await request.json() as Record<string, unknown>;
  const value = (key: string) => String(body[key] ?? "").trim();
  const listValue = (key: string, maximum: number) => Array.from(new Set(value(key).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean))).slice(0, maximum).join(", ");
  const targetTitle = listValue("targetTitle", 3);
  const contractType = listValue("contractType", 3);
  const sectors = listValue("sectors", 5);
  if (!targetTitle) return Response.json({ error: "Saisissez au moins un poste recherché." }, { status: 400 });
  if (!contractType) return Response.json({ error: "Sélectionnez au moins un type de contrat." }, { status: 400 });
  const salaryMin = Math.max(0, Number(body.salaryMin ?? 0) || 0);
  const now = new Date().toISOString();
  await getPostgresDb().prepare(`INSERT INTO profiles
    (user_email,target_title,location,contract_type,skills,experience_level,education_level,languages,sectors,salary_min,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_email) DO UPDATE SET target_title=excluded.target_title,location=excluded.location,
    contract_type=excluded.contract_type,skills=excluded.skills,experience_level=excluded.experience_level,
    education_level=excluded.education_level,languages=excluded.languages,sectors=excluded.sectors,
    salary_min=excluded.salary_min,updated_at=excluded.updated_at`)
    .bind(email,targetTitle,value("location"),contractType,value("skills"),value("experienceLevel"),value("educationLevel"),value("languages"),sectors,salaryMin,now).run();
  const profile: ScoringProfile = {
    target_title:targetTitle, location:value("location"), contract_type:contractType,
    skills:value("skills"), experience_level:value("experienceLevel"), education_level:value("educationLevel"),
    languages:value("languages"), sectors, salary_min:salaryMin,
  };
  const existing = await getPostgresDb().prepare("SELECT * FROM applications WHERE user_email = ?").bind(email).all<Record<string, unknown>>();
  if (existing.results.length) {
    const assessed = await Promise.all(existing.results.map(async (application) => ({ application, assessment: await calculateScoreWithAI(profile, application) })));
    await getPostgresDb().batch(assessed.map(({ application, assessment }) => getPostgresDb().prepare("UPDATE applications SET score=?, score_breakdown=?, updated_at=? WHERE id=? AND user_email=?")
      .bind(assessment.score, assessment.breakdown ? JSON.stringify(assessment.breakdown) : null, now, application.id, email)));
  }
  await recordActivity(user,"profile.updated","Profil de scoring mis à jour");
  return Response.json({ ok: true, recalculated: existing.results.length });
}
