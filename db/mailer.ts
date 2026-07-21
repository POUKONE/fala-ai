import { env } from "cloudflare:workers";

type Mail = { to: string; subject: string; html: string };

/** Sends through Resend when configured; otherwise leaves the app usable. */
export async function sendTransactionalMail(mail: Mail) {
  const runtime = env as unknown as Record<string, unknown>;
  const apiKey = String(runtime.RESEND_API_KEY ?? "").trim();
  const from = String(runtime.EMAIL_FROM ?? "").trim();
  if (!apiKey || !from) return { sent: false, configured: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html }),
  });
  if (!response.ok) throw new Error(`Échec du service d’e-mail (${response.status})`);
  return { sent: true, configured: true };
}
