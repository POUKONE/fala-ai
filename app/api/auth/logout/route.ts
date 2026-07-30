import { cookies } from "next/headers"; import { getPostgresDb } from "../../../../db/postgres"; import { SESSION_COOKIE } from "../../../email-auth";
export const dynamic = "force-dynamic";
async function clearSession() { const token=(await cookies()).get(SESSION_COOKIE)?.value; if(token)await getPostgresDb().prepare("DELETE FROM auth_sessions WHERE token=?").bind(token).run(); }
function cleared(response: Response) { response.headers.append("Set-Cookie",`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`); return response; }
export async function POST() { await clearSession(); return cleared(Response.json({ok:true})); }
export async function GET(request: Request) { await clearSession(); const target = new URL(request.url).searchParams.get("return_to") || "/"; const safe = target.startsWith("/") && !target.startsWith("//") ? target : "/"; return cleared(new Response(null, { status:303, headers:{ location:new URL(safe, request.url).toString() } })); }
