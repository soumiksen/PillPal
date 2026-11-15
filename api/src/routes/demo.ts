import { Hono } from "hono";
import { DemoRemindBody, type DemoRemindResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId } from "../lib/stubs.js";

export const demo = new Hono();

/** Web: send a tapback reminder for a medication right now. */
demo.post("/remind", async (c) => {
  await jsonBody(c, DemoRemindBody);
  return c.json({ dose_event_id: newId(), chert_message_id: `msg_${newId()}` } satisfies DemoRemindResponse);
});
