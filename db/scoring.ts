export const SCORE_WEIGHTS = {
  skills: 30,
  title: 15,
  experience: 15,
  education: 10,
  location: 10,
  contract: 10,
  languages: 5,
  sector: 3,
  salary: 2,
} as const;

export const EDUCATION_LEVELS = [
  "Bac",
  "Bac+1",
  "Bac+2",
  "Bac+3",
  "Bac+4",
  "Bac+5",
  "Bac+6",
  "Bac+7",
  "Bac+8 et plus",
] as const;

export type ScoringProfile = {
  target_title: string;
  location: string;
  contract_type: string;
  skills: string;
  experience_level: string;
  education_level: string;
  languages: string;
  sectors: string;
  salary_min: number;
};

type ApplicationInput = Record<string, unknown>;

const EXPERIENCE_RANK: Record<string, number> = {
  "Débutant": 0,
  "1-3 ans": 1,
  "3-5 ans": 2,
  "5+ ans": 3,
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function tokens(value: unknown) {
  return normalize(value).split(/[,;/|]/).map((item) => item.trim()).filter(Boolean);
}

function overlapRatio(wanted: unknown, offered: unknown) {
  const expected = tokens(wanted);
  const available = tokens(offered);
  if (!expected.length || !available.length) return 0;
  const matches = expected.filter((item) => available.some((candidate) => candidate.includes(item) || item.includes(candidate)));
  return matches.length / expected.length;
}

function includesEither(left: unknown, right: unknown) {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function educationRank(value: unknown) {
  const normalized = normalize(value);
  if (!normalized) return -1;
  if (normalized.includes("doctorat")) return 8;
  if (normalized === "bac") return 0;
  const match = normalized.match(/bac\s*\+\s*(\d+)/);
  return match ? Math.min(8, Number(match[1])) : -1;
}

function valueFrom(body: ApplicationInput, camelCase: string, snakeCase: string) {
  return body[camelCase] ?? body[snakeCase] ?? "";
}

export function calculateScore(profile: ScoringProfile | null, body: ApplicationInput) {
  if (!profile) return { score: null, breakdown: null };

  const experienceRequired = String(valueFrom(body, "experienceRequired", "experience_required") ?? "").trim();
  const educationRequired = valueFrom(body, "educationRequired", "education_required");
  const salary = Math.max(0, Number(valueFrom(body, "salaryMin", "salary_min")) || 0);
  const requiredExperienceRank = EXPERIENCE_RANK[experienceRequired] ?? -1;
  const profileExperienceRank = EXPERIENCE_RANK[profile.experience_level] ?? -1;
  const requiredEducationRank = educationRank(educationRequired);
  const profileEducationRank = educationRank(profile.education_level);
  const location = valueFrom(body, "location", "location");

  const breakdown = {
    skills: Math.round(overlapRatio(profile.skills, valueFrom(body, "requiredSkills", "required_skills")) * SCORE_WEIGHTS.skills),
    title: includesEither(profile.target_title, valueFrom(body, "role", "role")) ? SCORE_WEIGHTS.title : 0,
    experience: requiredExperienceRank >= 0 && profileExperienceRank >= requiredExperienceRank ? SCORE_WEIGHTS.experience : 0,
    education: requiredEducationRank >= 0 && profileEducationRank >= requiredEducationRank ? SCORE_WEIGHTS.education : 0,
    location: includesEither(profile.location, location) || normalize(location).includes("télétravail") || normalize(location).includes("remote") ? SCORE_WEIGHTS.location : 0,
    contract: normalize(profile.contract_type) && normalize(profile.contract_type) === normalize(valueFrom(body, "contractType", "contract_type")) ? SCORE_WEIGHTS.contract : 0,
    languages: Math.round(overlapRatio(profile.languages, valueFrom(body, "languages", "languages")) * SCORE_WEIGHTS.languages),
    sector: tokens(profile.sectors).some((sector) => normalize(valueFrom(body, "sector", "sector")).includes(sector)) ? SCORE_WEIGHTS.sector : 0,
    salary: !profile.salary_min || !salary || salary >= profile.salary_min ? SCORE_WEIGHTS.salary : 0,
  };

  return {
    score: Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0))),
    breakdown,
  };
}

function aiEndpoint() {
  const base = String(process.env.AI_BASE_URL ?? "").trim().replace(/\/$/, "");
  return base ? `${base}${base.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions"}` : "";
}

/** Uses the configured OpenAI-compatible model when available, while keeping the
 * explainable weighted score as a deterministic safety net. Every AI value is
 * clamped to the same database weights before being persisted. */
export async function calculateScoreWithAI(profile: ScoringProfile | null, body: ApplicationInput) {
  const fallback = calculateScore(profile, body);
  const endpoint = aiEndpoint();
  if (!profile || !endpoint) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}) },
      body: JSON.stringify({
        model: String(process.env.AI_MODEL ?? "llama-3.1-8b-instant"), temperature: 0, max_tokens: 300,
        messages: [
          { role: "system", content: `Évalue la compatibilité entre ce profil et cette offre. Réponds uniquement en JSON valide avec les clés ${Object.keys(SCORE_WEIGHTS).join(",")}. Chaque valeur doit être un entier entre 0 et son maximum: ${JSON.stringify(SCORE_WEIGHTS)}. N'utilise que les informations fournies.` },
          { role: "user", content: JSON.stringify({ profile, offer: body }) },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = String(payload.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const breakdown = Object.fromEntries(Object.entries(SCORE_WEIGHTS).map(([key, maximum]) => [key, Math.max(0, Math.min(maximum, Math.round(Number(parsed[key]) || 0)))])) as Record<keyof typeof SCORE_WEIGHTS, number>;
    return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
  } catch { return fallback; }
  finally { clearTimeout(timeout); }
}
