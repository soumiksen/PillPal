import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { stubFetch } from "./setup.js";

const ft = await import("../../src/chert/facetime.js");

function fakeLiveKit() {
  const log: { op: string; room: string; metadata?: Record<string, unknown> }[] = [];
  let token = "";
  const ops = {
    async createRoom(room: string) {
      log.push({ op: "createRoom", room });
    },
    async dispatchAgent(room: string, metadata: Record<string, unknown>) {
      log.push({ op: "dispatch", room, metadata });
    },
    async bridgeToken(room: string, identity: string) {
      token = await ft.mintBridgeToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, room, identity);
      return token;
    },
    async deleteRoom(room: string) {
      log.push({ op: "deleteRoom", room });
    },
  };
  return { ops, log, token: () => token };
}

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, any>;

test("live 1:1 dial: room → dispatch → bridge token → POST /v1/calls with the documented body", async () => {
  const lk = fakeLiveKit();
  const seen = stubFetch(() => ({ status: 201, json: { data: { id: "call_123", status: "allocated" }, request_id: "r" } }));
  const live = new ft.LiveChertFaceTime(lk.ops);
  const placed = await live.placeCall({ destination: "+15550000001" }, { patient_id: "p-1", kind: "check_in" });

  assert.equal(placed.chert_call_id, "call_123");
  assert.match(placed.room_name, /^pillpal-check_in-[0-9a-f]{8}$/);
  assert.deepEqual(lk.log.map((l) => l.op), ["createRoom", "dispatch"]);
  assert.deepEqual(lk.log[1]!.metadata, { patient_id: "p-1", kind: "check_in" });

  const req = seen[0]!;
  assert.equal(req.url, "https://facetime.trychert.com/api/v1/calls");
  assert.equal(req.headers.authorization, "Bearer ftk_test");
  assert.equal(req.headers["x-chert-project-id"], process.env.CHERT_PROJECT_ID);
  const key = req.headers["idempotency-key"]!;
  assert.ok(key.length >= 8 && key.length <= 200);
  const body = req.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "destination", "destination_type", "direction", "line_id", "livekit_url", "media", "mode",
    "participant_token", "remote_participant_identity",
  ]);
  assert.equal(body.direction, "outbound");
  assert.equal(body.mode, "customer_managed");
  assert.equal(body.line_id, process.env.CHERT_LINE_ID);
  assert.equal(body.destination_type, "phone");
  assert.deepEqual(body.media, { audio: true, video: true });
  assert.equal(body.livekit_url, process.env.LIVEKIT_URL);
  assert.equal(body.remote_participant_identity, "pillpal-agent");

  const claims = decode(body.participant_token as string);
  assert.match(claims.sub, /^bridge-[0-9a-f-]{36}$/);
  assert.equal(claims.video.room, placed.room_name);
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, true);
  assert.ok(Number.isInteger(claims.nbf) && Number.isInteger(claims.exp));
  assert.ok(claims.exp - claims.nbf <= 7200 && claims.exp - claims.nbf > 90);
});

test("group dial sends recipients[] (phone_number) instead of destination", async () => {
  const lk = fakeLiveKit();
  const seen = stubFetch(() => ({ status: 201, json: { data: { id: "call_g" } } }));
  const live = new ft.LiveChertFaceTime(lk.ops);
  const placed = await live.placeCall({ recipients: ["+15550000001", "+15550000002"] }, { patient_id: "p", kind: "escalation" });
  assert.match(placed.room_name, /^pillpal-escalation-/);
  const body = seen[0]!.body as Record<string, unknown>;
  assert.equal(body.destination, undefined);
  assert.equal(body.destination_type, undefined);
  assert.deepEqual(body.recipients, [
    { type: "phone_number", value: "+15550000001" },
    { type: "phone_number", value: "+15550000002" },
  ]);
});

test("Chert refusal → FaceTimeError(code) and the LiveKit room is cleaned up", async () => {
  const lk = fakeLiveKit();
  stubFetch(() => ({ status: 409, json: { error: { code: "facetime_group_unavailable", message: "x" }, request_id: "r" } }));
  const live = new ft.LiveChertFaceTime(lk.ops);
  await assert.rejects(
    live.placeCall({ recipients: ["+1", "+2"] }, { patient_id: "p", kind: "escalation" }),
    (e: unknown) => e instanceof ft.FaceTimeError && e.code === "facetime_group_unavailable",
  );
  assert.equal(lk.log.at(-1)!.op, "deleteRoom");
});

test("endCall posts {} with its own Idempotency-Key; getCall maps terminal states", async () => {
  const seen = stubFetch((r) =>
    r.url.endsWith("/end") ? { status: 202, json: { data: {} } } : { json: { data: { id: "c", status: "ended" } } },
  );
  const live = new ft.LiveChertFaceTime(fakeLiveKit().ops);
  await live.endCall("c");
  assert.equal(seen[0]!.url, "https://facetime.trychert.com/api/v1/calls/c/end");
  assert.deepEqual(seen[0]!.body, {});
  assert.ok(seen[0]!.headers["idempotency-key"]);
  assert.deepEqual(await live.getCall("c"), { status: "ended", terminal: true });

  assert.equal(ft.callStateFrom({ data: { status: "active" } }).terminal, false);
  assert.equal(ft.callStateFrom({ data: { status: "ringing" } }).terminal, false);
  assert.equal(ft.callStateFrom({ data: { status: "failed" } }).terminal, true);
  assert.equal(ft.callStateFrom({ data: { state: "x", ended_at: "2026-11-14T00:00:00Z" } }).terminal, true);
});

test("mock transport makes no request and can refuse the next group call", async () => {
  const seen = stubFetch(() => ({ json: {} }));
  const mock = new ft.MockChertFaceTime();
  const a = await mock.placeCall({ destination: "+1" }, { patient_id: "p", kind: "dose" });
  assert.match(a.chert_call_id, /^mock_call_/);
  mock.failNextGroup("recipient_not_verified");
  await assert.rejects(mock.placeCall({ recipients: ["+1", "+2"] }, { patient_id: "p", kind: "escalation" }), ft.FaceTimeError);
  await mock.endCall(a.chert_call_id);
  assert.equal((await mock.getCall(a.chert_call_id)).terminal, true);
  assert.equal(seen.length, 0);
});
