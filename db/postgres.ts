/**
 * Small D1-shaped adapter backed by Supabase Postgres' PostgREST RPC.
 *
 * Keeping this compatibility surface lets the existing route handlers share
 * one database implementation while the application moves away from D1.
 * The RPC function is installed by supabase/migrations/0001_fala_sql_rpc.sql.
 */
type Row = Record<string, unknown>;

function config() {
  const base = String(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? "");
  if (!base || !key) throw new Error("Supabase Postgres n'est pas configuré (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis).");
  return { base, key };
}

function normalize(sql: string) {
  return sql
    .replace(/datetime\('now','-(\d+) days?'\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 days')")
    .replace(/datetime\('now','-(\d+) months?'\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 months')");
}

function sqlLiteral(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function execute(sql: string, params: unknown[]) {
  const { base, key } = config();
  let parameterIndex = 0;
  const statement = normalize(sql).replace(/\?/g, () => sqlLiteral(params[parameterIndex++]));
  const response = await fetch(`${base}/rest/v1/rpc/fala_sql`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: statement, params: [] }),
  });
  if (!response.ok) throw new Error(`Supabase Postgres query failed (${response.status}): ${await response.text()}`);
  return await response.json() as Row[] | { _changes?: number };
}

class Statement {
  constructor(private readonly sql: string, private readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.sql, params); }
  async all<T extends Row = Row>() { const value = await execute(this.sql, this.params); return { results: Array.isArray(value) ? value as T[] : [], success: true }; }
  async first<T extends Row = Row>() { const result = await this.all<T>(); return result.results[0] ?? null; }
  async run() { const value = await execute(this.sql, this.params); return { success: true, meta: { changes: Array.isArray(value) ? value.length : Number(value._changes ?? 0) } }; }
}

class PostgresCompat {
  prepare(sql: string) { return new Statement(sql); }
  async batch(statements: Statement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

let singleton: PostgresCompat | undefined;
export function getPostgres() { return singleton ??= new PostgresCompat(); }
export const getPostgresDb = getPostgres;
