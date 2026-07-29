import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  consentVersion: text("consent_version"),
  consentedAt: text("consented_at"),
  suspendedAt: text("suspended_at"),
  suspensionReason: text("suspension_reason"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: text("email_verified_at"),
  verificationToken: text("verification_token"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: text("reset_token_expires_at"),
});
export const authSessions = sqliteTable("auth_sessions", { token: text("token").primaryKey(), userEmail: text("user_email").notNull(), createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull() });

export const activityEvents = sqliteTable("activity_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
});

export const profiles = sqliteTable("profiles", {
  userEmail: text("user_email").primaryKey(),
  targetTitle: text("target_title").notNull().default(""),
  location: text("location").notNull().default(""),
  contractType: text("contract_type").notNull().default(""),
  skills: text("skills").notNull().default(""),
  experienceLevel: text("experience_level").notNull().default(""),
  educationLevel: text("education_level").notNull().default(""),
  languages: text("languages").notNull().default(""),
  sectors: text("sectors").notNull().default(""),
  salaryMin: integer("salary_min").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const applications = sqliteTable("applications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  location: text("location").notNull().default(""),
  contractType: text("contract_type").notNull().default(""),
  source: text("source").notNull().default("Ajout manuel"),
  requiredSkills: text("required_skills").notNull().default(""),
  experienceRequired: text("experience_required").notNull().default(""),
  educationRequired: text("education_required").notNull().default(""),
  languages: text("languages").notNull().default(""),
  sector: text("sector").notNull().default(""),
  salaryMin: integer("salary_min").notNull().default(0),
  status: text("status").notNull().default("À préparer"),
  appliedAt: text("applied_at"),
  nextActionAt: text("next_action_at"),
  interviewAt: text("interview_at"),
  score: integer("score"),
  scoreBreakdown: text("score_breakdown"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const userRoles = sqliteTable("user_roles", {
  userEmail: text("user_email").notNull(),
  role: text("role").notNull(),
  grantedBy: text("granted_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  adminNote: text("admin_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const systemErrors = sqliteTable("system_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email"),
  route: text("route").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: text("window_start").notNull(),
  count: integer("count").notNull().default(0),
});
