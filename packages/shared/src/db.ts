/** 5.2 Database rows (supabase/schema.sql). Nullable columns are `.nullable()`. */
import { z } from "zod";

/**
 * Any 8-4-4-4-12 hex id. Not z.string().uuid(): zod 4 enforces RFC version/variant bits, but Postgres accepts
 * (and our seed data uses) md5-derived ids that fail that check, which crashed the agent's context parse.
 */
export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid UUID");
/** timestamptz as returned by Supabase (ISO 8601 string). */
export const Timestamp = z.string();
/** `date` column, YYYY-MM-DD. */
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const FoodRule = z.enum(["empty_stomach", "with_food", "none"]);
export type FoodRule = z.infer<typeof FoodRule>;

export const DoseStatus = z.enum(["pending", "taken", "missed", "skipped", "wrong_pill_caught"]);
export type DoseStatus = z.infer<typeof DoseStatus>;

export const AlertLevel = z.enum(["yellow", "orange", "red"]);
export type AlertLevel = z.infer<typeof AlertLevel>;

/** patients.meal_times jsonb, e.g. { breakfast: "08:00", lunch: "12:30", dinner: "18:30" } */
export const MealTimes = z.record(z.string(), z.string());
export type MealTimes = z.infer<typeof MealTimes>;

/** check_ins.quotes jsonb element */
export const Quote = z.object({ original: z.string(), english: z.string() });
export type Quote = z.infer<typeof Quote>;

/** check_ins.symptoms jsonb element */
export const Symptom = z.object({
  name: z.string(),
  severity: z.string().optional(),
  quote: z.string().optional(),
});
export type Symptom = z.infer<typeof Symptom>;

export const PatientRow = z.object({
  id: Uuid,
  name: z.string().nullable(),
  preferred_name: z.string().nullable(),
  phone: z.string().nullable(),
  language: z.string().nullable(),
  meal_times: MealTimes.nullable(),
  caregiver_name: z.string().nullable(),
  caregiver_phone: z.string().nullable(),
  doctor_name: z.string().nullable(),
  address: z.string().nullable(),
  consent_at: Timestamp.nullable(),
  care_chat_id: z.string().nullable(),
  /** Short code a caregiver shares so a doctor can join the care team (supabase/002_accounts.sql). */
  share_code: z.string().nullable().optional(),
  created_at: Timestamp,
});
export type PatientRow = z.infer<typeof PatientRow>;

export const MedicationRow = z.object({
  id: Uuid,
  patient_id: Uuid.nullable(),
  drug: z.string().nullable(),
  strength: z.string().nullable(),
  dose: z.string().nullable(),
  times: z.array(z.string()).nullable(),
  food_rule: FoodRule.nullable(),
  avoid_foods: z.array(z.string()).nullable(),
  pills_left: z.number().int().nullable(),
  refill_info: z.string().nullable(),
  pill_description: z.string().nullable(),
  reference_photo_url: z.string().nullable(),
  active: z.boolean().nullable(),
  confirmed_by: z.string().nullable(),
  created_at: Timestamp,
});
export type MedicationRow = z.infer<typeof MedicationRow>;

export const DoseEventRow = z.object({
  id: Uuid,
  medication_id: Uuid.nullable(),
  patient_id: Uuid.nullable(),
  scheduled_at: Timestamp.nullable(),
  status: DoseStatus,
  confirmed_via: z.string().nullable(),
  chert_message_id: z.string().nullable(),
  evidence_jpeg_url: z.string().nullable(),
  created_at: Timestamp,
});
export type DoseEventRow = z.infer<typeof DoseEventRow>;

export const CallRow = z.object({
  id: Uuid,
  patient_id: Uuid.nullable(),
  chert_call_id: z.string().nullable(),
  room_name: z.string().nullable(),
  kind: z.string().nullable(),
  language: z.string().nullable(),
  started_at: Timestamp,
  ended_at: Timestamp.nullable(),
  transcript: z.string().nullable(),
});
export type CallRow = z.infer<typeof CallRow>;

export const CheckInRow = z.object({
  id: Uuid,
  call_id: Uuid.nullable(),
  patient_id: Uuid.nullable(),
  mood: z.number().int().nullable(),
  symptoms: z.array(Symptom).nullable(),
  visual_notes: z.array(z.string()).nullable(),
  quotes: z.array(Quote).nullable(),
  risk_level: z.string().nullable(),
  summary: z.string().nullable(),
  created_at: Timestamp,
});
export type CheckInRow = z.infer<typeof CheckInRow>;

export const AlertRow = z.object({
  id: Uuid,
  patient_id: Uuid.nullable(),
  level: AlertLevel.nullable(),
  reason: z.string().nullable(),
  sent_to: z.string().nullable(),
  created_at: Timestamp,
  acknowledged_at: Timestamp.nullable(),
});
export type AlertRow = z.infer<typeof AlertRow>;

export const MemoryRow = z.object({
  id: Uuid,
  patient_id: Uuid.nullable(),
  fact: z.string().nullable(),
  created_at: Timestamp,
});
export type MemoryRow = z.infer<typeof MemoryRow>;

/** weeklyBrief() result (5.4) and POST /reports/generate response; stored in reports.brief. */
export const Brief = z.object({
  patient_id: Uuid,
  week_start: z.string(),
  adherence_pct: z.number().min(0).max(100),
  doses_taken: z.number().int(),
  doses_missed: z.number().int(),
  wrong_pills_caught: z.number().int(),
  mood_trend: z.array(z.number().int()),
  symptoms: z.array(Symptom),
  quotes: z.array(Quote),
  concerns: z.array(z.string()),
  summary: z.string(),
});
export type Brief = z.infer<typeof Brief>;

export const ReportRow = z.object({
  id: Uuid,
  patient_id: Uuid.nullable(),
  week_start: DateOnly.nullable(),
  brief: Brief.nullable(),
  doctor_note: z.string().nullable(),
  created_at: Timestamp,
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ChertEventRow = z.object({
  event_id: z.string(),
  received_at: Timestamp,
});
export type ChertEventRow = z.infer<typeof ChertEventRow>;

// ---------------------------------------------------------------- accounts (supabase/002_accounts.sql)

export const AccountRole = z.enum(["caregiver", "doctor"]);
export type AccountRole = z.infer<typeof AccountRole>;

export const ProfileRow = z.object({
  id: Uuid,
  role: AccountRole,
  full_name: z.string().nullable(),
  created_at: Timestamp,
});
export type ProfileRow = z.infer<typeof ProfileRow>;

export const CareTeamRow = z.object({
  user_id: Uuid,
  patient_id: Uuid,
  role: AccountRole,
  created_at: Timestamp,
});
export type CareTeamRow = z.infer<typeof CareTeamRow>;
