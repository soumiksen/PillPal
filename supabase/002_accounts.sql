-- PillPal accounts (run once in the Supabase SQL editor, after schema.sql; safe to re-run).
--
-- • profiles: one row per signed-up user (caregiver or doctor), created by a trigger on auth.users.
-- • care_team: which users can see which patients. The API adds the creator when a patient is set up;
--   anyone else joins with the patient's share code (join_patient RPC).
-- • Row-level security: a signed-in user can read only their own patients' rows. The anon key alone
--   reads nothing. The API and agent use the service key and are unaffected.

-- ---------------------------------------------------------------- tables

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('caregiver', 'doctor')),
  full_name text,
  created_at timestamptz default now()
);

create table if not exists care_team (
  user_id uuid not null references auth.users on delete cascade,
  patient_id uuid not null references patients on delete cascade,
  role text not null check (role in ('caregiver', 'doctor')),
  created_at timestamptz default now(),
  primary key (user_id, patient_id)
);

-- Short code a caregiver gives the doctor (or another family member) to add this patient.
alter table patients add column if not exists share_code text unique;
alter table patients alter column share_code set default upper(substr(md5(gen_random_uuid()::text), 1, 6));
update patients set share_code = default where share_code is null;

-- ---------------------------------------------------------------- new users → profiles

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'doctor' then 'doctor' else 'caregiver' end,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- helpers

create or replace function public.is_care_team(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from care_team where user_id = auth.uid() and patient_id = p)
$$;

-- Join a patient's care team with their share code. Your role on the team is your profile role.
create or replace function public.join_patient(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  r text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select id into pid from patients where share_code = upper(trim(code));
  if pid is null then raise exception 'no_patient_with_that_code'; end if;
  select role into r from profiles where id = auth.uid();
  insert into care_team (user_id, patient_id, role)
  values (auth.uid(), pid, coalesce(r, 'caregiver'))
  on conflict do nothing;
  return pid;
end $$;

revoke all on function public.join_patient(text) from public, anon;
grant execute on function public.join_patient(text) to authenticated;

-- ---------------------------------------------------------------- row-level security

alter table profiles enable row level security;
drop policy if exists profiles_select_own on profiles;
create policy profiles_select_own on profiles for select using (id = auth.uid());
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());

alter table care_team enable row level security;
drop policy if exists care_team_select on care_team;
create policy care_team_select on care_team for select using (user_id = auth.uid() or public.is_care_team(patient_id));

alter table patients enable row level security;
drop policy if exists patients_select on patients;
create policy patients_select on patients for select using (public.is_care_team(id));

do $$
declare t text;
begin
  foreach t in array array['medications', 'dose_events', 'check_ins', 'calls', 'alerts', 'memories', 'reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (public.is_care_team(patient_id))', t || '_select', t);
  end loop;
end $$;

-- The portal marks alerts as handled directly.
drop policy if exists alerts_update on alerts;
create policy alerts_update on alerts for update
  using (public.is_care_team(patient_id)) with check (public.is_care_team(patient_id));

-- Server-only table: RLS on, no policies.
alter table chert_events enable row level security;

-- ---------------------------------------------------------------- realtime

-- Dose changes should reach the dashboard live too.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'medications') then
    alter publication supabase_realtime add table medications;
  end if;
end $$;
