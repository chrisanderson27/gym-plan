begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;

select plan(3 + 9 * count(*)::int)
from pg_catalog.pg_tables where schemaname = 'public';

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-4000-8000-000000000001', 'rls-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000000002', 'rls-b@example.test', 'authenticated', 'authenticated');

create function pg_temp.affected(sql text) returns int
language plpgsql as $$
declare
  affected_rows int;
begin
  execute sql;
  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

create function pg_temp.test_isolation() returns setof text
language plpgsql as $$
declare
  user_a constant uuid := '00000000-0000-4000-8000-000000000001';
  user_b constant uuid := '00000000-0000-4000-8000-000000000002';
  table_name text;
  relation text;
  row_count bigint;
begin
  for table_name in
    select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename
  loop
    relation := format('public.%I', table_name);
    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    execute format('insert into %s (id, data, client_updated_at) values (%L, %L, now())', relation, 'a1', '{}');

    perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
    execute format('select count(*) from %s', relation) into row_count;
    return next is(row_count, 0::bigint, table_name || ': B cannot read A rows');
    return next throws_ok(
      format('insert into %s (user_id, id, data, client_updated_at) values (%L, %L, %L, now())', relation, user_a, 'spoof', '{}'),
      '42501', null, table_name || ': B cannot insert as A'
    );
    return next is(pg_temp.affected(format('update %s set data = %L where id = %L', relation, '{}', 'a1')), 0,
      table_name || ': B cannot update A rows');
    execute format('insert into %s (id, data, client_updated_at) values (%L, %L, now())', relation, 'b1', '{}');
    return next throws_ok(format('update %s set user_id = %L where id = %L', relation, user_a, 'b1'),
      '42501', null, table_name || ': B cannot transfer ownership to A');
    return next is(pg_temp.affected(format('delete from %s where id = %L', relation, 'a1')), 0,
      table_name || ': B cannot delete A rows');

    perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
    execute format('select count(*) from %s', relation) into row_count;
    return next is(row_count, 1::bigint, table_name || ': A still sees exactly one row');
    return next is(pg_temp.affected(format('delete from %s where id = %L', relation, 'a1')), 1,
      table_name || ': A can delete its own row');
    return next ok(not has_table_privilege('anon', relation, 'select,insert,update,delete,truncate,references,trigger'),
      table_name || ': anon has no privileges');
    return next ok(not has_table_privilege('authenticated', relation, 'truncate,references,trigger'),
      table_name || ': authenticated cannot bypass RLS with TRUNCATE');
  end loop;
end;
$$;

set local role authenticated;
select * from pg_temp.test_isolation();
reset role;

select ok(not has_function_privilege('anon', 'public.push_rows(text,jsonb)', 'execute'), 'anon cannot push rows');
select ok(not has_function_privilege('anon', 'public.delete_my_account()', 'execute'), 'anon cannot delete accounts');
select ok(not has_function_privilege('anon', 'public.set_updated_at()', 'execute'), 'anon cannot execute the trigger');

select * from finish();
rollback;
