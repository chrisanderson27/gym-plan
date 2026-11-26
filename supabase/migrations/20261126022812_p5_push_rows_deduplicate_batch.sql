create or replace function public.push_rows(p_table text, p_rows jsonb)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  accepted jsonb;
begin
  if p_table is null or not (p_table = any(array[
    'sessions', 'sets', 'runs', 'swims', 'tests', 'body_logs',
    'templates', 'library_blocks', 'feedback', 'settings', 'equipment', 'exercise_overrides'
  ])) then
    raise exception 'invalid sync table' using errcode = '22023';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'sync rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'sync batch exceeds 500 rows' using errcode = '22023';
  end if;

  execute format($sql$
    with latest as (
      select distinct on (r.id) r.*
      from rows from (
        jsonb_to_recordset($1) as (id text, data jsonb, client_updated_at timestamptz, deleted_at timestamptz)
      ) with ordinality as r
      -- Keep missing timestamps subject to the NOT NULL constraint.
      order by r.id, r.client_updated_at desc nulls first, r.ordinality desc
    ), accepted as (
      insert into public.%I as t (id, data, client_updated_at, deleted_at)
      select r.id, coalesce(r.data, '{}'::jsonb), r.client_updated_at, r.deleted_at
      from latest as r
      order by r.ordinality
      on conflict (user_id, id) do update
      set data = excluded.data,
          client_updated_at = excluded.client_updated_at,
          deleted_at = excluded.deleted_at
      where excluded.client_updated_at >= t.client_updated_at
      returning id, client_updated_at, updated_at, deleted_at
    )
    select coalesce(jsonb_agg(accepted), '[]'::jsonb) from accepted
  $sql$, p_table) into accepted using p_rows;

  return accepted;
end;
$$;
