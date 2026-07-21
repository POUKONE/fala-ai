import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";
import { recordActivity, touchUser } from "../../../db/user-activity";
import { calculateScore, type ScoringProfile } from "../../../db/scoring";

export const dynamic = "force-dynamic";

const STATUSES = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  await touchUser(user);
  const db = getD1();
  const [result,profile] = await Promise.all([
    db.prepare("SELECT * FROM applications WHERE user_email = ? ORDER BY updated_at DESC, id DESC").bind(user.email).all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM profiles WHERE user_email = ?").bind(user.email).first<ScoringProfile>(),
  ]);
  if (!profile) return Response.json({ applications: result.results });
  const applications = result.results.map((application) => {
    const assessment = calculateScore(profile, application);
    return { ...application, score: assessment.score, score_breakdown: assessment.breakdown ? JSON.stringify(assessment.breakdown) : null };
  });
  const changed = applications.filter((application,index) => application.score !== result.results[index]?.score || application.score_breakdown !== result.results[index]?.score_breakdown);
  if (changed.length) {
    await db.batch(changed.map((application) => db.prepare("UPDATE applications SET score=?,score_breakdown=? WHERE id=? AND user_email=?")
      .bind(application.score,application.score_breakdown,application.id,user.email)));
  }
  return Response.json({ applications });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const email = user.email;
  const body = await request.json() as Record<string, unknown>;
  const text = (key: string) => String(body[key] ?? "").trim();
  if (!text("company") || !text("role")) return Response.json({ error: "Entreprise et poste requis" }, { status: 400 });
  const status = STATUSES.includes(text("status")) ? text("status") : "À préparer";
  const profile = await getD1().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(email).first<ScoringProfile>();
  const assessment = calculateScore(profile ?? null, body);
  const now = new Date().toISOString();
  const result = await getD1().prepare(`INSERT INTO applications
    (user_email,company,role,location,contract_type,source,required_skills,experience_required,education_required,languages,sector,salary_min,status,applied_at,next_action_at,interview_at,score,score_breakdown,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
    .bind(email,text("company"),text("role"),text("location"),text("contractType"),text("source") || "Ajout manuel",text("requiredSkills"),text("experienceRequired"),text("educationRequired"),text("languages"),text("sector"),Math.max(0,Number(body.salaryMin ?? 0)||0),status,text("appliedAt")||null,text("nextActionAt")||null,text("interviewAt")||null,assessment.score,assessment.breakdown ? JSON.stringify(assessment.breakdown) : null,text("notes"),now,now).first();
  await recordActivity(user,"application.created",`${text("role")} · ${text("company")}`);
  return Response.json({ application: result }, { status: 201 });
}
