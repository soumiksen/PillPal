/**
 * Seed the Devpost video patient "Shuvo" (caregiver Soumik) + 2 medications + today's pending doses.
 * Idempotent: re-running updates the patient, back-fills missing meds, and resets TODAY's doses to pending.
 * Also gives the last 6 days a taken history (so the pill box looks lived-in) and adds Shuvo to the care team
 * of every caregiver account, so the dashboard can show him.
 * Rose's rows are only read (care_team lookup), never changed.
 * Phones come from PATIENT_PHONE / CAREGIVER_PHONE in the repo-root .env. Prints only the patient id.
 *
 *   npm run video:seed   (repo root)
 */
import type { MedicationRow, PatientRow } from "@pillpal/shared";
import { db } from "../src/db.js";
import { requireEnv } from "../src/env.js";
import { zonedDate, zonedTime } from "../src/lib/time.js";

type NewPatient = Omit<PatientRow, "id" | "created_at">;
type NewMedication = Omit<MedicationRow, "id" | "created_at">;

const { PATIENT_PHONE, CAREGIVER_PHONE } = requireEnv("PATIENT_PHONE", "CAREGIVER_PHONE");

function die(step: string, err: { code?: string; message: string }): never {
  console.error(`[video:seed] ${step} failed: ${err.code ?? ""} ${err.message}`.trim());
  process.exit(1);
}

const shuvo: NewPatient = {
  name: "Shuvo",
  preferred_name: "Shuvo",
  phone: PATIENT_PHONE,
  language: "en",
  meal_times: { breakfast: "08:00", lunch: "13:00", dinner: "20:00" },
  caregiver_name: "Soumik",
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
    food_rule: "with_food" as const,
    avoid_foods: [],
  };
  return [
    { ...base, drug: "Magnesium", strength: "250 mg", times: ["08:00"], pill_description: "white oval tablet" },
    { ...base, drug: "Vitamin B-12", strength: "1000 mcg", times: ["20:00"], pill_description: "small round red tablet" },
  ];
}

async function main() {
  const existing = await db
    .from("patients")
    .select("id")
    .eq("name", "Shuvo")
    .eq("preferred_name", "Shuvo")
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing.error) die("lookup patient", existing.error);

  let patientId: string;
  if (existing.data.length > 0) {
    patientId = existing.data[0]!.id as string;
    const up = await db.from("patients").update(shuvo).eq("id", patientId);
    if (up.error) die("update patient", up.error);
  } else {
    const inserted = await db.from("patients").insert(shuvo).select("id").single();
    if (inserted.error) die("insert patient", inserted.error);
    patientId = inserted.data.id as string;
  }

  // Medications (by drug name).
  const have = await db.from("medications").select("id, drug").eq("patient_id", patientId);
  if (have.error) die("lookup medications", have.error);
  const haveDrugs = new Set(have.data.map((m) => m.drug as string));
  const missing = meds(patientId).filter((m) => !haveDrugs.has(m.drug!));
  if (missing.length) {
    const ins = await db.from("medications").insert(missing);
    if (ins.error) die("insert medications", ins.error);
  }
  const all = await db.from("medications").select("id, drug, times").eq("patient_id", patientId).eq("active", true);
  if (all.error) die("read medications", all.error);

  // Dose events: today pending, the 6 days before taken (America/Chicago days).
  const today = zonedDate(new Date());
  for (let back = 6; back >= 0; back--) {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.d - back));
    const day = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    for (const med of all.data as { id: string; times: string[] }[]) {
      for (const t of med.times) {
        const at = zonedTime(day, t)!.toISOString();
        const status = back === 0 ? "pending" : "taken";
        const found = await db.from("dose_events").select("id").eq("medication_id", med.id).eq("scheduled_at", at);
        if (found.error) die("lookup dose", found.error);
        if (found.data.length) {
          if (back === 0) {
            const r = await db
              .from("dose_events")
              .update({ status: "pending", confirmed_via: null, evidence_jpeg_url: null })
              .in("id", found.data.map((x) => x.id as string));
            if (r.error) die("reset today's dose", r.error);
          }
          continue;
        }
        const r = await db.from("dose_events").insert({
          patient_id: patientId,
          medication_id: med.id,
          scheduled_at: at,
          status,
          confirmed_via: status === "taken" ? "imessage_tapback" : null,
        });
        if (r.error) die("insert dose", r.error);
      }
    }
  }

  // Dashboard access: every signed-up caregiver account sees Shuvo (hackathon accounts; Rose is not touched).
  const users = await db.from("profiles").select("id").eq("role", "caregiver");
  if (users.error) die("lookup caregivers", users.error);
  if (users.data.length) {
    const rows = users.data.map((u) => ({ user_id: u.id as string, patient_id: patientId, role: "caregiver" }));
    const r = await db.from("care_team").upsert(rows, { onConflict: "user_id,patient_id", ignoreDuplicates: true });
    if (r.error) die("link care team", r.error);
  }

  console.log(patientId);
}

await main();
