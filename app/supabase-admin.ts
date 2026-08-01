type AdminUser = { id: string; email?: string | null };

const projectUrl = () => String(process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '');

/**
 * Applies the platform suspension state to the matching Supabase identity.
 * This module is server-only by convention: the service key is never exposed
 * to the browser and the operation is skipped when it has not been configured.
 */
export async function supabaseAdminSetSuspended(email: string, suspended: boolean): Promise<'updated' | 'not-found' | 'skipped'> {
  const base = projectUrl();
  const key = serviceKey();
  if (!base || !key) return 'skipped';
  const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase admin lookup failed (${response.status})`);
  const payload = await response.json().catch(() => ({})) as { users?: AdminUser[] };
  const user = (payload.users ?? []).find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) return 'not-found';
  const update = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ban_duration: suspended ? '876000h' : 'none' }),
  });
  if (!update.ok) throw new Error(`Supabase admin update failed (${update.status})`);
  return 'updated';
}

/** Remove an Auth identity that was created before the application account was
 * persisted. This is intentionally callable only from the server and is used
 * to recover interrupted registrations without treating the address as busy.
 */
export async function supabaseAdminDeleteOrphan(email: string): Promise<'deleted' | 'not-found' | 'skipped'> {
  const base = projectUrl();
  const key = serviceKey();
  if (!base || !key) return 'skipped';
  const response = await fetch(`${base}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase admin lookup failed (${response.status})`);
  const payload = await response.json().catch(() => ({})) as { users?: AdminUser[] };
  const user = (payload.users ?? []).find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) return 'not-found';
  const deletion = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'DELETE',
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  if (!deletion.ok) throw new Error(`Supabase admin deletion failed (${deletion.status})`);
  return 'deleted';
}
