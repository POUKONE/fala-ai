import { NextRequest, NextResponse } from "next/server";

const CSRF_COOKIE = "fala_csrf";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameToken(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function issueToken(response: NextResponse, request: NextRequest) {
  if (request.cookies.get(CSRF_COOKIE)?.value) return;
  response.cookies.set({ name: CSRF_COOKIE, value: crypto.randomUUID() + crypto.randomUUID().replaceAll("-", ""), httpOnly: false, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
}

export default function proxy(request: NextRequest) {
  const response = NextResponse.next();
  issueToken(response, request);
  // Never let a browser restore a stale authenticated workspace after
  // logout/back navigation. The server APIs remain protected as well, but
  // this prevents the old HTML shell from being reused by the bfcache.
  if (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/admin") {
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
  }
  if (request.nextUrl.pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const cookieToken = request.cookies.get(CSRF_COOKIE)?.value ?? "";
    const headerToken = request.headers.get("x-csrf-token") ?? "";
    if (!sameToken(cookieToken, headerToken)) {
      return NextResponse.json({ error: "Jeton CSRF invalide ou manquant." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }
  return response;
}

// Run on page requests too, so the browser receives its CSRF cookie before
// the first form submission (auth pages do not make an initial API request).
export const config = { matcher: ["/:path*"] };
