import { Hono } from "hono";
import {
  CreatePatientBody,
  UpdatePatientBody,
  type IdResponse,
  type PatientContext,
} from "@pillpal/shared";
import { db } from "../db.js";
import { activeMeds, dueNow, getPatient, must, mustOne, notFound, recentCheckIns, recentMemories } from "../lib/data.js";
import { ValidationError, jsonBody, uuidParam } from "../lib/http.js";
import { addToCareTeam, assertCareTeam, currentUser, requireUser } from "../lib/auth.js";

export const patients = new Hono();

/** Agent: everything Pal needs at the start of a call. */
patients.get("/:id/context", async (c) => {
  const id = uuidParam(c, "id");
  const patient = await getPatient(id);
  const [meds, memories, lastCheckins] = await Promise.all([
    activeMeds(id),
    recentMemories(id, 10),
    recentCheckIns(id, 3),
  ]);
  return c.json({
    patient,
    meds,
    due_now: await dueNow(id, meds),
    memories,
    last_checkins: lastCheckins,
  } satisfies PatientContext);
});

/** Web onboarding form. */
patients.post("/", requireUser, async (c) => {
  const user = currentUser(c);
  const body = await jsonBody(c, CreatePatientBody);
  const row = mustOne("insert patient", await db.from("patients").insert(body).select("id").single());
  // Whoever sets the patient up is on their care team.
  await addToCareTeam(user.id, row.id, user.role);
  return c.json({ id: row.id } satisfies IdResponse, 201);
});

patients.patch("/:id", requireUser, async (c) => {
  const id = uuidParam(c, "id");
  await assertCareTeam(c, id);
  const body = await jsonBody(c, UpdatePatientBody);
  if (Object.keys(body).length === 0) {
    throw new ValidationError([{ path: "(body)", message: "Nothing to update" }]);
  }
  // "" means "clear this optional field" (stored as NULL); name, phone and language can never be cleared.
  const clearable = new Set(["preferred_name", "caregiver_name", "caregiver_phone", "doctor_name", "address"]);
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, clearable.has(k) && v === "" ? null : v]));
  const rows = must("update patient", await db.from("patients").update(patch).eq("id", id).select("id"));
  if (rows.length === 0) throw notFound("patient");
  return c.json({ id } satisfies IdResponse);
});
