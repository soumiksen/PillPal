import { Hono } from "hono";
import { SymptomBody, type OkResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";

export const symptoms = new Hono();

/** Agent: record a symptom the patient mentioned. */
symptoms.post("/", async (c) => {
  await jsonBody(c, SymptomBody);
  return c.json({ ok: true } satisfies OkResponse);
});
