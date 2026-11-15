/** 5.3 REST API request/response bodies (api/ on :8787). */
import { z } from "zod";
import { CheckInExtract, RxFields, VisionEvent } from "./ai.js";
import {
  CheckInRow,
  DoseStatus,
  FoodRule,
  MealTimes,
  MedicationRow,
  MemoryRow,
  PatientRow,
  Uuid,
} from "./db.js";

export const IdResponse = z.object({ id: Uuid });
export type IdResponse = z.infer<typeof IdResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/** Medication due in the current window (GET /patients/:id/context → due_now[]). */
export const DueDose = z.object({
  dose_event_id: Uuid.optional(),
  medication_id: Uuid,
  drug: z.string(),
  dose: z.string(),
  scheduled_at: z.string(),
  food_rule: FoodRule,
});
export type DueDose = z.infer<typeof DueDose>;

/** GET /patients/:id/context */
export const PatientContext = z.object({
  patient: PatientRow,
  meds: z.array(MedicationRow),
  due_now: z.array(DueDose),
  memories: z.array(MemoryRow),
  last_checkins: z.array(CheckInRow),
});
export type PatientContext = z.infer<typeof PatientContext>;

/** POST /patients → IdResponse */
export const CreatePatientBody = z.object({
  name: z.string().min(1),
  preferred_name: z.string().optional(),
  phone: z.string().min(1),
  language: z.string().default("en"),
  meal_times: MealTimes.optional(),
  caregiver_name: z.string().optional(),
  caregiver_phone: z.string().optional(),
  doctor_name: z.string().optional(),
  address: z.string().optional(),
  consent_at: z.string().optional(),
});
export type CreatePatientBody = z.infer<typeof CreatePatientBody>;

/** PATCH /patients/:id → IdResponse */
/** International phone number, e.g. +18175550142 (Chert needs E.164 to dial or text). */
const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the international format, like +18175550142");

/**
 * Every field optional and WITHOUT defaults: building this from CreatePatientBody.partial() would inject
 * language: "en" into every PATCH and silently reset the patient's language. "" clears an optional text field.
 */
export const UpdatePatientBody = z.object({
  name: z.string().trim().min(1).optional(),
  preferred_name: z.string().trim().optional(),
  phone: E164.optional(),
  language: z.string().trim().min(2).optional(),
  meal_times: MealTimes.optional(),
  caregiver_name: z.string().trim().optional(),
  caregiver_phone: E164.or(z.literal("")).optional(),
  doctor_name: z.string().trim().optional(),
  address: z.string().trim().optional(),
  consent_at: z.string().optional(),
  care_chat_id: z.string().optional(),
});
export type UpdatePatientBody = z.infer<typeof UpdatePatientBody>;

/** POST /rx/parse (multipart field "photo") → RxFields */
export const RxParseResponse = RxFields;
export type RxParseResponse = RxFields;

/**
 * POST /medications (JSON fields; or multipart with these fields + "pill_photo") → IdResponse.
 * The API stores the photo and fills pill_description via ai.describePill.
 */
export const CreateMedicationBody = z.object({
  patient_id: Uuid,
  drug: z.string().min(1),
  strength: z.string(),
  dose: z.string(),
  times: z.array(z.string()),
  food_rule: FoodRule,
  avoid_foods: z.array(z.string()).default([]),
  pills_left: z.number().int().optional(),
  refill_info: z.string().optional(),
  confirmed_by: z.string(),
  pill_photo_b64: z.string().optional(),
});
export type CreateMedicationBody = z.infer<typeof CreateMedicationBody>;

/** PATCH /medications/:id → IdResponse */
/** 24-hour dose time, e.g. 08:00. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour times like 08:00");

/**
 * Every field optional and WITHOUT defaults. Built from CreateMedicationBody.partial() this injected
 * avoid_foods: [] into every PATCH, so changing only a dose silently erased the medicine's avoid-foods list.
 * `active: false` stops a medicine (history is kept).
 */
export const UpdateMedicationBody = z.object({
  drug: z.string().trim().min(1).optional(),
  strength: z.string().trim().min(1).optional(),
  dose: z.string().trim().min(1).optional(),
  times: z.array(HHMM).min(1).optional(),
  food_rule: FoodRule.optional(),
  avoid_foods: z.array(z.string().trim().min(1)).optional(),
  pills_left: z.number().int().min(0).optional(),
  refill_info: z.string().optional(),
  confirmed_by: z.string().optional(),
  pill_photo_b64: z.string().optional(),
  active: z.boolean().optional(),
});
export type UpdateMedicationBody = z.infer<typeof UpdateMedicationBody>;

/** Changing any of these changes the prescription itself: doctors only (pills_left, refill_info and the photo are not). */
export const PRESCRIPTION_FIELDS = ["drug", "strength", "dose", "times", "food_rule", "avoid_foods", "active"] as const;
export const touchesPrescription = (patch: Record<string, unknown>): boolean =>
  PRESCRIPTION_FIELDS.some((k) => patch[k] !== undefined);

/** POST /doses → IdResponse */
export const CreateDoseBody = z.object({
  patient_id: Uuid,
  medication_id: Uuid,
  status: DoseStatus,
  confirmed_via: z.string(),
  evidence_jpeg_b64: z.string().optional(),
});
export type CreateDoseBody = z.infer<typeof CreateDoseBody>;

/** POST /symptoms → OkResponse */
export const SymptomBody = z.object({
  patient_id: Uuid,
  name: z.string(),
  severity: z.string(),
  quote: z.string(),
});
export type SymptomBody = z.infer<typeof SymptomBody>;

/** POST /memories → IdResponse */
export const MemoryBody = z.object({
  patient_id: Uuid,
  fact: z.string().min(1),
});
export type MemoryBody = z.infer<typeof MemoryBody>;

export const CallKind = z.enum(["check_in", "reminder", "group", "inbound", "dose", "escalation"]);
export type CallKind = z.infer<typeof CallKind>;

/** POST /calls/started → IdResponse */
export const CallStartedBody = z.object({
  patient_id: Uuid,
  room_name: z.string(),
  chert_call_id: z.string().optional(),
  kind: CallKind,
});
export type CallStartedBody = z.infer<typeof CallStartedBody>;

/** POST /calls/ended → CallEndedResponse (runs ai.extractCheckIn) */
export const CallEndedBody = z.object({
  room_name: z.string(),
  transcript: z.string(),
  language: z.string(),
  vision_events: z.array(VisionEvent),
});
export type CallEndedBody = z.infer<typeof CallEndedBody>;

export const CallEndedResponse = z.object({
  /** null when the call had no conversation (unanswered web call): no check-in is written. */
  check_in_id: Uuid.nullable(),
  check_in: CheckInExtract.nullable(),
});
export type CallEndedResponse = z.infer<typeof CallEndedResponse>;

/** POST /escalate → red alert iMessage, end 1:1 call, start group FaceTime */
export const EscalateBody = z.object({
  patient_id: Uuid,
  room_name: z.string(),
  reason: z.string(),
  summary: z.string(),
  /** "patient" when she asked for her caregiver herself (web call transport). */
  requested_by: z.enum(["patient", "pal", "system"]).optional(),
});
export type EscalateBody = z.infer<typeof EscalateBody>;

export const EscalateResponse = z.object({
  alert_id: Uuid,
  group_call_id: z.string().nullable(),
});
export type EscalateResponse = z.infer<typeof EscalateResponse>;

/** POST /dial */
export const DialBody = z.object({
  patient_id: Uuid,
  kind: z.enum(["check_in", "dose"]).default("check_in"),
});
export type DialBody = z.infer<typeof DialBody>;

export const DialResponse = z.object({
  /** Chert FaceTime call id (CALL_TRANSPORT=facetime); null for web calls. */
  chert_call_id: z.string().nullable(),
  room_name: z.string(),
  /** calls.id */
  call_id: z.string().optional(),
});
export type DialResponse = z.infer<typeof DialResponse>;

/** POST /demo/remind → tapback reminder now */
export const DemoRemindBody = z.object({
  patient_id: Uuid,
  medication_id: Uuid,
});
export type DemoRemindBody = z.infer<typeof DemoRemindBody>;

export const DemoRemindResponse = z.object({
  dose_event_id: Uuid,
  chert_message_id: z.string(),
});
export type DemoRemindResponse = z.infer<typeof DemoRemindResponse>;

/** POST /reports/generate → Brief */
export const GenerateReportBody = z.object({ patient_id: Uuid });
export type GenerateReportBody = z.infer<typeof GenerateReportBody>;

/** POST /notify/dose-change → text + voice note + group chat */
export const DoseChangeBody = z.object({
  patient_id: Uuid,
  medication_id: Uuid,
  old_dose: z.string(),
  new_dose: z.string(),
  doctor_note: z.string(),
});
export type DoseChangeBody = z.infer<typeof DoseChangeBody>;

export const DoseChangeResponse = z.object({
  patient_text: z.string(),
  english_text: z.string(),
  sent: z.object({ text: z.boolean(), voice_note: z.boolean(), group_chat: z.boolean() }),
});
export type DoseChangeResponse = z.infer<typeof DoseChangeResponse>;
