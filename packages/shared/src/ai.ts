/** 5.4 @pillpal/ai return types (and their structured inputs). */
import { z } from "zod";
import {
  AlertLevel,
  AlertRow,
  CheckInRow,
  DoseEventRow,
  FoodRule,
  MedicationRow,
  PatientRow,
  Quote,
  Symptom,
  Uuid,
} from "./db.js";

export const Confidence = z.number().min(0).max(1);

/** Below this, vision verdicts must be "unsure" (CLAUDE.md safety rule). */
export const VISION_MIN_CONFIDENCE = 0.7;

export const PillCheck = z.object({
  verdict: z.enum(["match", "mismatch", "unsure"]),
  confidence: Confidence,
  what_i_see: z.string(),
  looks_like_med_id: Uuid.optional(),
});
export type PillCheck = z.infer<typeof PillCheck>;

export const PlateCheck = z.object({
  verdict: z.enum(["ok", "wait", "not_allowed"]),
  confidence: Confidence,
  what_i_see: z.string(),
  reason: z.string(),
});
export type PlateCheck = z.infer<typeof PlateCheck>;

/** parseRx() result and POST /rx/parse response. */
export const RxFields = z.object({
  drug: z.string(),
  strength: z.string(),
  dose: z.string(),
  times: z.array(z.string()),
  food_rule: FoodRule,
  avoid_foods: z.array(z.string()),
  quantity: z.number().int().nullable(),
  refills: z.number().int().nullable(),
  warnings: z.array(z.string()),
});
export type RxFields = z.infer<typeof RxFields>;

export const MessageIntent = z.enum([
  "dose_taken",
  "dose_skipped",
  "symptom",
  "question",
  "reschedule",
  "greeting",
  "other",
]);
export type MessageIntent = z.infer<typeof MessageIntent>;

export const ClassifiedMessage = z.object({
  language: z.string(),
  english: z.string(),
  intent: MessageIntent,
  red_flag: z.boolean(),
});
export type ClassifiedMessage = z.infer<typeof ClassifiedMessage>;

export const RiskLevel = z.enum(["green", ...AlertLevel.options]);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Something the agent saw on camera during a call (input to extractCheckIn). */
export const VisionEvent = z.object({
  at: z.string(),
  kind: z.enum(["pill", "plate", "camera_off", "other"]),
  verdict: z.string().optional(),
  what_i_see: z.string(),
  medication_id: Uuid.optional(),
});
export type VisionEvent = z.infer<typeof VisionEvent>;

export const CheckInExtract = z.object({
  summary: z.string(),
  mood: z.number().int().min(1).max(5),
  symptoms: z.array(Symptom),
  visual_notes: z.array(z.string()),
  quotes: z.array(Quote),
  risk_level: RiskLevel,
});
export type CheckInExtract = z.infer<typeof CheckInExtract>;

// Brief lives in db.ts (it is also the reports.brief column type).

/** Input to weeklyBrief(). */
export const WeeklyBriefData = z.object({
  patient: PatientRow,
  week_start: z.string(),
  meds: z.array(MedicationRow),
  dose_events: z.array(DoseEventRow),
  check_ins: z.array(CheckInRow),
  alerts: z.array(AlertRow),
});
export type WeeklyBriefData = z.infer<typeof WeeklyBriefData>;

/** Input to doseChangeMessage() — same fields as POST /notify/dose-change minus ids. */
export const DoseChange = z.object({
  drug: z.string(),
  old_dose: z.string(),
  new_dose: z.string(),
  doctor_note: z.string(),
});
export type DoseChange = z.infer<typeof DoseChange>;

export const DoseChangeMessage = z.object({
  patient_text: z.string(),
  english_text: z.string(),
});
export type DoseChangeMessage = z.infer<typeof DoseChangeMessage>;

export const Transcription = z.object({
  language: z.string(),
  transcript: z.string(),
  english: z.string(),
});
export type Transcription = z.infer<typeof Transcription>;
