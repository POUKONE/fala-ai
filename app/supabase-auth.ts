type AuthResponse = { access_token?: string; user?: { id: string; email?: string; user_metadata?: Record<string, unknown> }; error_description?: string; msg?: string; error?: string };

const url = () => String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const key = () => String(process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function supabasePasswordGrant(email: string, password: string): Promise<AuthResponse | null> {
  if (!url() || !key()) return null;
  let response: Response;
  try {
    response = await fetchWithTimeout(`${url()}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key(), "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  } catch (error) {
    console.error("[Fala AI] Supabase login unavailable", error);
    return null;
  }
  const data = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok) return null;
  return data;
}

export async function supabaseSignUp(email: string, password: string, displayName: string): Promise<AuthResponse> {
  if (!url() || !key()) throw new Error("Supabase n'est pas configuré");
  const response = await fetch(`${url()}/auth/v1/signup`, { method: "POST", headers: { apikey: key(), "content-type": "application/json" }, body: JSON.stringify({ email, password, data: { display_name: displayName } }) });
  const data = await response.json().catch(() => ({})) as AuthResponse;
  if (!response.ok) throw new Error(data.error_description || data.msg || data.error || "Impossible de créer le compte");
  return data;
}

export async function supabaseResetPassword(email: string, redirectTo: string): Promise<void> {
  if (!url() || !key()) throw new Error("Supabase n'est pas configuré");
  const response = await fetch(`${url()}/auth/v1/recover`, { method: "POST", headers: { apikey: key(), "content-type": "application/json" }, body: JSON.stringify({ email, redirect_to: redirectTo }) });
  if (!response.ok) { const data = await response.json().catch(() => ({})) as AuthResponse; throw new Error(data.error_description || data.msg || "Impossible d'envoyer le lien"); }
}

export async function supabaseUpdatePassword(accessToken: string, password: string): Promise<boolean> {
  if (!url() || !key()) return false;
  const response = await fetch(`${url()}/auth/v1/user`, { method: "PUT", headers: { apikey: key(), authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return response.ok;
}
