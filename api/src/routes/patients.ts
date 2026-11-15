import { Hono } from "hono";
import {
  CreatePatientBody,
  UpdatePatientBody,
  type IdResponse,
  type PatientContext,
} from "@pillpal/shared";
import { jsonBody, uuidParam } from "../lib/http.js";
import { newId, stubCheckIns, stubDueNow, stubMeds, stubMemories, stubPatient } from "../lib/stubs.js";

export const patients = new Hono();

/** Agent: everything Pal needs at the start of a call. */
patients.get("/:id/context", (c) => {
  const id = uuidParam(c, "id");
  const meds = stubMeds(id);
  return c.json({
    patient: stubPatient(id),
    meds,
    due_now: stubDueNow(meds),
    memories: stubMemories(id),
    last_checkins: stubCheckIns(id),
  } satisfies PatientContext);
});

/** Web onboarding form. */
patients.post("/", async (c) => {
  await jsonBody(c, CreatePatientBody);
  return c.json({ id: newId() } satisfies IdResponse, 201);
});

patients.patch("/:id", async (c) => {
  const id = uuidParam(c, "id");
  await jsonBody(c, UpdatePatientBody);
  return c.json({ id } satisfies IdResponse);
});
