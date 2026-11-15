/**
 * Realistic stub rows for the skeleton (fictional demo patient "Rose").
 * Phone fields are null on purpose: stubs never carry phone numbers.
 * Replaced by Supabase queries as each endpoint goes real.
 */
import type {
  CheckInRow,
  DueDose,
  MedicationRow,
  MemoryRow,
  PatientRow,
} from "@pillpal/shared";

const STUB_MED_IDS = {
  levothyroxine: "6f1c2a0e-3b7d-4c51-9a2e-0d8b7f4e1a01",
  metformin: "6f1c2a0e-3b7d-4c51-9a2e-0d8b7f4e1a02",
  lisinopril: "6f1c2a0e-3b7d-4c51-9a2e-0d8b7f4e1a03",
} as const;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export function stubPatient(id: string): PatientRow {
  return {
    id,
    name: "Rose",
    preferred_name: "Rose",
    phone: null,
    language: "en",
    meal_times: { breakfast: "08:00", lunch: "13:00", dinner: "18:30" },
    caregiver_name: "Maya",
    caregiver_phone: null,
    doctor_name: "Dr. Patel",
    address: null,
    consent_at: daysAgo(7),
    care_chat_id: null,
    created_at: daysAgo(7),
  };
}

export function stubMeds(patientId: string): MedicationRow[] {
  const base = {
    patient_id: patientId,
    dose: "1 tablet",
    pills_left: 30,
    refill_info: null,
    reference_photo_url: null,
    active: true,
    confirmed_by: "Maya",
    created_at: daysAgo(7),
  };
  return [
    {
      ...base,
      id: STUB_MED_IDS.levothyroxine,
      drug: "Levothyroxine",
      strength: "50 mcg",
      times: ["08:00"],
      food_rule: "empty_stomach",
      avoid_foods: [],
      pill_description: "small round white tablet",
    },
    {
      ...base,
      id: STUB_MED_IDS.metformin,
      drug: "Metformin",
      strength: "500 mg",
      times: ["08:00", "18:30"],
      food_rule: "with_food",
      avoid_foods: ["alcohol"],
      pill_description: "large white oval tablet",
    },
    {
      ...base,
      id: STUB_MED_IDS.lisinopril,
      drug: "Lisinopril",
      strength: "10 mg",
      times: ["13:00"],
      food_rule: "none",
      avoid_foods: ["potassium salt substitutes"],
      pill_description: "pink round tablet",
    },
  ];
}

export function stubDueNow(meds: MedicationRow[]): DueDose[] {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  return meds
    .filter((m) => m.times?.includes("08:00"))
    .map((m) => ({
      medication_id: m.id,
      drug: m.drug ?? "",
      dose: m.dose ?? "",
      scheduled_at: today.toISOString(),
      food_rule: m.food_rule ?? "none",
    }));
}

export function stubMemories(patientId: string): MemoryRow[] {
  return [
    { id: "2b9e4c1d-5a6f-4e3b-8c7d-1f0a9b8c7d01", patient_id: patientId, fact: "Granddaughter Lily visits on Sundays.", created_at: daysAgo(5) },
    { id: "2b9e4c1d-5a6f-4e3b-8c7d-1f0a9b8c7d02", patient_id: patientId, fact: "Loves gardening; growing tomatoes this year.", created_at: daysAgo(3) },
  ];
}

export function stubCheckIns(patientId: string): CheckInRow[] {
  return [
    {
      id: "8d3f2e1a-7b6c-4d5e-9f0a-1b2c3d4e5f01",
      call_id: null,
      patient_id: patientId,
      mood: 4,
      symptoms: [{ name: "dizziness", severity: "mild", quote: "I got a little dizzy when I stood up." }],
      visual_notes: ["Alert and well-groomed", "Took correct tablet with water"],
      quotes: [{ original: "I got a little dizzy when I stood up.", english: "I got a little dizzy when I stood up." }],
      risk_level: "yellow",
      summary: "Took Levothyroxine on camera before breakfast. Mild dizziness on standing.",
      created_at: daysAgo(1),
    },
  ];
}

/** Stand-in id for rows the stub would have inserted. */
export const newId = () => crypto.randomUUID();
