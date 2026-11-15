import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { OkResponse } from "@pillpal/shared";
import { env } from "./env.js";
import { notFound, onError, requestLogger } from "./lib/http.js";
import { startEventStream } from "./chert/events.js";
import { calls } from "./routes/calls.js";
import { devChert, webhooks } from "./routes/chert.js";
import { demo } from "./routes/demo.js";
import { dial } from "./routes/dial.js";
import { doses } from "./routes/doses.js";
import { escalate } from "./routes/escalate.js";
import { medications } from "./routes/medications.js";
import { memories } from "./routes/memories.js";
import { notify } from "./routes/notify.js";
import { patients } from "./routes/patients.js";
import { reports } from "./routes/reports.js";
import { rx } from "./routes/rx.js";
import { symptoms } from "./routes/symptoms.js";

const app = new Hono();

app.use("*", requestLogger);
app.use("*", cors({ origin: env.WEB_ORIGIN }));
app.onError(onError);
app.notFound(notFound);

app.get("/health", (c) => c.json({ ok: true } satisfies OkResponse));

app.route("/patients", patients);
app.route("/rx", rx);
app.route("/medications", medications);
app.route("/doses", doses);
app.route("/symptoms", symptoms);
app.route("/memories", memories);
app.route("/calls", calls);
app.route("/escalate", escalate);
app.route("/dial", dial);
app.route("/demo", demo);
app.route("/reports", reports);
app.route("/notify", notify);

if (env.CHERT_MODE === "live") {
  app.route("/webhooks", webhooks);
} else {
  app.route("/dev/chert", devChert);
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`PillPal API listening on http://localhost:${info.port} (chert: ${env.CHERT_MODE})`);
  if (env.CHERT_MODE === "live") startEventStream();
});

export default app;
