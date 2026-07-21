import { getChatGPTUser } from "../../../chatgpt-auth";
import { getD1 } from "../../../../db/d1";
import { recordActivity } from "../../../../db/user-activity";
import { enforceRateLimit, getAccountState } from "../../../../db/security";

export const dynamic = "force-dynamic";
const STATUSES = ["À préparer","Envoyée","Entretien","Offre","Refusée","Archivée"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  if (!await enforceRateLimit(user.email,"application-update",60,3600)) return Response.json({error:"Limite de modifications atteinte"},{status:429});
  const { id } = await context.params;
  const body = await request.json() as { status?: string; notes?: string; nextActionAt?: string; interviewAt?: string };
  if (body.status && !STATUSES.includes(body.status)) return Response.json({ error: "Statut invalide" }, { status: 400 });
  const current = await getD1().prepare("SELECT * FROM applications WHERE id = ? AND user_email = ?").bind(id,user.email).first<Record<string, unknown>>();
  if (!current) return Response.json({ error: "Candidature introuvable" }, { status: 404 });
  const status = body.status ?? String(current.status);
  const notes = body.notes ?? String(current.notes ?? "");
  const nextActionAt = body.nextActionAt === undefined ? current.next_action_at : body.nextActionAt || null;
  const interviewAt = body.interviewAt === undefined ? current.interview_at : body.interviewAt || null;
  const updated = await getD1().prepare("UPDATE applications SET status=?, notes=?, next_action_at=?, interview_at=?, updated_at=? WHERE id=? AND user_email=? RETURNING *")
    .bind(status,notes,nextActionAt,interviewAt,new Date().toISOString(),id,user.email).first();
  await recordActivity(user,"application.updated",`${String(current.role)} · ${String(current.company)} · ${status}`);
  return Response.json({ application: updated });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentification requise" }, { status: 401 });
  if ((await getAccountState(user.email))?.suspended_at) return Response.json({error:"Compte suspendu"},{status:403});
  if (!await enforceRateLimit(user.email,"application-delete",20,3600)) return Response.json({error:"Limite de suppressions atteinte"},{status:429});
  const { id } = await context.params;
  const result = await getD1().prepare("DELETE FROM applications WHERE id = ? AND user_email = ?").bind(id,user.email).run();
  if (!result.meta.changes) return Response.json({ error: "Candidature introuvable" }, { status: 404 });
  await recordActivity(user,"application.deleted",`Candidature #${id} supprimée`);
  return Response.json({ ok: true });
}
