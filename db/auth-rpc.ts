type RpcResult = Record<string, unknown>;

function config() {
  const base = String(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "");
  return base && key ? { base, key } : null;
}

async function call(name: string, body: Record<string, unknown>): Promise<RpcResult | null> {
  const settings = config();
  if (!settings) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${settings.base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result && typeof result === "object" ? result as RpcResult : null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

export function authPreflight(email: string, ip: string) {
  return call("fala_auth_preflight", { p_email: email, p_ip: ip });
}

export function finalizeAuth(email: string, ip: string, displayName: string, token: string, createdAt: string, expiresAt: string, userAgent?: string) {
  return call("fala_auth_finalize", { p_email: email, p_ip: ip, p_display_name: displayName, p_token: token, p_created_at: createdAt, p_expires_at: expiresAt, p_user_agent: userAgent ?? null });
}
