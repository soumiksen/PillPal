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
import { facetime } from "../chert/facetime.js";
import { db } from "../db.js";
import { activeMeds, getPatient, must, mustOne, notFound, openCheckIn } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { displayName, textCaregiver } from "../lib/notices.js";
import { escalate } from "../services/escalate.js";

export const calls = new Hono();

/**
 * Agent: a call room went live. Calls placed by POST /dial already have a row for this room (with the
 * Chert call id and our kind), so that row is reused; inbound calls get a new row.
 */
calls.post("/started", async (c) => {
  const body = await jsonBody(c, CallStartedBody);
  const patient = await getPatient(body.patient_id);
  const existing = must(
    "find call by room",
    await db.from("calls").select("id").eq("room_name", body.room_name).is("ended_at", null).limit(1),
  ) as { id: string }[];
  if (existing[0]) {
    if (body.chert_call_id) {
      must("update call", await db.from("calls").update({ chert_call_id: body.chert_call_id }).eq("id", existing[0].id));
    }
    return c.json({ id: existing[0].id } satisfies IdResponse);
  }
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

/**
 * Agent: call finished → transcript/language/ended_at saved → ai.extractCheckIn → check_ins row.
 * Risk orange → alert + caregiver text. Risk red → escalate (red alert, caregiver text, group FaceTime).
 * The FaceTime line is freed for this room.
 */
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
      .update({ ended_at: call.ended_at ?? new Date().toISOString(), transcript: body.transcript, language: body.language })
      .eq("id", call.id),
  );
  facetime.releaseRoom(body.room_name);

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

  if (extract.risk_level === "orange") {
    const patient = await getPatient(patientId);
    must(
      "insert alert",
      await db.from("alerts").insert({ patient_id: patientId, level: "orange", reason: extract.summary, sent_to: "caregiver" }),
    );
    await textCaregiver(
      patient,
      `🟠 PillPal check-in for ${displayName(patient)}: ${extract.summary}\n\nDetails are on the dashboard.`,
      "orange check-in",
    );
  } else if (extract.risk_level === "red") {
    // The agent usually escalated during the call already; do not ring everyone twice.
    const already = must(
      "find red alert",
      await db
        .from("alerts")
        .select("id")
        .eq("patient_id", patientId)
        .eq("level", "red")
        .gte("created_at", call.started_at)
        .limit(1),
    ) as { id: string }[];
    if (already.length === 0) {
      const r = await escalate({ patient_id: patientId, reason: `Red-flag check-in — ${extract.summary}` });
      void r.callTask;
    }
  }

  return c.json({ check_in_id: saved.id, check_in: extract } satisfies CallEndedResponse);
});
