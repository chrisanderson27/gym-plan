begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(29 + 2 * count(*)::int)
from pg_catalog.pg_tables where schemaname = 'public';

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000001', 'push-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'push-b@example.test', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{"date":"2026-11-01"},"client_updated_at":"2026-11-01T00:00:00Z"}]')), 1, 'first push is accepted');
select is((select date from public.sessions where id = 's1'), '2026-11-01', 'date is generated from data');

select is(public.push_rows('sessions',
  '[{"id":"s1","data":{"stale":true},"client_updated_at":"2026-10-31T00:00:00Z"}]'), '[]'::jsonb, 'older push is ignored');
select is((select data from public.sessions where id = 's1'), '{"date":"2026-11-01"}'::jsonb, 'older push leaves data unchanged');

select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{"type":"lift"},"client_updated_at":"2026-11-01T00:00:00Z"}]')), 1, 'equal timestamp is accepted');
select is((select type from public.sessions where id = 's1'), 'lift', 'equal push updates the row');

create temp table before_push as select updated_at from public.sessions where id = 's1';
select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{"date":"2026-11-02","type":"run","templateId":"t1"},"client_updated_at":"2026-11-02T00:00:00Z"}]')),
  1, 'newer push is accepted');
select cmp_ok((select updated_at from public.sessions where id = 's1'), '>', (select updated_at from before_push),
  'server timestamp advances');

select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{},"client_updated_at":"2026-11-03T00:00:00Z","deleted_at":"2026-11-03T00:00:00Z"}]')),
  1, 'tombstone is accepted');
select ok((select data = '{}'::jsonb and date is null and type is null and template_id is null
  and deleted_at = '2026-11-03T00:00:00Z'::timestamptz from public.sessions where id = 's1'),
  'tombstone clears generated columns and stores deletion time');

select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{"restored":true},"client_updated_at":"2026-11-04T00:00:00Z"}]')), 1, 'newer row can restore a tombstone');
select ok((select deleted_at is null from public.sessions where id = 's1'), 'restored row clears deletion time');

select throws_ok($$select public.push_rows('auth.users', '[]')$$, '22023', null, 'schema-qualified name is rejected');
select throws_ok($$select public.push_rows('nope', '[]')$$, '22023', null, 'unknown table is rejected');
select throws_ok($$select public.push_rows(null, '[]')$$, '22023', null, 'null table is rejected');
select throws_ok($$select public.push_rows('sessions', '{}')$$, '22023', null, 'object batch is rejected');
select throws_ok($$select public.push_rows('sessions', null)$$, '22023', null, 'null batch is rejected');
select throws_ok(
  $$select public.push_rows('sessions', (select jsonb_agg('{}'::jsonb) from generate_series(1, 501)))$$,
  '22023', null, '501 rows are rejected'
);

select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"forced","user_id":"00000000-0000-4000-8000-000000000002","client_updated_at":"2026-11-04T00:00:00Z"}]')),
  1, 'push ignores user_id supplied in payload');
select is((select user_id from public.sessions where id = 'forced'),
  '00000000-0000-4000-8000-000000000001'::uuid, 'row belongs to A');
select is((select data from public.sessions where id = 'forced'), '{}'::jsonb, 'omitted data defaults to an empty object');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(jsonb_array_length(public.push_rows('sessions',
  '[{"id":"s1","data":{"owner":"B"},"client_updated_at":"2026-11-05T00:00:00Z"}]')), 1, 'B can push the same id');
select is((select data from public.sessions where id = 's1'), '{"owner":"B"}'::jsonb, 'B sees its own row');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select data from public.sessions where id = 's1'), '{"restored":true}'::jsonb, 'B push cannot change A row');

select is(
  (select array_agg(value->>'id' order by value->>'id')
   from jsonb_array_elements(public.push_rows('sessions', '[
     {"id":"s1","client_updated_at":"2026-11-03T00:00:00Z"},
     {"id":"repeated","data":{"first":true},"client_updated_at":"2026-11-05T00:00:00Z"},
     {"id":"fresh","client_updated_at":"2026-11-05T00:00:00Z"},
     {"id":"repeated","data":{"last":true},"client_updated_at":"2026-11-05T00:00:00Z"},
     {"id":"repeated","data":{"stale":true},"client_updated_at":"2026-11-04T00:00:00Z"},
     {"id":"s1","client_updated_at":"2026-11-02T00:00:00Z"}
   ]'))),
  array['fresh', 'repeated'], 'batch returns one winner per accepted id and excludes stale rows'
);
select is((select data from public.sessions where id = 'repeated'), '{"last":true}'::jsonb,
  'duplicate ids use the newest timestamp and last row on a tie');
select throws_ok(
  $$select public.push_rows('sessions', '[{"id":"repeated"},{"id":"repeated","client_updated_at":"2026-11-05T00:00:00Z"}]')$$,
  '23502', null, 'deduplication does not hide a missing client timestamp'
);
reset role;

create function pg_temp.account_rows(check_deleted boolean) returns setof text
language plpgsql as $$
declare
  user_a constant uuid := '00000000-0000-4000-8000-000000000001';
  user_b constant uuid := '00000000-0000-4000-8000-000000000002';
  table_name text;
  row_count bigint;
begin
  for table_name in
    select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename
  loop
    if not check_deleted then
      if table_name <> 'sessions' then
        execute format('insert into public.%I (user_id, id, data, client_updated_at)
          values ($1, %L, %L, now()), ($2, %L, %L, now())', table_name, 'a1', '{}', 'b1', '{}') using user_a, user_b;
      end if;
    else
      execute format('select count(*) from public.%I where user_id = $1', table_name) into row_count using user_a;
      return next is(row_count, 0::bigint, table_name || ': A rows cascaded');
      execute format('select count(*) from public.%I where user_id = $1', table_name) into row_count using user_b;
      return next is(row_count, 1::bigint, table_name || ': B row remains');
    end if;
  end loop;
end;
$$;

select * from pg_temp.account_rows(false);
set local role authenticated;
do $$ begin perform public.delete_my_account(); end; $$;
reset role;

select * from pg_temp.account_rows(true);
select is((select count(*) from auth.users where id = '00000000-0000-4000-8000-000000000001'),
  0::bigint, 'A auth account was deleted');
select is((select data from public.sessions where user_id = '00000000-0000-4000-8000-000000000002' and id = 's1'),
  '{"owner":"B"}'::jsonb, 'B session data remains');

select * from finish();
rollback;
