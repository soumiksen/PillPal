/**
 * Seed the fictional demo patient "Rose" + 3 active medications.
 * Idempotent: if Rose already exists, nothing is inserted (missing meds are back-filled).
 * Phones come from PATIENT_PHONE / CAREGIVER_PHONE in the repo-root .env — never hard-coded.
 * Prints only the patient id.
 *
 *   npm run seed:patient   (from api/)
 */
import type { MedicationRow, PatientRow } from "@pillpal/shared";
import { db } from "../src/db.js";
import { requireEnv } from "../src/env.js";

type NewPatient = Omit<PatientRow, "id" | "created_at">;
type NewMedication = Omit<MedicationRow, "id" | "created_at">;

const { PATIENT_PHONE, CAREGIVER_PHONE } = requireEnv("PATIENT_PHONE", "CAREGIVER_PHONE");

function die(step: string, err: { code?: string; message: string }): never {
  // code + message only; never row data.
  console.error(`[seed] ${step} failed: ${err.code ?? ""} ${err.message}`.trim());
  process.exit(1);
}

const rose: NewPatient = {
  name: "Rose",
  preferred_name: "Rose",
  phone: PATIENT_PHONE,
  language: "en",
  meal_times: { breakfast: "08:00", lunch: "13:00", dinner: "18:30" },
  caregiver_name: "Maya",
  caregiver_phone: CAREGIVER_PHONE,
  doctor_name: "Dr. Patel",
  address: null,
  consent_at: new Date().toISOString(),
  care_chat_id: null,
};

function meds(patientId: string): NewMedication[] {
  const base = {
    patient_id: patientId,
    dose: "1 tablet",
    pills_left: 30,
    refill_info: null,
    reference_photo_url: null,
    active: true,
    confirmed_by: "seed",
  };
  return [
    { ...base, drug: "Levothyroxine", strength: "50 mcg", times: ["08:00"], food_rule: "empty_stomach",
      avoid_foods: [], pill_description: "small round white tablet" },
    { ...base, drug: "Metformin", strength: "500 mg", times: ["08:00", "18:30"], food_rule: "with_food",
      avoid_foods: ["alcohol"], pill_description: "large white oval tablet" },
    { ...base, drug: "Lisinopril", strength: "10 mg", times: ["13:00"], food_rule: "none",
      avoid_foods: ["potassium salt substitutes"], pill_description: "pink round tablet" },
  ];
}

async function main() {
  const existing = await db
    .from("patients")
    .select("id")
    .eq("preferred_name", "Rose")
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing.error) die("lookup patient", existing.error);

  let patientId: string;
  if (existing.data.length > 0) {
    patientId = existing.data[0]!.id as string;
  } else {
    const inserted = await db.from("patients").insert(rose).select("id").single();
    if (inserted.error) die("insert patient", inserted.error);
    patientId = inserted.data.id as string;
  }

  const have = await db.from("medications").select("drug").eq("patient_id", patientId);
  if (have.error) die("lookup medications", have.error);
  const haveDrugs = new Set(have.data.map((m) => m.drug as string));
  const missing = meds(patientId).filter((m) => !haveDrugs.has(m.drug!));
  if (missing.length) {
    const ins = await db.from("medications").insert(missing);
    if (ins.error) die("insert medications", ins.error);
  }

  console.log(patientId);
}

await main();
