import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import {
  CallEndedBody,
  CallStartedBody,
  type CallEndedResponse,
  type CallRow,
  type IdResponse,
  type Symptom,
} from "@pillpal/shared";
import { db } from "../db.js";
import { activeMeds, getPatient, must, mustOne, notFound, openCheckIn } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";

export const calls = new Hono();

/** Agent: a call room went live. */
calls.post("/started", async (c) => {
  const body = await jsonBody(c, CallStartedBody);
  const patient = await getPatient(body.patient_id);
  const row = mustOne(
    "insert call",
    await db
      .from("calls")
      .insert({
        patient_id: body.patient_id,
        room_name: body.room_name,
        chert_call_id: body.chert_call_id ?? null,
        kind: body.kind,
        language: patient.language,
      })
      .select("id")
      .single(),
  );
  return c.json({ id: row.id } satisfies IdResponse, 201);
});

/** Agent: call finished → ai.extractCheckIn → check_ins row; orange/red risk → alerts row. */
calls.post("/ended", async (c) => {
  const body = await jsonBody(c, CallEndedBody);
  const found = must(
    "find call",
    await db
      .from("calls")
      .select("*")
      .eq("room_name", body.room_name)
      .order("started_at", { ascending: false })
      .limit(1),
  ) as CallRow[];
  const call = found[0];
  if (!call?.patient_id) throw notFound("call");
  const patientId = call.patient_id;

  must(
    "end call",
    await db
      .from("calls")
      .update({ ended_at: new Date().toISOString(), transcript: body.transcript, language: body.language })
      .eq("id", call.id),
  );

  const meds = await activeMeds(patientId);
  const extract = await ai.extractCheckIn(body.transcript, body.vision_events, meds);

  // Fold in symptoms the agent already logged via POST /symptoms during this call.
  const open = await openCheckIn(patientId);
  const seen = new Set(extract.symptoms.map((s) => s.name.toLowerCase()));
  const earlier: Symptom[] = (open?.symptoms ?? []).filter((s) => !seen.has(s.name.toLowerCase()));
  const row = {
    call_id: call.id,
    patient_id: patientId,
    mood: extract.mood,
    symptoms: [...extract.symptoms, ...earlier],
    visual_notes: extract.visual_notes,
    quotes: extract.quotes,
    risk_level: extract.risk_level,
    summary: extract.summary,
  };
  const saved = open
    ? mustOne("update check-in", await db.from("check_ins").update(row).eq("id", open.id).select("id").single())
    : mustOne("insert check-in", await db.from("check_ins").insert(row).select("id").single());

  if (extract.risk_level === "orange" || extract.risk_level === "red") {
    must(
      "insert alert",
      await db.from("alerts").insert({ patient_id: patientId, level: extract.risk_level, reason: extract.summary }),
    );
  }

  return c.json({ check_in_id: saved.id, check_in: extract } satisfies CallEndedResponse);
});
