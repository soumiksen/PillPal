/**
 * Outbound notices that several flows share: reminder text, caregiver texts, low-pill notice.
 * Message bodies are built here and never logged.
 */
import type { MedicationRow, PatientRow } from "@pillpal/shared";
import { messaging } from "../chert/messaging.js";
import { env } from "../env.js";
import { zonedDate } from "./time.js";

export const patientPhone = (p: PatientRow): string | undefined => p.phone ?? env.PATIENT_PHONE ?? undefined;
export const caregiverPhone = (p: PatientRow): string | undefined =>
  p.caregiver_phone ?? env.CAREGIVER_PHONE ?? undefined;
export const displayName = (p: PatientRow, fallback = "your loved one"): string =>
  p.preferred_name ?? p.name ?? fallback;

/** English reminder template (translated with ai.translate before sending). */
export function reminderTemplate(drug: string): string {
  // Shared lines cannot report tapbacks, so the patient is asked to reply instead.
  const confirm = messaging.supports.inboundReactions
    ? "Tap ❤️ on this message once you've taken it."
    : "Reply \"taken\" once you've taken it.";
  return `Time for your ${drug} 💊\n\n${confirm}`;
}

/** Caregiver text; failures are logged (alert rows stay the source of truth). → message id or null. */
export async function textCaregiver(patient: PatientRow, body: string, what: string): Promise<string | null> {
  const phone = caregiverPhone(patient);
  if (!phone) {
    console.warn(`[notify] ${what}: no caregiver phone on file`);
    return null;
  }
  try {
    return await messaging.sendText(phone, body);
  } catch (err) {
    console.error(`[notify] ${what}: caregiver text failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------- low pills

export const LOW_PILLS = 5;
const lowNoticeSent = new Set<string>();

function pharmacyPlace() {
  if (env.PHARMACY_LAT === undefined || env.PHARMACY_LNG === undefined) return undefined;
  return {
    latitude: env.PHARMACY_LAT,
    longitude: env.PHARMACY_LNG,
    label: env.PHARMACY_NAME,
    address: env.PHARMACY_ADDRESS,
  };
}

/** Caregiver text + pharmacy info when pills_left ≤ 5; at most once per day per medication. */
export async function lowPillNotice(patient: PatientRow, med: MedicationRow, now = new Date()): Promise<boolean> {
  if (med.pills_left == null || med.pills_left > LOW_PILLS) return false;
  const d = zonedDate(now);
  const key = `${med.id}|${d.y}-${d.m}-${d.d}`;
  if (lowNoticeSent.has(key)) return false;
  lowNoticeSent.add(key);

  const pharmacy = [env.PHARMACY_NAME, env.PHARMACY_ADDRESS].filter(Boolean).join(", ");
  const lines = [
    `💊 ${displayName(patient)} has ${med.pills_left} ${med.drug ?? "pills"} left.`,
    med.refill_info ? `Refill: ${med.refill_info}` : undefined,
    pharmacy ? `Pharmacy: ${pharmacy}` : undefined,
  ].filter(Boolean);
  const id = await textCaregiver(patient, lines.join("\n"), "low pills");
  const place = pharmacyPlace();
  const phone = caregiverPhone(patient);
  if (place && phone) {
    await messaging.sendPharmacyPin(phone, place).catch((e: Error) => console.error(`[notify] pharmacy pin failed: ${e.message}`));
  }
  console.log(`[notify] low pills notice sent (${med.pills_left} left)`);
  return id !== null;
}
