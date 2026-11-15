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
 *
 * CALL_TRANSPORT=web (default) replaces steps 3–5: the caregiver's PillPal Care app rings into the SAME LiveKit room
 * (Pal + patient + caregiver); with no active call a new escalation room is started and both phones ring.
 * requested_by "patient" (she asked for her caregiver) is an orange alert, not red.
 */
import type { AlertRow } from "@pillpal/shared";
import { webCalls } from "../calls/index.js";
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
  requested_by?: "patient" | "pal" | "system";
};

export type GroupOutcome =
  | { kind: "group_call"; chert_call_id: string; room_name: string }
  | { kind: "web_ring"; room_name: string; new_call: boolean }
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
  const asked = input.requested_by === "patient";

  const alert = must(
    "insert alert",
    await db
      .from("alerts")
      .insert({ patient_id: patient.id, level: asked ? "orange" : "red", reason: input.reason, sent_to: hasCaregiver ? "caregiver" : null })
      .select("*")
      .single(),
  ) as AlertRow;

  const reason = input.reason.replace(/[.\s]+$/, "");
  const how = webCalls ? "Your PillPal Care app is ringing — tap Accept to join Pal and " + name + "." : "Pal is calling you both on FaceTime now.";
  const caregiverMessageId = await textCaregiver(
    patient,
    asked
      ? `📞 ${name} is asking for you on a PillPal call (${reason}). ${how}`
      : `🔴 PillPal alert for ${name}: ${reason}. ${how} If this is an emergency, call 911.`,
    "escalation",
  );
  console.log(`[escalate] ${asked ? "orange" : "red"} alert created${caregiverMessageId ? ", caregiver texted" : ""}`);

  const task = webCalls ? webRing(patient.id, alert.id) : groupCall(patient.id, alert.id, input.room_name);
  const callTask = task.catch((err: Error): GroupOutcome => {
    console.error(`[escalate] call part failed: ${err.message}`);
    return { kind: "skipped", reason: "error" };
  });
  return { alert_id: alert.id, caregiver_message_id: caregiverMessageId, group_call_id: null, callTask };
}

/** Web transport: ring the caregiver's app into the current room (or start a room that rings both). */
async function webRing(patientId: string, alertId: string): Promise<GroupOutcome> {
  const r = await webCalls!.ringCaregiver(patientId);
  await setSentTo(alertId, r.new_call ? "caregiver,web_call_both" : "caregiver,web_call_join");
  console.log(`[escalate] caregiver app ringing (${r.new_call ? "new call, both phones" : "joining the current call"})`);
  return { kind: "web_ring", room_name: r.room_name, new_call: r.new_call };
}

async function setSentTo(alertId: string, sentTo: string): Promise<void> {
  must("update alert sent_to", await db.from("alerts").update({ sent_to: sentTo }).eq("id", alertId));
}

/**
 * Chert needs a moment to finish cleaning up the 1:1 call before the line can start a new one: the create is refused
 * with invalid_state (or line_busy) right after the call ends. Retry for up to ~24 s before giving up to the text fallback.
 */
async function dialGroupWhenLineFree(patientId: string, phones: string[]) {
  const attempts = 8;
  for (let i = 1; ; i++) {
    try {
      return await facetime.dialGroup(patientId, phones, "escalation");
    } catch (err) {
      const code = err instanceof FaceTimeError ? err.code : (err as { message?: string }).message === "line_busy" ? "line_busy" : "";
      if ((code !== "invalid_state" && code !== "line_busy") || i >= attempts) throw err;
      console.log(`[escalate] line not ready for the group call (${code}), retry ${i}/${attempts - 1} in 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
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
      const placed = await dialGroupWhenLineFree(patientId, [patientNumber, caregiverNumber]);
      await setSentTo(alertId, "caregiver,group_facetime");
      console.log("[escalate] group FaceTime placed");
      return { kind: "group_call", chert_call_id: placed.chert_call_id, room_name: placed.room_name };
    } catch (err) {
      code = err instanceof FaceTimeError ? err.code : (err as { message?: string }).message === "line_busy" ? "line_busy" : "error";
      console.warn(`[escalate] group FaceTime unavailable (${code}${err instanceof Error ? `: ${err.message.slice(0, 160)}` : ""}), texting caregiver instead`);
    }
  }
  const messageId = await textCaregiver(patient, `Please FaceTime ${name} now.`, "escalation fallback");
  await setSentTo(alertId, `caregiver,fallback_text:${code}`);
  return { kind: "fallback_text", code, message_id: messageId };
}
