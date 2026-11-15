/**
 * Red-flag escalation, shared by POST /escalate, red-flag texts and red check-ins (called directly).
 *
 * Synchronous part (the HTTP response waits only for this; well under 5 s):
 *   1. red alert row
 *   2. caregiver iMessage "🔴 PillPal alert for {name}: {reason}. Pal is calling you both on FaceTime now. …"
 * Async part (callTask):
 *   3. an active 1:1 call is ended, then we wait (≤ 10 s) until Chert reports it terminal
 *   4. group FaceTime, recipients [patient, caregiver], kind "escalation"
 *   5. on facetime_group_unavailable / recipient_not_verified / any failure: caregiver text
 *      "Please FaceTime {name} now." and alerts.sent_to records the fallback
 * Never auto-calls 911.
 */
import type { AlertRow } from "@pillpal/shared";
import { FaceTimeError, facetime } from "../chert/facetime.js";
import { db } from "../db.js";
import { getPatient, must } from "../lib/data.js";
import { caregiverPhone, displayName, patientPhone, textCaregiver } from "../lib/notices.js";

export type EscalateInput = {
  patient_id: string;
  reason: string;
  summary?: string;
  /** The live call room, when escalating from a call. */
  room_name?: string;
};

export type GroupOutcome =
  | { kind: "group_call"; chert_call_id: string; room_name: string }
  | { kind: "fallback_text"; code: string; message_id: string | null }
  | { kind: "skipped"; reason: string };

export type EscalateResult = {
  alert_id: string;
  caregiver_message_id: string | null;
  /** Placed asynchronously; null in the HTTP response. */
  group_call_id: string | null;
  /** Resolves when the call part is done (tests await it; routes do not). */
  callTask: Promise<GroupOutcome>;
};

const END_WAIT_MS = 10_000;

export async function escalate(input: EscalateInput): Promise<EscalateResult> {
  const patient = await getPatient(input.patient_id);
  const name = displayName(patient, "the patient");
  const hasCaregiver = Boolean(caregiverPhone(patient));

  const alert = must(
    "insert alert",
    await db
      .from("alerts")
      .insert({ patient_id: patient.id, level: "red", reason: input.reason, sent_to: hasCaregiver ? "caregiver" : null })
      .select("*")
      .single(),
  ) as AlertRow;

  const reason = input.reason.replace(/[.\s]+$/, "");
  const caregiverMessageId = await textCaregiver(
    patient,
    `🔴 PillPal alert for ${name}: ${reason}. Pal is calling you both on FaceTime now. If this is an emergency, call 911.`,
    "escalation",
  );
  console.log(`[escalate] red alert created${caregiverMessageId ? ", caregiver texted" : ""}`);

  const callTask = groupCall(patient.id, alert.id, input.room_name).catch((err: Error): GroupOutcome => {
    console.error(`[escalate] call part failed: ${err.message}`);
    return { kind: "skipped", reason: "error" };
  });
  return { alert_id: alert.id, caregiver_message_id: caregiverMessageId, group_call_id: null, callTask };
}

async function setSentTo(alertId: string, sentTo: string): Promise<void> {
  must("update alert sent_to", await db.from("alerts").update({ sent_to: sentTo }).eq("id", alertId));
}

async function groupCall(patientId: string, alertId: string, _roomName?: string): Promise<GroupOutcome> {
  const patient = await getPatient(patientId);
  const name = displayName(patient, "the patient");

  const active = facetime.activeLine();
  if (active?.group && active.patient_id === patientId) {
    console.log("[escalate] group call already active, not placing another");
    return { kind: "skipped", reason: "group_call_active" };
  }
  // 1 line = 1 call: end whatever call holds the line (normally the escalating 1:1 call in `roomName`).
  if (active?.chert_call_id) {
    try {
      await facetime.endCall(active.chert_call_id);
      const ended = await facetime.waitUntilEnded(active.chert_call_id, END_WAIT_MS);
      console.log(`[escalate] 1:1 call ${ended ? "ended" : "did not end within 10 s"}`);
      if (!ended) await facetime.markEnded(active.chert_call_id);
    } catch (err) {
      console.error(`[escalate] ending 1:1 call failed: ${(err as Error).message}`);
      await facetime.markEnded(active.chert_call_id).catch(() => undefined);
    }
  }

  const patientNumber = patientPhone(patient);
  const caregiverNumber = caregiverPhone(patient);
  let code = "missing_phone";
  if (patientNumber && caregiverNumber) {
    try {
      const placed = await facetime.dialGroup(patientId, [patientNumber, caregiverNumber], "escalation");
      await setSentTo(alertId, "caregiver,group_facetime");
      console.log("[escalate] group FaceTime placed");
      return { kind: "group_call", chert_call_id: placed.chert_call_id, room_name: placed.room_name };
    } catch (err) {
      code = err instanceof FaceTimeError ? err.code : (err as { message?: string }).message === "line_busy" ? "line_busy" : "error";
      console.warn(`[escalate] group FaceTime unavailable (${code}), texting caregiver instead`);
    }
  }
  const messageId = await textCaregiver(patient, `Please FaceTime ${name} now.`, "escalation fallback");
  await setSentTo(alertId, `caregiver,fallback_text:${code}`);
  return { kind: "fallback_text", code, message_id: messageId };
}
