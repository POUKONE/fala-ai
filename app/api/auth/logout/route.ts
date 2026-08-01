import { cookies } from "next/headers";
import { getPostgresDb } from "../../../../db/postgres";
import { SESSION_COOKIE } from "../../../email-auth";

export const dynamic = "force-dynamic";

/**
 * Session invalidation is best effort: the browser cookie must still be
 * expired when the database is temporarily unavailable. Previously an error
 * from Postgres aborted the handler before Set-Cookie was sent, leaving the
 * user apparently logged in forever.
 */
async function clearSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return;
  try {
    await getPostgresDb().prepare("DELETE FROM auth_sessions WHERE token=?").bind(token).run();
  } catch (error) {
    console.error("[Fala AI] logout session cleanup failed", error);
  }
}

function cleared(response: Response, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  await clearSession();
  return cleared(Response.json({ ok: true }), request);
}

export async function GET(request: Request) {
  await clearSession();
  const target = new URL(request.url).searchParams.get("return_to") || "/auth";
  const safe = target.startsWith("/") && !target.startsWith("//") ? target : "/auth";
  return cleared(new Response(null, {
    status: 303,
    headers: { location: new URL(safe, request.url).toString() },
  }), request);
}
