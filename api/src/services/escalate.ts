/**
 * Red-flag escalation, shared by POST /escalate and inbound Chert events (called directly, not over HTTP).
 * Red alert row → iMessage to the caregiver. Never auto-calls 911.
 * TODO(next PR): end the 1:1 call and start a group FaceTime (patient + caregiver).
 */
import type { AlertRow } from "@pillpal/shared";
import { messaging } from "../chert/messaging.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { getPatient, must } from "../lib/data.js";

export type EscalateInput = {
  patient_id: string;
  reason: string;
  summary?: string;
  /** The live call room, when escalating from a call. */
  room_name?: string;
};

export type EscalateResult = { alert_id: string; caregiver_message_id: string | null; group_call_id: string | null };

export async function escalate(input: EscalateInput): Promise<EscalateResult> {
  const patient = await getPatient(input.patient_id);
  const caregiverPhone = patient.caregiver_phone ?? env.CAREGIVER_PHONE;

  const alert = must(
    "insert alert",
    await db
      .from("alerts")
      .insert({
        patient_id: patient.id,
        level: "red",
        reason: input.reason,
        sent_to: caregiverPhone ? "caregiver" : null,
      })
      .select("*")
      .single(),
  ) as AlertRow;

  let caregiverMessageId: string | null = null;
  if (caregiverPhone) {
    const name = patient.preferred_name ?? patient.name ?? "your loved one";
    const detail = [input.reason, input.summary].filter(Boolean).join(" — ");
    const text = `🔴 PillPal alert for ${name}: ${detail}\n\nIf this is an emergency, call 911.`;
    try {
      caregiverMessageId = await messaging.sendText(caregiverPhone, text);
    } catch (err) {
      // The alert row is the source of truth; the dashboard still shows it.
      console.error(`[escalate] caregiver text failed: ${(err as Error).message}`);
    }
  } else {
    console.warn("[escalate] no caregiver phone on file; alert row only");
  }
  console.log(`[escalate] red alert created${caregiverMessageId ? ", caregiver texted" : ""}`);

  return { alert_id: alert.id, caregiver_message_id: caregiverMessageId, group_call_id: null };
}
