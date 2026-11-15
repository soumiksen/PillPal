import { Hono } from "hono";
import { SymptomBody, type OkResponse, type Symptom } from "@pillpal/shared";
import { db } from "../db.js";
import { activeCall, getPatient, must, openCheckIn } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";

export const symptoms = new Hono();

/**
 * Agent: record a symptom the patient mentioned. It goes into the patient's open check-in
 * (not yet finalized by /calls/ended), or a new one linked to the active call if any.
 */
symptoms.post("/", async (c) => {
  const body = await jsonBody(c, SymptomBody);
  await getPatient(body.patient_id);
  const symptom: Symptom = { name: body.name, severity: body.severity, quote: body.quote };

  const open = await openCheckIn(body.patient_id);
  if (open) {
    must(
      "append symptom",
      await db
        .from("check_ins")
        .update({ symptoms: [...(open.symptoms ?? []), symptom] })
        .eq("id", open.id),
    );
  } else {
    const call = await activeCall(body.patient_id);
    must(
      "create check-in",
      await db.from("check_ins").insert({
        patient_id: body.patient_id,
        call_id: call?.id ?? null,
        symptoms: [symptom],
      }),
    );
  }
  return c.json({ ok: true } satisfies OkResponse);
});
