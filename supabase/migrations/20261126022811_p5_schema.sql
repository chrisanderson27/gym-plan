create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon;

create table public.sessions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  date text generated always as (data->>'date') stored,
  type text generated always as (data->>'type') stored,
  template_id text generated always as (data->>'templateId') stored,
  primary key (user_id, id)
);
create index sessions_sync_idx on public.sessions (user_id, updated_at, id);
create index sessions_date_idx on public.sessions (user_id, date);
create trigger sessions_set_updated_at before insert or update on public.sessions
  for each row execute function public.set_updated_at();
alter table public.sessions enable row level security;

create table public.sets (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  session_id text generated always as (data->>'sessionId') stored,
  exercise_id text generated always as (data->>'exerciseId') stored,
  equipment_id text generated always as (data->>'equipmentId') stored,
  primary key (user_id, id)
);
create index sets_sync_idx on public.sets (user_id, updated_at, id);
create index sets_session_id_idx on public.sets (user_id, session_id);
create trigger sets_set_updated_at before insert or update on public.sets
  for each row execute function public.set_updated_at();
alter table public.sets enable row level security;

create table public.runs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  kind text generated always as (data->>'kind') stored,
  primary key (user_id, id)
);
create index runs_sync_idx on public.runs (user_id, updated_at, id);
create trigger runs_set_updated_at before insert or update on public.runs
  for each row execute function public.set_updated_at();
alter table public.runs enable row level security;

create table public.swims (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index swims_sync_idx on public.swims (user_id, updated_at, id);
create trigger swims_set_updated_at before insert or update on public.swims
  for each row execute function public.set_updated_at();
alter table public.swims enable row level security;

create table public.tests (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  kind text generated always as (data->>'kind') stored,
  date text generated always as (data->>'date') stored,
  primary key (user_id, id)
);
create index tests_sync_idx on public.tests (user_id, updated_at, id);
create trigger tests_set_updated_at before insert or update on public.tests
  for each row execute function public.set_updated_at();
alter table public.tests enable row level security;

create table public.body_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index body_logs_sync_idx on public.body_logs (user_id, updated_at, id);
create trigger body_logs_set_updated_at before insert or update on public.body_logs
  for each row execute function public.set_updated_at();
alter table public.body_logs enable row level security;

create table public.templates (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  type text generated always as (data->>'type') stored,
  source text generated always as (data->>'source') stored,
  primary key (user_id, id)
);
create index templates_sync_idx on public.templates (user_id, updated_at, id);
create trigger templates_set_updated_at before insert or update on public.templates
  for each row execute function public.set_updated_at();
alter table public.templates enable row level security;

create table public.library_blocks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index library_blocks_sync_idx on public.library_blocks (user_id, updated_at, id);
create trigger library_blocks_set_updated_at before insert or update on public.library_blocks
  for each row execute function public.set_updated_at();
alter table public.library_blocks enable row level security;

create table public.feedback (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  ts text generated always as (data->>'ts') stored,
  kind text generated always as (data->>'kind') stored,
  primary key (user_id, id)
);
create index feedback_sync_idx on public.feedback (user_id, updated_at, id);
create trigger feedback_set_updated_at before insert or update on public.feedback
  for each row execute function public.set_updated_at();
alter table public.feedback enable row level security;

create table public.settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index settings_sync_idx on public.settings (user_id, updated_at, id);
create trigger settings_set_updated_at before insert or update on public.settings
  for each row execute function public.set_updated_at();
alter table public.settings enable row level security;

create table public.equipment (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  kind text generated always as (data->>'kind') stored,
  primary key (user_id, id)
);
create index equipment_sync_idx on public.equipment (user_id, updated_at, id);
create trigger equipment_set_updated_at before insert or update on public.equipment
  for each row execute function public.set_updated_at();
alter table public.equipment enable row level security;

create table public.exercise_overrides (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (user_id, id)
);
create index exercise_overrides_sync_idx on public.exercise_overrides (user_id, updated_at, id);
create trigger exercise_overrides_set_updated_at before insert or update on public.exercise_overrides
  for each row execute function public.set_updated_at();
alter table public.exercise_overrides enable row level security;

create policy sessions_select on public.sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy sessions_update on public.sessions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy sessions_delete on public.sessions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy sets_select on public.sets for select to authenticated
  using (user_id = (select auth.uid()));
create policy sets_insert on public.sets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy sets_update on public.sets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy sets_delete on public.sets for delete to authenticated
  using (user_id = (select auth.uid()));

create policy runs_select on public.runs for select to authenticated
  using (user_id = (select auth.uid()));
create policy runs_insert on public.runs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy runs_update on public.runs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy runs_delete on public.runs for delete to authenticated
  using (user_id = (select auth.uid()));

create policy swims_select on public.swims for select to authenticated
  using (user_id = (select auth.uid()));
create policy swims_insert on public.swims for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy swims_update on public.swims for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy swims_delete on public.swims for delete to authenticated
  using (user_id = (select auth.uid()));

create policy tests_select on public.tests for select to authenticated
  using (user_id = (select auth.uid()));
create policy tests_insert on public.tests for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy tests_update on public.tests for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy tests_delete on public.tests for delete to authenticated
  using (user_id = (select auth.uid()));

create policy body_logs_select on public.body_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy body_logs_insert on public.body_logs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy body_logs_update on public.body_logs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy body_logs_delete on public.body_logs for delete to authenticated
  using (user_id = (select auth.uid()));

create policy templates_select on public.templates for select to authenticated
  using (user_id = (select auth.uid()));
create policy templates_insert on public.templates for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy templates_update on public.templates for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy templates_delete on public.templates for delete to authenticated
  using (user_id = (select auth.uid()));

create policy library_blocks_select on public.library_blocks for select to authenticated
  using (user_id = (select auth.uid()));
create policy library_blocks_insert on public.library_blocks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy library_blocks_update on public.library_blocks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy library_blocks_delete on public.library_blocks for delete to authenticated
  using (user_id = (select auth.uid()));

create policy feedback_select on public.feedback for select to authenticated
  using (user_id = (select auth.uid()));
create policy feedback_insert on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy feedback_update on public.feedback for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy feedback_delete on public.feedback for delete to authenticated
  using (user_id = (select auth.uid()));

create policy settings_select on public.settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy settings_insert on public.settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy settings_update on public.settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy settings_delete on public.settings for delete to authenticated
  using (user_id = (select auth.uid()));

create policy equipment_select on public.equipment for select to authenticated
  using (user_id = (select auth.uid()));
create policy equipment_insert on public.equipment for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy equipment_update on public.equipment for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy equipment_delete on public.equipment for delete to authenticated
  using (user_id = (select auth.uid()));

create policy exercise_overrides_select on public.exercise_overrides for select to authenticated
  using (user_id = (select auth.uid()));
create policy exercise_overrides_insert on public.exercise_overrides for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy exercise_overrides_update on public.exercise_overrides for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy exercise_overrides_delete on public.exercise_overrides for delete to authenticated
  using (user_id = (select auth.uid()));

-- Supabase default grants can include TRUNCATE, which bypasses RLS.
revoke all on table
  public.sessions, public.sets, public.runs, public.swims,
  public.tests, public.body_logs, public.templates, public.library_blocks,
  public.feedback, public.settings, public.equipment, public.exercise_overrides
from anon, public, authenticated;
grant select, insert, update, delete on table
  public.sessions, public.sets, public.runs, public.swims,
  public.tests, public.body_logs, public.templates, public.library_blocks,
  public.feedback, public.settings, public.equipment, public.exercise_overrides
to authenticated;

create function public.push_rows(p_table text, p_rows jsonb)
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
    with accepted as (
      insert into public.%I as t (id, data, client_updated_at, deleted_at)
      select r.id, coalesce(r.data, '{}'::jsonb), r.client_updated_at, r.deleted_at
      from jsonb_to_recordset($1) as r(id text, data jsonb, client_updated_at timestamptz, deleted_at timestamptz)
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

revoke execute on function public.push_rows(text, jsonb) from public, anon;
grant execute on function public.push_rows(text, jsonb) to authenticated;

create function public.delete_my_account()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon, service_role;
grant execute on function public.delete_my_account() to authenticated;
