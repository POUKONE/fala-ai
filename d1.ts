import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  if (!env.DB) throw new Error("Le stockage persistant est indisponible.");
  return env.DB;
}
