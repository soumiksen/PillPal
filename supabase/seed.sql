-- PillPal demo seed (Role 2): one week of history for the demo patient "Rose".
-- Run after `npm run seed:patient` (creates Rose + Levothyroxine, Metformin, Lisinopril).
-- Same rows and ids as `npm run seed:history` (api/scripts/seed-history.ts): every id is
-- sha256('pillpal-seed:<patient id>:<key>')::uuid and rows are upserted on id, so it is idempotent.
-- Story: 28 scheduled doses over the last 7 days (America/Chicago): 24 taken (facetime /
-- imessage_tapback), 2 missed Metformin evenings, 1 wrong pill caught, 1 skipped; 6 check-in calls
-- (moods 3–5, some Spanish quotes, one orange risk); 1 acknowledged orange alert; 3 memories.
-- No phone numbers are written.

create extension if not exists pgcrypto;

do $$
declare
  pid uuid;
  tz constant text := 'America/Chicago';
  today date := (now() at time zone 'America/Chicago')::date;
begin
  select id into pid from patients where preferred_name = 'Rose' order by created_at limit 1;
  if pid is null then
    raise exception 'No patient named Rose: run npm run seed:patient first';
  end if;

  -- dose_events: every slot of every seeded med, days 1..7 ago
  insert into dose_events (id, patient_id, medication_id, scheduled_at, status, confirmed_via, created_at)
  select
    encode(digest('pillpal-seed:' || pid || ':dose:' || d || ':' || m.drug || ':' || t, 'sha256'), 'hex')::uuid,
    pid, m.id,
    ((today - d) + t::time) at time zone tz,
    s.status,
    case when s.status in ('taken', 'wrong_pill_caught')
         then case when t = '08:00' then 'facetime' else 'imessage_tapback' end end,
    ((today - d) + t::time) at time zone tz
  from generate_series(1, 7) as d
  cross join medications m
  cross join lateral unnest(m.times) as t
  cross join lateral (
    select case (d || '|' || m.drug || '|' || t)
      when '2|Metformin|18:30' then 'missed'
      when '5|Metformin|18:30' then 'missed'
      when '4|Levothyroxine|08:00' then 'wrong_pill_caught'
      when '6|Lisinopril|13:00' then 'skipped'
      else 'taken' end as status
  ) s
  where m.patient_id = pid and m.active and m.drug in ('Levothyroxine', 'Metformin', 'Lisinopril')
  on conflict (id) do update set
    scheduled_at = excluded.scheduled_at, status = excluded.status,
    confirmed_via = excluded.confirmed_via, created_at = excluded.created_at;

  -- calls + check_ins
  create temporary table seed_calls (n int, d int, language text, mood int, risk text, summary text,
    transcript text, symptoms jsonb, visual_notes text[], quotes jsonb) on commit drop;
  insert into seed_calls values
  (1, 7, 'en', 4, 'green',
   'Rose took Levothyroxine on camera before breakfast and waited 30 minutes to eat. Cheerful; talked about her garden.',
   'Pal: Good morning Rose! Rose: Morning, Pal. The tomatoes are finally turning red. Pal: Wonderful. Can you show me your morning pill?',
   '[]',
   array['Alert and well-groomed', 'Took the correct small white tablet with water'],
   '[{"original":"The tomatoes are finally turning red.","english":"The tomatoes are finally turning red."}]'),
  (2, 6, 'es', 3, 'yellow',
   'Rose took her morning pills but mentioned mild dizziness when standing up. Spoke mostly Spanish today.',
   'Pal: ¡Buenos días, Rose! Rose: Buenos días. Me mareé un poco al levantarme. Pal: Gracias por decírmelo. Siéntate despacio, por favor.',
   '[{"name":"dizziness","severity":"mild","quote":"Me mareé un poco al levantarme."}]',
   array['Seated, steady hands', 'Took correct tablets with water'],
   '[{"original":"Me mareé un poco al levantarme.","english":"I got a little dizzy when I stood up."}]'),
  (3, 5, 'en', 4, 'green',
   'Morning doses taken on camera. Rose mentioned her granddaughter Lily is visiting on Sunday.',
   'Pal: Morning Rose, how did you sleep? Rose: Pretty well. Lily is coming Sunday! Pal: That''s lovely.',
   '[]',
   array['Good color, smiling', 'Showed oatmeal for breakfast'],
   '[{"original":"Lily is coming Sunday!","english":"Lily is coming Sunday!"}]'),
  (4, 4, 'en', 4, 'yellow',
   'Rose first held up Lisinopril instead of Levothyroxine; Pal caught it and she took the right pill. No symptoms.',
   'Pal: Can you show me the pill? Rose: This pink one? Pal: That''s your lunchtime Lisinopril. The morning one is the small white tablet. Rose: Oh, you''re right.',
   '[]',
   array['Initially held the pink Lisinopril tablet', 'Then took the small white Levothyroxine tablet'],
   '[{"original":"Oh, you''re right, the little white one.","english":"Oh, you''re right, the little white one."}]'),
  (5, 2, 'es', 3, 'orange',
   'Rose missed her evening Metformin twice this week and said she feels more tired than usual, with some dizziness in the afternoons.',
   'Pal: Rose, ¿cómo te sientes hoy? Rose: Un poco cansada, y por la tarde me mareo. Anoche se me olvidó la pastilla de la noche.',
   '[{"name":"fatigue","severity":"mild","quote":"Estoy un poco cansada."},{"name":"dizziness","severity":"mild","quote":"Por la tarde me mareo."}]',
   array['Looked tired', 'Took correct morning tablets'],
   '[{"original":"Anoche se me olvidó la pastilla de la noche.","english":"Last night I forgot my evening pill."},{"original":"Por la tarde me mareo.","english":"I get dizzy in the afternoons."}]'),
  (6, 1, 'en', 5, 'green',
   'All morning doses taken on camera. Rose felt rested and was in good spirits after Lily''s visit.',
   'Pal: Good morning Rose! Rose: Good morning! I feel much better today. Lily brought me flowers.',
   '[]',
   array['Alert, smiling', 'Took correct tablets with water, waited before breakfast'],
   '[{"original":"I feel much better today.","english":"I feel much better today."}]');

  insert into calls (id, patient_id, chert_call_id, room_name, kind, language, started_at, ended_at, transcript)
  select encode(digest('pillpal-seed:' || pid || ':call:' || c.n, 'sha256'), 'hex')::uuid, pid, 'seed-call-' || c.n,
         'pillpal-check_in-seed' || c.n, 'check_in', c.language,
         ((today - c.d) + time '08:05') at time zone tz,
         ((today - c.d) + time '08:11') at time zone tz,
         c.transcript
  from seed_calls c
  on conflict (id) do update set started_at = excluded.started_at, ended_at = excluded.ended_at,
    language = excluded.language, transcript = excluded.transcript;

  insert into check_ins (id, call_id, patient_id, mood, symptoms, visual_notes, quotes, risk_level, summary, created_at)
  select encode(digest('pillpal-seed:' || pid || ':checkin:' || c.n, 'sha256'), 'hex')::uuid,
         encode(digest('pillpal-seed:' || pid || ':call:' || c.n, 'sha256'), 'hex')::uuid, pid,
         c.mood, c.symptoms, c.visual_notes, c.quotes, c.risk, c.summary,
         ((today - c.d) + time '08:11') at time zone tz
  from seed_calls c
  on conflict (id) do update set mood = excluded.mood, symptoms = excluded.symptoms,
    visual_notes = excluded.visual_notes, quotes = excluded.quotes, risk_level = excluded.risk_level,
    summary = excluded.summary, created_at = excluded.created_at;

  -- one acknowledged orange alert
  insert into alerts (id, patient_id, level, reason, sent_to, created_at, acknowledged_at)
  values (encode(digest('pillpal-seed:' || pid || ':alert:1', 'sha256'), 'hex')::uuid, pid, 'orange',
          'Missed evening Metformin for the second time this week; tiredness and afternoon dizziness reported',
          'caregiver',
          ((today - 2) + time '19:45') at time zone tz,
          ((today - 2) + time '20:05') at time zone tz)
  on conflict (id) do update set created_at = excluded.created_at, acknowledged_at = excluded.acknowledged_at;

  -- memories
  insert into memories (id, patient_id, fact, created_at)
  select encode(digest('pillpal-seed:' || pid || ':memory:' || x.n, 'sha256'), 'hex')::uuid, pid, x.fact,
         ((today - (7 - (x.n - 1) * 2)) + time '09:00') at time zone tz
  from (values (1, 'Granddaughter Lily visits on Sundays.'),
               (2, 'Loves gardening; growing tomatoes this year.'),
               (3, 'Prefers oatmeal for breakfast.')) as x(n, fact)
  on conflict (id) do update set fact = excluded.fact, created_at = excluded.created_at;
end $$;
