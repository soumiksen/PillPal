// All data types come from @pillpal/shared (contracts §5.2–5.4). Only UI view types live here.
import type {
  AlertRow,
  Brief,
  CallRow,
  CheckInRow,
  CreatePatientBody,
  CreateMedicationBody,
  DoseEventRow,
  DoseStatus,
  FoodRule,
  AlertLevel,
  MedicationRow,
  PatientRow,
  Quote,
  RxFields,
  Symptom,
} from "@pillpal/shared";

export type {
  AlertRow,
  Brief,
  CallRow,
  CheckInRow,
  CreatePatientBody,
  CreateMedicationBody,
  DoseEventRow,
  DoseStatus,
  FoodRule,
  AlertLevel,
  MedicationRow,
  PatientRow,
  Quote,
  RxFields,
  Symptom,
};

/**
 * Row types with defaults filled in once at load time (see normalize.ts), so screens don't
 * null-check every column. Columns listed in `Keep` stay nullable because null means something.
 */
type Filled<T, Keep extends keyof T = never> = { [K in Exclude<keyof T, Keep>]-?: NonNullable<T[K]> } & { [K in Keep]: T[K] };

export type Patient = Filled<PatientRow, "consent_at" | "care_chat_id" | "address">;
export type Medication = Filled<MedicationRow, "pills_left" | "refill_info" | "pill_description" | "reference_photo_url" | "confirmed_by">;
export type DoseEvent = Filled<DoseEventRow, "confirmed_via" | "chert_message_id" | "evidence_jpeg_url">;
export type Call = Filled<CallRow, "chert_call_id" | "room_name" | "ended_at" | "transcript" | "language">;
export type CheckIn = Filled<CheckInRow, "call_id">;
/** AlertRow plus the optional summary the API sends with alerts it creates (EscalateBody.summary). */
export type Alert = Filled<AlertRow, "sent_to" | "acknowledged_at"> & { summary?: string | null };

/** Values the API writes to dose_events.confirmed_via. */
export type ConfirmedVia = "facetime" | "tapback" | "photo" | "voice";

/** UI-only: one day in the 7-day history strip/chart. */
export interface DayHistory {
  day: string;
  taken: number;
  total: number;
  mood: number;
}

/**
 * UI-only: live events in the Call room. In mock mode they come from the demo script;
 * with the real API they will come from a call_events table (proposed, not yet in the contract).
 */
export type CallEvent =
  | { kind: "said"; who: "pal" | "patient" | "caregiver"; text: string; english?: string; at: string }
  | { kind: "check"; check: "plate" | "pill"; verdict: string; what_i_see: string; ok: boolean; at: string }
  | { kind: "dose"; medication_id: string; status: DoseStatus; at: string }
  | { kind: "language"; language: string; at: string };
