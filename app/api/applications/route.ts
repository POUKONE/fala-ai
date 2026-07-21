import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db/d1";

export const dynamic = "force-dynamic";

const STATUSES = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];
const weights = { skills: 30, experience: 15, education: 10, location: 10, contract: 10, availability: 10, languages: 5, sector: 5, salary: 5 };

type ProfileRow = { target_title:string; location:string; contract_type:string; skills:string; experience_level:string; education_level:string; languages:string; sectors:string; salary_min:number };

const tokens = (value: string) => value.toLowerCase().split(/[,;/|]/).map((v) => v.trim()).filter(Boolean);
const overlapRatio = (wanted: string, offered: string) => {
  const a = tokens(wanted); const b = tokens(offered);
  if (!a.length || !b.length) return 0;
  return a.filter((item) => b.some((candidate) => candidate.includes(item) || item.includes(candidate))).length / a.length;
};

function calculateScore(profile: ProfileRow | null, body: Record<string, unknown>) {
  if (!profile) return { score: null, breakdown: null };
  const text = (key: string) => String(body[key] ?? "").trim();
  const salary = Number(body.salaryMin ?? 0) || 0;
  const breakdown = {
    skills: Math.round(overlapRatio(profile.skills, text("requiredSkills")) * weights.skills),
    experience: profile.experience_level && profile.experience_level === text("experienceRequired") ? weights.experience : 0,
    education: profile.education_level && profile.education_level === text("educationRequired") ? weights.education : 0,
    location: profile.location && (text("location").toLowerCase().includes(profile.location.toLowerCase()) || text("location").toLowerCase().includes("télétravail")) ? weights.location : 0,
    contract: profile.contract_type && profile.contract_type === text("contractType") ? weights.contract : 0,
    availability: text("nextActionAt") ? weights.availability : 0,
    languages: Math.round(overlapRatio(profile.languages, text("languages")) * weights.languages),
    sector: profile.sectors && tokens(profile.sectors).some((s) => text("sector").toLowerCase().includes(s)) ? weights.sector : 0,
    salary: !profile.salary_min || !salary || salary >= profile.salary_min ? weights.salary : 0,
  };
  return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
}

async function emailOr401() {
  const user = await getChatGPTUser();
  return user?.email ?? null;
}

export async function GET() {
  const email = await emailOr401();
  if (!email) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const result = await getD1().prepare("SELECT * FROM applications WHERE user_email = ? ORDER BY updated_at DESC, id DESC").bind(email).all();
  return Response.json({ applications: result.results });
}

export async function POST(request: Request) {
  const email = await emailOr401();
  if (!email) return Response.json({ error: "Authentification requise" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const text = (key: string) => String(body[key] ?? "").trim();
  if (!text("company") || !text("role")) return Response.json({ error: "Entreprise et poste requis" }, { status: 400 });
  const status = STATUSES.includes(text("status")) ? text("status") : "À préparer";
  const profile = await getD1().prepare("SELECT * FROM profiles WHERE user_email = ?").bind(email).first<ProfileRow>();
  const assessment = calculateScore(profile ?? null, body);
  const now = new Date().toISOString();
  const result = await getD1().prepare(`INSERT INTO applications
    (user_email,company,role,location,contract_type,source,required_skills,experience_required,education_required,languages,sector,salary_min,status,applied_at,next_action_at,interview_at,score,score_breakdown,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
    .bind(email,text("company"),text("role"),text("location"),text("contractType"),text("source") || "Ajout manuel",text("requiredSkills"),text("experienceRequired"),text("educationRequired"),text("languages"),text("sector"),Math.max(0,Number(body.salaryMin ?? 0)||0),status,text("appliedAt")||null,text("nextActionAt")||null,text("interviewAt")||null,assessment.score,assessment.breakdown ? JSON.stringify(assessment.breakdown) : null,text("notes"),now,now).first();
  return Response.json({ application: result }, { status: 201 });
}
