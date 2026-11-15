/** Recipient role labels: the only thing logs ever say about a phone. */
import { env } from "../env.js";

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);

export function recipientLabel(phone: string): "patient" | "caregiver" | "recipient" {
  const d = digits(phone);
  if (d && env.PATIENT_PHONE && d === digits(env.PATIENT_PHONE)) return "patient";
  if (d && env.CAREGIVER_PHONE && d === digits(env.CAREGIVER_PHONE)) return "caregiver";
  return "recipient";
}
