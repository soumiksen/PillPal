import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { stubFetch } from "./setup.js";

const { SharedChertMessaging, SHARED_MAX_PER_HOUR, UnsupportedOnShared } = await import("../../src/chert/shared.js");
const { listItems, normalize, toEnvelope } = await import("../../src/chert/shared-poll.js");
const { HourlyRateGuard, RateLimitedError } = await import("../../src/lib/rate-guard.js");

test("sendText posts the documented shared-messages body with auth + idempotency headers", async () => {
  const seen = stubFetch(() => ({ status: 201, json: { data: { id: "sm_1" }, request_id: "r" } }));
  const m = new SharedChertMessaging();
  const id = await m.sendText("+15550000001", "Time for your pill 💊");
  assert.equal(id, "sm_1");
  assert.equal(seen.length, 1);
  const req = seen[0]!;
  assert.equal(req.url, "https://app.trychert.com/api/v1/shared-messages");
  assert.equal(req.method, "POST");
  assert.equal(req.headers.authorization, "Bearer ftk_test");
  assert.equal(req.headers["x-chert-project-id"], process.env.CHERT_PROJECT_ID);
  const key = req.headers["idempotency-key"]!;
  assert.ok(key.length >= 8 && key.length <= 200);
  assert.deepEqual(req.body, {
    line_id: process.env.CHERT_LINE_ID,
    recipient: "+15550000001",
    text: "Time for your pill 💊",
  });
});

test("each send gets a fresh Idempotency-Key; top-level id is accepted too", async () => {
  const seen = stubFetch(() => ({ json: { id: "sm_top" } }));
  const m = new SharedChertMessaging();
  assert.equal(await m.sendText("+1", "a"), "sm_top");
  await m.sendText("+1", "b");
  assert.notEqual(seen[0]!.headers["idempotency-key"], seen[1]!.headers["idempotency-key"]);
});

test("unsupported features degrade to text or a log, never a crash", async () => {
  const seen = stubFetch(() => ({ json: { data: { id: "x" } } }));
  const m = new SharedChertMessaging();
  await m.react("msg", "love");
  assert.equal(seen.length, 0, "react makes no request");

  await m.sendText("+1", "3 in a row!", "celebration");
  assert.match((seen[0]!.body as { text: string }).text, /^🎉 /);

  await m.sendVoiceNote("+1", Buffer.alloc(10), "Your dose changed");
  assert.equal((seen[1]!.body as { text: string }).text, "🔊 Your dose changed");

  await m.sendPharmacyPin("+1", { latitude: 32.7, longitude: -97.1, label: "Corner Pharmacy", address: "1 Main St" });
  assert.match((seen[2]!.body as { text: string }).text, /Corner Pharmacy\n1 Main St/);

  await assert.rejects(m.createCareChat(["+1", "+2"], "hi"), UnsupportedOnShared);
  await assert.rejects(m.postToChat("c", "hi"), UnsupportedOnShared);
});

test("rate guard stops at 90 messages per rolling hour with a 429", async () => {
  stubFetch(() => ({ json: { data: { id: "x" } } }));
  const m = new SharedChertMessaging();
  for (let i = 0; i < SHARED_MAX_PER_HOUR; i++) await m.sendText("+1", `m${i}`);
  await assert.rejects(m.sendText("+1", "one too many"), (e: unknown) => e instanceof RateLimitedError && e.status === 429);

  let now = 0;
  const g = new HourlyRateGuard("t", 2, 1000, () => now);
  g.take();
  g.take();
  assert.throws(() => g.take(), RateLimitedError);
  now = 1001;
  g.take();
});

test("poller normalizes list items into message.received envelopes and skips our own sends", () => {
  const json = {
    data: [
      { id: "in1", direction: "inbound", sender: "+15550000001", text: "taken", created_at: "2026-11-14T12:00:00Z" },
      { id: "out1", direction: "outbound", recipient: "+15550000001", text: "Time for…" },
      { id: "mine", text: "no direction" },
    ],
  };
  const items = listItems(json);
  assert.equal(items.length, 3);
  const a = normalize(items[0]!, new Set());
  assert.equal(a?.inbound, true);
  assert.equal(a?.sender, "+15550000001");
  assert.equal(normalize(items[1]!, new Set())?.inbound, false);
  assert.equal(normalize(items[2]!, new Set(["mine"]))?.inbound, false);
  const env = toEnvelope(a!);
  assert.equal(env.event_id, "shared:in1");
  assert.equal(env.event_type, "message.received");
  assert.deepEqual(env.data.message.parts, [{ type: "text", value: "taken" }]);
});
