import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as ai from "@pillpal/ai";
import { DoseChangeBody, type DoseChangeResponse } from "@pillpal/shared";
import { messaging } from "../chert/messaging.js";
import { env } from "../env.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";
import { getMedication, getPatient } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";

export const notify = new Hono();

/** Run one send; a failure is logged (name only) and reported as false instead of failing the request. */
async function trySend(step: string, send: () => Promise<unknown>): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (e) {
    console.error(`[notify] ${step} failed: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}

/**
 * Web: doctor changed a dose → patient text + TTS voice note (their language),
 * Care Circle post, English summary to caregiver. The API relays the doctor's change; it never invents one.
 */
notify.post("/dose-change", requireUser, async (c) => {
  const body = await jsonBody(c, DoseChangeBody);
  await assertCareTeam(c, body.patient_id);
  const [patient, med] = await Promise.all([getPatient(body.patient_id), getMedication(body.medication_id)]);
  if (med.patient_id !== patient.id) throw new HTTPException(409, { message: "medication_not_for_patient" });

  const msg = await ai.doseChangeMessage(patient, {
    drug: med.drug ?? "medication",
    old_dose: body.old_dose,
    new_dose: body.new_dose,
    doctor_note: body.doctor_note,
  });

  const patientPhone = patient.phone ?? env.PATIENT_PHONE;
  const caregiverPhone = patient.caregiver_phone ?? env.CAREGIVER_PHONE;

  const text = patientPhone ? await trySend("patient text", () => messaging.sendText(patientPhone, msg.patient_text)) : false;
  const voice = patientPhone
    ? await trySend("voice note", async () => messaging.sendVoiceNote(patientPhone, await ai.tts(msg.patient_text, patient.language ?? "en")))
    : false;
  const group = patient.care_chat_id
    ? await trySend("care circle post", () => messaging.postToChat(patient.care_chat_id!, msg.english_text))
    : caregiverPhone
      ? await trySend("caregiver summary", () => messaging.sendText(caregiverPhone, msg.english_text))
      : false;

  return c.json({ ...msg, sent: { text, voice_note: voice, group_chat: group } } satisfies DoseChangeResponse);
});
