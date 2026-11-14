// Fill defaults for nullable Supabase columns once, at the data boundary.
import type { AlertRow, CallRow, CheckInRow, DoseEventRow, MedicationRow, PatientRow } from "@pillpal/shared";
import type { Alert, Call, CheckIn, DoseEvent, Medication, Patient } from "./types";

export const toPatient = (r: PatientRow): Patient => ({
  ...r,
  name: r.name ?? "Patient",
  preferred_name: r.preferred_name ?? r.name?.split(" ")[0] ?? "Patient",
  phone: r.phone ?? "",
  language: r.language ?? "en-US",
  meal_times: r.meal_times ?? {},
  caregiver_name: r.caregiver_name ?? "Caregiver",
  caregiver_phone: r.caregiver_phone ?? "",
  doctor_name: r.doctor_name ?? "Doctor",
});

export const toMedication = (r: MedicationRow): Medication => ({
  ...r,
  patient_id: r.patient_id ?? "",
  drug: r.drug ?? "Medicine",
  strength: r.strength ?? "",
  dose: r.dose ?? "",
  times: r.times ?? [],
  food_rule: r.food_rule ?? "none",
  avoid_foods: r.avoid_foods ?? [],
  active: r.active ?? true,
});

export const toDose = (r: DoseEventRow): DoseEvent => ({
  ...r,
  medication_id: r.medication_id ?? "",
  patient_id: r.patient_id ?? "",
  scheduled_at: r.scheduled_at ?? r.created_at,
});

export const toCall = (r: CallRow): Call => ({ ...r, patient_id: r.patient_id ?? "", kind: r.kind ?? "check_in" });

export const toCheckIn = (r: CheckInRow): CheckIn => ({
  ...r,
  patient_id: r.patient_id ?? "",
  mood: r.mood ?? 3,
  symptoms: r.symptoms ?? [],
  visual_notes: r.visual_notes ?? [],
  quotes: r.quotes ?? [],
  risk_level: r.risk_level ?? "green",
  summary: r.summary ?? "",
});

export const toAlert = (r: AlertRow & { summary?: string | null }): Alert => ({
  ...r,
  patient_id: r.patient_id ?? "",
  level: r.level ?? "yellow",
  reason: r.reason ?? "Alert",
});
