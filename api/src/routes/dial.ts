import { Hono } from "hono";
import { DialBody, type DialResponse } from "@pillpal/shared";
import { facetime } from "../chert/facetime.js";
import { jsonBody } from "../lib/http.js";

export const dial = new Hono();

/**
 * Web demo button / scheduler: place a FaceTime video call to the patient (src/chert/facetime.ts).
 * 201 from Chert = allocated, not answered. A second dial while the line is busy → 409 {error:"line_busy"}.
 */
dial.post("/", async (c) => {
  const body = await jsonBody(c, DialBody);
  const placed = await facetime.dial(body.patient_id, body.kind);
  return c.json({ chert_call_id: placed.chert_call_id, room_name: placed.room_name } satisfies DialResponse);
});
