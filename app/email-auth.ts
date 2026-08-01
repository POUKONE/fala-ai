import { cookies } from "next/headers";
import { getPostgresDb } from "../db/postgres";
const COOKIE = "fala_session"; const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function hashPassword(password: string, salt = crypto.randomUUID()) { const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256); return `${salt}:${hex(bits)}`; }
export async function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = (await hashPassword(password, salt)).split(":")[1];
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
export async function createSession(email: string) { const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", ""); const now = new Date(); const expires = new Date(now.getTime() + 2592000000); const db = getPostgresDb(); try { await db.prepare("INSERT INTO auth_sessions (token,user_email,created_at,expires_at) VALUES (?,?,?,?)").bind(token, email, now.toISOString(), expires.toISOString()).run(); } catch (error) { if (!String(error).includes("no such table: auth_sessions")) throw error; await db.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY NOT NULL,user_email TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL)").run(); await db.prepare("INSERT INTO auth_sessions (token,user_email,created_at,expires_at) VALUES (?,?,?,?)").bind(token, email, now.toISOString(), expires.toISOString()).run(); } return { token, expires }; }
export async function invalidateSessions(email: string) { await getPostgresDb().prepare("DELETE FROM auth_sessions WHERE lower(user_email)=lower(?)").bind(email).run(); }
export async function rotateSession(email: string) {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const now = new Date();
  const expires = new Date(now.getTime() + 2592000000);
  const row = await getPostgresDb().prepare(`
    WITH deleted AS (DELETE FROM auth_sessions WHERE lower(user_email)=lower(?)),
    updated AS (UPDATE users SET last_seen_at=? WHERE lower(email)=lower(?) RETURNING email),
    created AS (INSERT INTO auth_sessions (token,user_email,created_at,expires_at) VALUES (?,?,?,?,?) RETURNING token,expires_at)
    SELECT token,expires_at FROM created
  `).bind(email, now.toISOString(), email, token, email, now.toISOString(), expires.toISOString()).first<{token:string;expires_at:string}>();
  if (!row) throw new Error("Impossible de créer la session");
  return { token: row.token, expires };
}
export async function getEmailSession() { const value = (await cookies()).get(COOKIE)?.value; if (!value) return null; const s = await getPostgresDb().prepare("SELECT u.email,u.display_name FROM auth_sessions s JOIN users u ON lower(u.email)=lower(s.user_email) WHERE s.token=? AND s.expires_at>? AND u.suspended_at IS NULL").bind(value, new Date().toISOString()).first<{email:string;display_name:string}>(); return s ? { email: s.email, displayName: s.display_name, fullName: s.display_name } : null; }
export const SESSION_COOKIE = COOKIE;
