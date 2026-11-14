create table patients (id uuid primary key default gen_random_uuid(), name text, preferred_name text,
  phone text, language text default 'en', meal_times jsonb, caregiver_name text, caregiver_phone text,
  doctor_name text, address text, consent_at timestamptz, care_chat_id text, created_at timestamptz default now());
create table medications (id uuid primary key default gen_random_uuid(), patient_id uuid references patients,
  drug text, strength text, dose text, times text[], food_rule text check (food_rule in ('empty_stomach','with_food','none')),
  avoid_foods text[], pills_left int, refill_info text, pill_description text, reference_photo_url text,
  active boolean default true, confirmed_by text, created_at timestamptz default now());
create table dose_events (id uuid primary key default gen_random_uuid(), medication_id uuid references medications,
  patient_id uuid references patients, scheduled_at timestamptz, status text default 'pending'
  check (status in ('pending','taken','missed','skipped','wrong_pill_caught')),
  confirmed_via text, chert_message_id text, evidence_jpeg_url text, created_at timestamptz default now());
create table calls (id uuid primary key default gen_random_uuid(), patient_id uuid references patients,
  chert_call_id text, room_name text, kind text, language text, started_at timestamptz default now(), ended_at timestamptz, transcript text);
create table check_ins (id uuid primary key default gen_random_uuid(), call_id uuid references calls,
  patient_id uuid references patients, mood int, symptoms jsonb, visual_notes text[], quotes jsonb,  -- [{original, english}]
  risk_level text, summary text, created_at timestamptz default now());
create table alerts (id uuid primary key default gen_random_uuid(), patient_id uuid references patients,
  level text check (level in ('yellow','orange','red')), reason text, sent_to text, created_at timestamptz default now(),
  acknowledged_at timestamptz);
create table memories (id uuid primary key default gen_random_uuid(), patient_id uuid references patients, fact text, created_at timestamptz default now());
create table reports (id uuid primary key default gen_random_uuid(), patient_id uuid references patients,
  week_start date, brief jsonb, doctor_note text, created_at timestamptz default now());
create table chert_events (event_id text primary key, received_at timestamptz default now());  -- dedupe
alter publication supabase_realtime add table dose_events, alerts, check_ins, calls;
