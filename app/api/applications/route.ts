import { getChatGPTUser } from "../../chatgpt-auth";
import { getPostgresDb } from "../../../db/postgres";
import { recordActivity, touchUser } from "../../../db/user-activity";
import { calculateScoreWithAI, type ScoringProfile } from "../../../db/scoring";
import { enforceRateLimit, getAccountState } from "../../../db/security";

export const dynamic = "force-dynamic";

const STATUSES = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  await touchUser(user);
  const db = getPostgresDb();
  const [result,profile] = await Promise.all([
    db.prepare("SELECT * FROM applications WHERE user_email = ? ORDER BY updated_at DESC, id DESC").bind(user.email).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM profiles WHERE user_email = ?").bind(user.email).first<ScoringProfile>(),
  ]);
  if (!profile) return Response.json({ applications: result.results });
  const rows = result.results as Array<Record<string, unknown>>;
  const applications = rows.map((application) => ({ ...application, score: application.score ?? null, score_breakdown: application.score_breakdown ?? null }));
  const changed = applications.filter((application) => application.score === null || !application.score_breakdown);
  if (changed.length) {
    const assessed = await Promise.all(changed.map(async (application) => ({ application, assessment: await calculateScoreWithAI(profile, application) })));
    await db.batch(assessed.map(({ application, assessment }) => {
      application.score = assessment.score; application.score_breakdown = assessment.breakdown ? JSON.stringify(assessment.breakdown) : null;
      return db.prepare("UPDATE applications SET score=?,score_breakdown=? WHERE id=? AND user_email=?").bind(application.score,application.score_breakdown,application.id,user.email);
    }));
  }
  return Response.json({ applications });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  if (!await enforceRateLimit(user.email,"application-create",20,3600)) return Response.json({error:"Limite de créations atteinte"},{status:429});
  const email = user.email;
  const body = await request.json() as Record<string, unknown>;
  const text = (key: string) => String(body[key] ?? "").trim();
  if (!text("company") || !text("role")) return Response.json({ error: "Entreprise et poste requis" }, { status: 400 });
  const status = STATUSES.includes(text("status")) ? text("status") : "À préparer";
  const profile = await getPostgresDb().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(email).first<ScoringProfile>();
  const assessment = await calculateScoreWithAI(profile ?? null, body);
  const now = new Date().toISOString();
  const db = getPostgresDb();
  await db.prepare(`INSERT INTO applications
    (user_email,company,role,location,contract_type,source,required_skills,experience_required,education_required,languages,sector,salary_min,status,applied_at,next_action_at,interview_at,score,score_breakdown,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(email,text("company"),text("role"),text("location"),text("contractType"),text("source") || "Ajout manuel",text("requiredSkills"),text("experienceRequired"),text("educationRequired"),text("languages"),text("sector"),Math.max(0,Number(body.salaryMin ?? 0)||0),status,text("appliedAt")||null,text("nextActionAt")||null,text("interviewAt")||null,assessment.score,assessment.breakdown ? JSON.stringify(assessment.breakdown) : null,text("notes"),now,now).run();
  const result = await db.prepare("SELECT * FROM applications WHERE user_email=? ORDER BY id DESC LIMIT 1").bind(email).first();
  await recordActivity(user,"application.created",`${text("role")} · ${text("company")}`);
  return Response.json({ application: result }, { status: 201 });
}
