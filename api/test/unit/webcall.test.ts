import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";

const { WebCallService } = await import("../../src/calls/web.js");
const { MemorySignalBus } = await import("../../src/calls/signal.js");
const { LineBusyError } = await import("../../src/chert/facetime.js");

const P = "00000000-0000-4000-8000-000000000001";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakes() {
  const log: string[] = [];
  const people = new Map<string, Set<string>>();
  const ended: string[] = [];
  let n = 0;
  const lk = {
    async createRoom(room: string) {
      log.push(`create ${room}`);
      people.set(room, new Set(["pillpal-agent"]));
    },
    async dispatchAgent(room: string, metadata: Record<string, unknown>) {
      log.push(`dispatch ${room} ${JSON.stringify(metadata)}`);
    },
    async participants(room: string) {
      return [...(people.get(room) ?? [])];
    },
    async deleteRoom(room: string) {
      log.push(`delete ${room}`);
      people.delete(room);
    },
  };
  const store = {
    async insertCall() {
      return `call-${++n}`;
    },
    async markEnded(id: string) {
      ended.push(id);
    },
    async callerName() {
      return "Rose";
    },
  };
  const bus = new MemorySignalBus();
  const svc = new WebCallService(lk, bus, store, { ringTimeoutMs: 80, watchEveryMs: 20 });
  return { svc, bus, log, people, ended };
}

test("dial: room → dispatch {transport:web} → ring patient from Pal; second dial is busy", async () => {
  const f = fakes();
  const placed = await f.svc.dial(P, "dose");
  assert.match(placed.room_name, /^pillpal-dose-[0-9a-f]{8}$/);
  assert.equal(placed.chert_call_id, null);
  assert.ok(f.log[1]!.includes('"transport":"web"') && f.log[1]!.includes('"kind":"dose"'));
  assert.deepEqual(f.bus.sent[0], {
    role: "patient",
    event: "ring",
    payload: { call_id: placed.call_id, room_name: placed.room_name, kind: "dose", from: "Pal" },
  });
  await assert.rejects(f.svc.dial(P, "check_in"), LineBusyError);
});

test("no answer within the ring timeout → cancel, no_answer, room deleted, line free", async () => {
  const f = fakes();
  const placed = await f.svc.dial(P, "check_in");
  await wait(150);
  assert.equal(f.bus.sent.at(-1)!.event, "cancel");
  assert.equal(f.svc.outcome(placed.call_id), "no_answer");
  assert.deepEqual(f.ended, [placed.call_id]);
  assert.ok(f.log.includes(`delete ${placed.room_name}`));
  assert.equal(f.svc.activeLine(), null);
});

test("accept → escalate rings the caregiver into the same room → both hang up → room closes", async () => {
  const f = fakes();
  const placed = await f.svc.dial(P, "check_in");
  f.bus.reply(P, "accepted", { call_id: placed.call_id, role: "patient" });
  f.people.get(placed.room_name)!.add("patient-web-1");
  await wait(150); // past the ring timeout: answered calls are not cancelled
  assert.equal(f.svc.outcome(placed.call_id), "answered");
  assert.ok(f.svc.activeLine());

  const r = await f.svc.ringCaregiver(P);
  assert.deepEqual(r, { room_name: placed.room_name, new_call: false });
  assert.deepEqual(f.bus.sent.at(-1), {
    role: "caregiver",
    event: "ring",
    payload: { call_id: placed.call_id, room_name: placed.room_name, kind: "check_in", from: "Rose" },
  });
  f.bus.reply(P, "accepted", { call_id: placed.call_id, role: "caregiver" });
  f.people.get(placed.room_name)!.add("caregiver-web-1");

  f.bus.reply(P, "ended", { call_id: placed.call_id, role: "patient" });
  f.people.get(placed.room_name)!.delete("patient-web-1");
  await wait(10);
  assert.ok(f.svc.activeLine(), "caregiver still in the call");
  f.bus.reply(P, "ended", { call_id: placed.call_id, role: "caregiver" });
  await wait(10);
  assert.equal(f.svc.activeLine(), null);
  assert.ok(f.log.includes(`delete ${placed.room_name}`));
});

test("escalation with no call on the line starts a new room and rings both phones", async () => {
  const f = fakes();
  const r = await f.svc.ringCaregiver(P);
  assert.equal(r.new_call, true);
  assert.match(r.room_name, /^pillpal-escalation-/);
  assert.deepEqual(f.bus.sent.map((s) => `${s.event}:${s.role}`), ["ring:patient", "ring:caregiver"]);
});

test("patient declines → call ends as declined", async () => {
  const f = fakes();
  const placed = await f.svc.dial(P, "dose");
  f.bus.reply(P, "declined", { call_id: placed.call_id, role: "patient" });
  await wait(10);
  assert.equal(f.svc.outcome(placed.call_id), "declined");
  assert.equal(f.svc.activeLine(), null);
});
