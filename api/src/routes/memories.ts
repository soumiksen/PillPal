import { Hono } from "hono";
import { MemoryBody, type IdResponse } from "@pillpal/shared";
import { db } from "../db.js";
import { getPatient, must, mustOne } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";

export const memories = new Hono();

/** Agent: remember a personal fact for future calls. */
memories.post("/", async (c) => {
  const body = await jsonBody(c, MemoryBody);
  await getPatient(body.patient_id); // 404 instead of an FK error
  const row = mustOne("insert memory", await db.from("memories").insert(body).select("id").single());
  return c.json({ id: row.id } satisfies IdResponse, 201);
});
