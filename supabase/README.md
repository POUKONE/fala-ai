# Fala AI — Supabase Postgres

1. Dans le SQL Editor du projet Supabase, exécuter `migrations/0001_fala_sql_rpc.sql`.
2. Configurer côté serveur (Vercel ou Sites) :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_EMAILS`
3. Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` dans une variable `NEXT_PUBLIC_*`.

Les routes utilisent désormais PostgREST/RPC et ne dépendent plus d’un binding
Cloudflare D1. Les tables métier existantes (`users`, `profiles`,
`applications`, `activity_events`, etc.) restent la source de vérité Postgres.
