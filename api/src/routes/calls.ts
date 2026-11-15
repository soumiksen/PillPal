import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import {
  CallEndedBody,
  CallStartedBody,
  type CallEndedResponse,
  type IdResponse,
} from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId, stubMeds } from "../lib/stubs.js";

export const calls = new Hono();

/** Agent: a call room went live. */
calls.post("/started", async (c) => {
  await jsonBody(c, CallStartedBody);
  return c.json({ id: newId() } satisfies IdResponse, 201);
});

/** Agent: call finished → ai.extractCheckIn → check_ins row. */
calls.post("/ended", async (c) => {
  const body = await jsonBody(c, CallEndedBody);
  const meds = stubMeds(newId()); // stub: real version looks up the call's patient by room_name
  const checkIn = await ai.extractCheckIn(body.transcript, body.vision_events, meds);
  return c.json({ check_in_id: newId(), check_in: checkIn } satisfies CallEndedResponse);
});
