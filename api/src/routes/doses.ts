import { Hono } from "hono";
import { CreateDoseBody, type IdResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId } from "../lib/stubs.js";

export const doses = new Hono();

/** Agent: log a dose outcome (optionally with an evidence frame). */
doses.post("/", async (c) => {
  await jsonBody(c, CreateDoseBody);
  return c.json({ id: newId() } satisfies IdResponse, 201);
});
