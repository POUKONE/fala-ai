import { cookies } from "next/headers";
import { getD1 } from "../db/d1";
const COOKIE = "fala_session"; const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function hashPassword(password: string, salt = crypto.randomUUID()) { const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" }, key, 256); return `${salt}:${hex(bits)}`; }
export async function verifyPassword(password: string, stored: string) { const [salt, expected] = stored.split(":"); return Boolean(salt && expected && (await hashPassword(password, salt)).split(":")[1] === expected); }
export async function createSession(email: string) { const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", ""); const now = new Date(); const expires = new Date(now.getTime() + 2592000000); await getD1().prepare("INSERT INTO auth_sessions (token,user_email,created_at,expires_at) VALUES (?,?,?,?)").bind(token, email, now.toISOString(), expires.toISOString()).run(); return { token, expires }; }
export async function getEmailSession() { const value = (await cookies()).get(COOKIE)?.value; if (!value) return null; const s = await getD1().prepare("SELECT u.email,u.display_name FROM auth_sessions s JOIN users u ON lower(u.email)=lower(s.user_email) WHERE s.token=? AND s.expires_at>? AND u.suspended_at IS NULL").bind(value, new Date().toISOString()).first<{email:string;display_name:string}>(); return s ? { email: s.email, displayName: s.display_name, fullName: s.display_name } : null; }
export const SESSION_COOKIE = COOKIE;
