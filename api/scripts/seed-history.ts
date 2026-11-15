/**
 * Seven days of demo history for the existing demo patient "Rose" (run `npm run seed:patient` first).
 * Same data and ids as supabase/seed.sql: every row id is sha256("pillpal-seed:<patient id>:<key>") as a
 * uuid, and rows are upserted on id, so re-running never duplicates (dates shift to the last 7 days).
 * No phone numbers are written. Prints row counts only.
 *
 *   npm run seed:history   (from api/)
 */
import { createHash } from "node:crypto";
import type { MedicationRow } from "@pillpal/shared";
import { db } from "../src/db.js";
import { TZ, zonedDate, zonedTime } from "../src/lib/time.js";

function die(step: string, err: { code?: string; message: string }): never {
  console.error(`[seed:history] ${step} failed: ${err.code ?? ""} ${err.message}`.trim());
  process.exit(1);
}

const seedId = (patientId: string, key: string): string => {
  const h = createHash("sha256").update(`pillpal-seed:${patientId}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Chicago wall-clock `hhmm`, `daysAgo` days before today → ISO instant. */
function at(daysAgo: number, hhmm: string): string {
  const today = zonedDate(new Date(), TZ);
  const t = new Date(Date.UTC(today.y, today.m - 1, today.d - daysAgo));
  return zonedTime({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }, hhmm, TZ)!.toISOString();
}
const plusMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

// ---------------------------------------------------------------- the story (shared with supabase/seed.sql)

/** Non-"taken" outcomes; every other slot in the 7 days is taken. 24/28 taken ≈ 86 %. */
const EXCEPTIONS: Record<string, string> = {
  "2|Metformin|18:30": "missed",
  "5|Metformin|18:30": "missed",
  "4|Levothyroxine|08:00": "wrong_pill_caught",
  "6|Lisinopril|13:00": "skipped",
};

type SeedCall = {
  day: number;
  language: string;
  mood: number;
  risk: string;
  summary: string;
  transcript: string;
  symptoms: { name: string; severity: string; quote: string }[];
  visual_notes: string[];
  quotes: { original: string; english: string }[];
};

const CALLS: SeedCall[] = [
  {
    day: 7, language: "en", mood: 4, risk: "green",
    summary: "Rose took Levothyroxine on camera before breakfast and waited 30 minutes to eat. Cheerful; talked about her garden.",
    transcript: "Pal: Good morning Rose! Rose: Morning, Pal. The tomatoes are finally turning red. Pal: Wonderful. Can you show me your morning pill?",
    symptoms: [],
    visual_notes: ["Alert and well-groomed", "Took the correct small white tablet with water"],
    quotes: [{ original: "The tomatoes are finally turning red.", english: "The tomatoes are finally turning red." }],
  },
  {
    day: 6, language: "es", mood: 3, risk: "yellow",
    summary: "Rose took her morning pills but mentioned mild dizziness when standing up. Spoke mostly Spanish today.",
    transcript: "Pal: ¡Buenos días, Rose! Rose: Buenos días. Me mareé un poco al levantarme. Pal: Gracias por decírmelo. Siéntate despacio, por favor.",
    symptoms: [{ name: "dizziness", severity: "mild", quote: "Me mareé un poco al levantarme." }],
    visual_notes: ["Seated, steady hands", "Took correct tablets with water"],
    quotes: [{ original: "Me mareé un poco al levantarme.", english: "I got a little dizzy when I stood up." }],
  },
  {
    day: 5, language: "en", mood: 4, risk: "green",
    summary: "Morning doses taken on camera. Rose mentioned her granddaughter Lily is visiting on Sunday.",
    transcript: "Pal: Morning Rose, how did you sleep? Rose: Pretty well. Lily is coming Sunday! Pal: That's lovely.",
    symptoms: [],
    visual_notes: ["Good color, smiling", "Showed oatmeal for breakfast"],
    quotes: [{ original: "Lily is coming Sunday!", english: "Lily is coming Sunday!" }],
  },
  {
    day: 4, language: "en", mood: 4, risk: "yellow",
    summary: "Rose first held up Lisinopril instead of Levothyroxine; Pal caught it and she took the right pill. No symptoms.",
    transcript: "Pal: Can you show me the pill? Rose: This pink one? Pal: That's your lunchtime Lisinopril. The morning one is the small white tablet. Rose: Oh, you're right.",
    symptoms: [],
    visual_notes: ["Initially held the pink Lisinopril tablet", "Then took the small white Levothyroxine tablet"],
    quotes: [{ original: "Oh, you're right, the little white one.", english: "Oh, you're right, the little white one." }],
  },
  {
    day: 2, language: "es", mood: 3, risk: "orange",
    summary: "Rose missed her evening Metformin twice this week and said she feels more tired than usual, with some dizziness in the afternoons.",
    transcript: "Pal: Rose, ¿cómo te sientes hoy? Rose: Un poco cansada, y por la tarde me mareo. Anoche se me olvidó la pastilla de la noche.",
    symptoms: [
      { name: "fatigue", severity: "mild", quote: "Estoy un poco cansada." },
      { name: "dizziness", severity: "mild", quote: "Por la tarde me mareo." },
    ],
    visual_notes: ["Looked tired", "Took correct morning tablets"],
    quotes: [
      { original: "Anoche se me olvidó la pastilla de la noche.", english: "Last night I forgot my evening pill." },
      { original: "Por la tarde me mareo.", english: "I get dizzy in the afternoons." },
    ],
  },
  {
    day: 1, language: "en", mood: 5, risk: "green",
    summary: "All morning doses taken on camera. Rose felt rested and was in good spirits after Lily's visit.",
    transcript: "Pal: Good morning Rose! Rose: Good morning! I feel much better today. Lily brought me flowers.",
    symptoms: [],
    visual_notes: ["Alert, smiling", "Took correct tablets with water, waited before breakfast"],
    quotes: [{ original: "I feel much better today.", english: "I feel much better today." }],
  },
];

const ALERT = {
  day: 2,
  time: "19:45",
  reason: "Missed evening Metformin for the second time this week; tiredness and afternoon dizziness reported",
};

const MEMORIES = [
  "Granddaughter Lily visits on Sundays.",
  "Loves gardening; growing tomatoes this year.",
  "Prefers oatmeal for breakfast.",
];

// ---------------------------------------------------------------- run

async function main() {
  const p = await db.from("patients").select("id").eq("preferred_name", "Rose").order("created_at", { ascending: true }).limit(1);
  if (p.error) die("lookup patient", p.error);
  if (p.data.length === 0) die("lookup patient", { message: "no patient named Rose; run npm run seed:patient first" });
  const patientId = p.data[0]!.id as string;

  const m = await db.from("medications").select("*").eq("patient_id", patientId).eq("active", true);
  if (m.error) die("lookup medications", m.error);
  const meds = (m.data as MedicationRow[]).filter((x) => ["Levothyroxine", "Metformin", "Lisinopril"].includes(x.drug ?? ""));

  const doses = [];
  for (let day = 1; day <= 7; day++) {
    for (const med of meds) {
      for (const t of med.times ?? []) {
        const status = EXCEPTIONS[`${day}|${med.drug}|${t}`] ?? "taken";
        const scheduled_at = at(day, t);
        doses.push({
          id: seedId(patientId, `dose:${day}:${med.drug}:${t}`),
          patient_id: patientId,
          medication_id: med.id,
          scheduled_at,
          status,
          confirmed_via: status === "taken" || status === "wrong_pill_caught" ? (t === "08:00" ? "facetime" : "imessage_tapback") : null,
          chert_message_id: null,
          evidence_jpeg_url: null,
          created_at: scheduled_at,
        });
      }
    }
  }

  const calls = CALLS.map((c, i) => {
    const started = at(c.day, "08:05");
    return {
      id: seedId(patientId, `call:${i + 1}`),
      patient_id: patientId,
      chert_call_id: `seed-call-${i + 1}`,
      room_name: `pillpal-check_in-seed${i + 1}`,
      kind: "check_in",
      language: c.language,
      started_at: started,
      ended_at: plusMin(started, 6),
      transcript: c.transcript,
    };
  });
  const checkIns = CALLS.map((c, i) => ({
    id: seedId(patientId, `checkin:${i + 1}`),
    call_id: calls[i]!.id,
    patient_id: patientId,
    mood: c.mood,
    symptoms: c.symptoms,
    visual_notes: c.visual_notes,
    quotes: c.quotes,
    risk_level: c.risk,
    summary: c.summary,
    created_at: calls[i]!.ended_at,
  }));
  const alertAt = at(ALERT.day, ALERT.time);
  const alerts = [{
    id: seedId(patientId, "alert:1"),
    patient_id: patientId,
    level: "orange",
    reason: ALERT.reason,
    sent_to: "caregiver",
    created_at: alertAt,
    acknowledged_at: plusMin(alertAt, 20),
  }];
  const memories = MEMORIES.map((fact, i) => ({
    id: seedId(patientId, `memory:${i + 1}`),
    patient_id: patientId,
    fact,
    created_at: at(7 - i * 2, "09:00"),
  }));

  for (const [table, rows] of [
    ["dose_events", doses],
    ["calls", calls],
    ["check_ins", checkIns],
    ["alerts", alerts],
    ["memories", memories],
  ] as const) {
    const r = await db.from(table).upsert(rows as unknown as Record<string, unknown>[], { onConflict: "id" });
    if (r.error) die(`upsert ${table}`, r.error);
    const n = await db.from(table).select("id", { count: "exact", head: true }).in("id", rows.map((x) => x.id));
    if (n.error) die(`count ${table}`, n.error);
    const extra =
      table === "dose_events"
        ? ` (taken ${doses.filter((d) => d.status === "taken").length}, missed ${doses.filter((d) => d.status === "missed").length}, wrong_pill_caught ${doses.filter((d) => d.status === "wrong_pill_caught").length}, skipped ${doses.filter((d) => d.status === "skipped").length})`
        : "";
    console.log(`${table}: ${n.count}${extra}`);
  }
}

await main();
