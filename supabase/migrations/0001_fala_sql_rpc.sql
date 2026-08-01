-- Run this once in Supabase SQL Editor. The function is server-only: execution
-- requires the service role key and is never exposed to the browser.
create or replace function public.fala_sql(query text, params jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  statement text := query;
  result jsonb;
  i integer;
  changed integer := 0;
begin
  -- Replace numbered placeholders from highest to lowest to avoid $1 matching $10.
  for i in reverse 1..jsonb_array_length(params) loop
    statement := replace(statement, '$' || i::text, quote_nullable(params ->> (i - 1)));
  end loop;
  if upper(ltrim(statement)) like 'SELECT%' or upper(ltrim(statement)) like 'WITH%' or position(' RETURNING ' in upper(statement)) > 0 then
    execute format('select coalesce(jsonb_agg(to_jsonb(row_data)), ''[]''::jsonb) from (%s) row_data', statement) into result;
    return coalesce(result, '[]'::jsonb);
  end if;
  execute statement;
  get diagnostics changed = row_count;
  return jsonb_build_object('_changes', changed);
end;
$$;

revoke all on function public.fala_sql(text, jsonb) from public, anon, authenticated;
grant execute on function public.fala_sql(text, jsonb) to service_role;
