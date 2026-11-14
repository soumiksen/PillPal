import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { OkResponse } from "@pillpal/shared";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true } satisfies OkResponse));

const port = 8787;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PillPal API listening on http://localhost:${info.port}`);
});

export default app;
