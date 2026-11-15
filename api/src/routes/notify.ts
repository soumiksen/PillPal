import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import { DoseChangeBody, type DoseChangeResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { stubMeds, stubPatient } from "../lib/stubs.js";

export const notify = new Hono();

/**
 * Web: doctor changed a dose → patient text + TTS voice note (their language),
 * Care Circle post, English summary to caregiver. The API relays the doctor's change; it never invents one.
 */
notify.post("/dose-change", async (c) => {
  const body = await jsonBody(c, DoseChangeBody);
  const patient = stubPatient(body.patient_id);
  const med = stubMeds(body.patient_id).find((m) => m.id === body.medication_id);
  const msg = await ai.doseChangeMessage(patient, {
    drug: med?.drug ?? "medication",
    old_dose: body.old_dose,
    new_dose: body.new_dose,
    doctor_note: body.doctor_note,
  });
  await ai.tts(msg.patient_text, patient.language ?? "en"); // stub: voice note not sent yet
  return c.json({
    ...msg,
    sent: { text: false, voice_note: false, group_chat: false },
  } satisfies DoseChangeResponse);
});
