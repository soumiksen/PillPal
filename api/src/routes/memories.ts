import { Hono } from "hono";
import { MemoryBody, type IdResponse } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { newId } from "../lib/stubs.js";

export const memories = new Hono();

/** Agent: remember a personal fact for future calls. */
memories.post("/", async (c) => {
  await jsonBody(c, MemoryBody);
  return c.json({ id: newId() } satisfies IdResponse, 201);
});
