import { getPostgresDb } from "../../../../db/postgres";
import { hashPassword } from "../../../email-auth";
import { supabaseUpdatePassword } from "../../../supabase-auth";

export const dynamic = "force-dynamic";

const GENERIC_FAILURE = "Impossible de finaliser la réinitialisation. Demandez un nouveau lien puis réessayez.";

export async function POST(request: Request) {
  let stage = "lecture";
  try {
    const body = await request.json() as { token?: string; password?: string; accessToken?: string };
    const cleanToken = String(body.token ?? "").trim();
    const cleanPassword = String(body.password ?? "");
    const cleanAccess = String(body.accessToken ?? "").trim();
    if (cleanPassword.length < 8) return Response.json({ error: "Mot de passe de 8 caractères minimum requis" }, { status: 400 });

    if (cleanAccess) {
      stage = "mise à jour du fournisseur d’authentification";
      if (!(await supabaseUpdatePassword(cleanAccess, cleanPassword))) return Response.json({ error: "Lien de récupération invalide ou expiré. Demandez un nouveau lien." }, { status: 400 });
      return Response.json({ ok: true });
    }
    if (!cleanToken) return Response.json({ error: "Lien invalide ou expiré. Demandez un nouveau lien." }, { status: 400 });

    stage = "validation du lien";
    const db = getPostgresDb();
    const user = await db.prepare("SELECT email FROM users WHERE reset_token=? AND reset_token_expires_at>? ")
      .bind(cleanToken, new Date().toISOString()).first<{ email: string }>();
    if (!user) return Response.json({ error: "Ce lien est invalide ou a expiré. Demandez un nouveau lien." }, { status: 400 });

    stage = "mise à jour du compte";
    const passwordHash = await hashPassword(cleanPassword);
    await db.prepare("UPDATE users SET password_hash=?,reset_token=NULL,reset_token_expires_at=NULL WHERE email=?")
      .bind(passwordHash, user.email).run();
    try { await db.prepare("DELETE FROM auth_sessions WHERE user_email=?").bind(user.email).run(); } catch { /* best effort */ }
    return Response.json({ ok: true });
  } catch (error) {
    // Keep diagnostics server-side; never expose implementation stages,
    // provider responses, tokens or database details to the browser.
    console.error("[Fala AI] reset-password failed", { stage, error });
    return Response.json({ error: GENERIC_FAILURE }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
