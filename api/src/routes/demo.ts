import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as ai from "@pillpal/ai";
import { DemoRemindBody, type DemoRemindResponse, type DoseEventRow } from "@pillpal/shared";
import { messaging } from "../chert/messaging.js";
import { findDoseEvent, getMedication, getPatient, insertDoseEvent, updateDoseEvent } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { patientPhone, reminderTemplate } from "../lib/notices.js";
import { nearestSlot } from "../lib/time.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";

export const demo = new Hono();

/**
 * Web: send a reminder (works in CHERT_MODE mock, live and shared; on Shared the patient replies
 * "taken" instead of tapping ❤, see lib/notices.ts) for a medication right now.
 * Uses the pending dose_event for the med's nearest scheduled time (creating it if needed); if that
 * slot is already resolved, a fresh pending event is created at "now" so the demo can be re-run.
 */
demo.post("/remind", requireUser, async (c) => {
  const body = await jsonBody(c, DemoRemindBody);
  await assertCareTeam(c, body.patient_id);
  const [patient, med] = await Promise.all([getPatient(body.patient_id), getMedication(body.medication_id)]);
  if (med.patient_id !== patient.id) throw new HTTPException(409, { message: "medication_not_for_patient" });
  const phone = patientPhone(patient);
  if (!phone) throw new HTTPException(409, { message: "patient_has_no_phone" });

  const slot = nearestSlot(med.times) ?? new Date();
  const existing = await findDoseEvent(med.id, slot);
  let dose: DoseEventRow;
  if (existing?.status === "pending") dose = existing;
  else {
    dose = await insertDoseEvent({
      patient_id: patient.id,
      medication_id: med.id,
      scheduled_at: (existing ? new Date() : slot).toISOString(),
      status: "pending",
    });
  }

  const text = await ai.translate(reminderTemplate(med.drug ?? "medicine"), patient.language ?? "en");
  const messageId = await messaging.sendText(phone, text);
  await updateDoseEvent(dose.id, { chert_message_id: messageId });

  return c.json({ dose_event_id: dose.id, chert_message_id: messageId } satisfies DemoRemindResponse);
});
