import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { CreateDoseBody, type IdResponse } from "@pillpal/shared";
import { findDoseEvent, getMedication, insertDoseEvent, updateDoseEvent } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { uploadEvidence } from "../lib/storage.js";
import { nearestSlot } from "../lib/time.js";

export const doses = new Hono();

/**
 * Agent: log a dose outcome (optionally with an evidence frame → private "evidence" bucket).
 * Upserts today's dose_event for the med's scheduled time closest to now (America/Chicago);
 * a med with no valid times is logged at "now".
 */
doses.post("/", async (c) => {
  const body = await jsonBody(c, CreateDoseBody);
  const med = await getMedication(body.medication_id);
  if (med.patient_id !== body.patient_id) {
    throw new HTTPException(409, { message: "medication_not_for_patient" });
  }

  const evidence_jpeg_url = body.evidence_jpeg_b64
    ? await uploadEvidence(body.patient_id, body.evidence_jpeg_b64)
    : undefined;
  const scheduledAt = nearestSlot(med.times) ?? new Date();
  const patch = {
    status: body.status,
    confirmed_via: body.confirmed_via,
    ...(evidence_jpeg_url ? { evidence_jpeg_url } : {}),
  };

  const existing = await findDoseEvent(med.id, scheduledAt);
  if (existing) {
    await updateDoseEvent(existing.id, patch);
    return c.json({ id: existing.id } satisfies IdResponse);
  }
  const row = await insertDoseEvent({
    patient_id: body.patient_id,
    medication_id: med.id,
    scheduled_at: scheduledAt.toISOString(),
    ...patch,
  });
  return c.json({ id: row.id } satisfies IdResponse, 201);
});
