/**
 * Full mock pass against the real Supabase project: CHERT_MODE=mock, CHERT_FACETIME_MODE=mock,
 * SCHEDULER=off, AI keys blanked (offline @pillpal/ai stubs). No Chert, LiveKit or model request.
 * Rows created by the run are deleted at the end and Rose's pills_left / care_chat_id are restored.
 * Prints statuses and counts only.
 *
 *   npm run test:e2e   (from api/; needs the API port 8797 free)
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

let server: ChildProcess;
let serverLog = "";
const t0 = new Date(Date.now() - 1000).toISOString();
let patientId = "";
let meds: { id: string; drug: string; pills_left: number | null }[] = [];
let careChatBefore: string | null = null;
const table: string[] = [];
const row = (step: string, result: string) => {
  table.push(`${step.padEnd(34)} ${result}`);
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; ms: number }> {
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms: Math.round(performance.now() - start) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(150);
  }
}

const outbox = async () => (await api("GET", "/dev/chert/outbox")).json.messages as { kind: string; to: string }[];
const line = async () => (await api("GET", "/dev/facetime/line")).json.line as { room_name: string; kind: string; group: boolean } | null;
const alertRow = async (id: string) =>
  (await db.from("alerts").select("level, sent_to").eq("id", id).single()).data as { level: string; sent_to: string };

before(async () => {
  const p = await db.from("patients").select("id, care_chat_id").eq("preferred_name", "Rose").order("created_at").limit(1);
  assert.ok(p.data?.[0], "Rose must exist (npm run seed:patient)");
  patientId = p.data[0].id;
  careChatBefore = p.data[0].care_chat_id;
  meds = ((await db.from("medications").select("id, drug, pills_left").eq("patient_id", patientId)).data ?? []) as typeof meds;

  server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      CHERT_MODE: "mock",
      CHERT_FACETIME_MODE: "mock",
      SCHEDULER: "off",
      ANTHROPIC_API_KEY: "",
      GOOGLE_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (d) => (serverLog += d));
  server.stderr!.on("data", (d) => (serverLog += d));
  await waitFor(async () => ((await fetch(`${BASE}/health`).catch(() => undefined))?.ok ? true : undefined), 20_000);
});

after(async () => {
  server?.kill();
  // Clean up everything this run created for Rose.
  await db.from("check_ins").delete().eq("patient_id", patientId).gte("created_at", t0);
  await db.from("alerts").delete().eq("patient_id", patientId).gte("created_at", t0);
  await db.from("reports").delete().eq("patient_id", patientId).gte("created_at", t0);
  await db.from("dose_events").delete().eq("patient_id", patientId).gte("created_at", t0);
  await db.from("calls").delete().eq("patient_id", patientId).gte("started_at", t0);
  await db.from("chert_events").delete().like("event_id", "mock:%").gte("received_at", t0);
  for (const m of meds) await db.from("medications").update({ pills_left: m.pills_left }).eq("id", m.id);
  await db.from("patients").update({ care_chat_id: careChatBefore }).eq("id", patientId);
  console.log(`\n--- mock e2e results ---\n${table.join("\n")}\n(cleanup: test rows deleted, pills_left + care_chat_id restored)`);
  if (/\+\d{10,}/.test(serverLog)) console.log("WARNING: server log contained a phone-like string");
});

test("mock flow", async (t) => {
  const levo = meds.find((m) => m.drug === "Levothyroxine")!;
  const metformin = meds.find((m) => m.drug === "Metformin")!;

  await t.test("dial, then second dial → 409", async () => {
    const a = await api("POST", "/dial", { patient_id: patientId, kind: "check_in" });
    assert.equal(a.status, 200);
    assert.match(a.json.chert_call_id, /^mock_call_/);
    const saved = await db.from("calls").select("id, kind").eq("room_name", a.json.room_name);
    assert.equal(saved.data?.length, 1);
    const b = await api("POST", "/dial", { patient_id: patientId, kind: "check_in" });
    assert.equal(b.status, 409);
    assert.equal(b.json.error, "line_busy");
    row("dial / second dial", `${a.status} (calls row 1) / ${b.status} ${b.json.error}`);
  });

  await t.test("escalate: alert, caregiver text, 1:1 ended, group call", async () => {
    const before = (await outbox()).length;
    const l1 = await line();
    const r = await api("POST", "/escalate", { patient_id: patientId, room_name: l1!.room_name, reason: "Chest pain", summary: "Rose said her chest hurts" });
    assert.equal(r.status, 200);
    assert.ok(r.ms < 5000);
    const g = await waitFor(async () => {
      const l = await line();
      return l?.group ? l : undefined;
    });
    assert.equal(g.kind, "escalation");
    const ended = await db.from("calls").select("ended_at").eq("room_name", l1!.room_name).single();
    assert.ok(ended.data?.ended_at);
    const a = await alertRow(r.json.alert_id);
    assert.equal(a.level, "red");
    assert.equal(a.sent_to, "caregiver,group_facetime");
    const texts = (await outbox()).slice(before).filter((m) => m.kind === "text" && m.to === "caregiver").length;
    row("escalate (group ok)", `${r.status} in ${r.ms}ms, alert red, caregiver texts ${texts}, 1:1 ended, group placed`);

    // calls/ended for the group call frees the line and writes a check-in
    const e = await api("POST", "/calls/ended", { room_name: g.room_name, transcript: "Pal: Maya is here. Rose: Thank you.", language: "en", vision_events: [] });
    assert.equal(e.status, 200);
    assert.ok(e.json.check_in_id);
    assert.equal(await line(), null);
    row("calls/ended → check_in", `${e.status}, check_in saved (risk ${e.json.check_in.risk_level}), line freed`);
  });

  await t.test("escalate fallback when group FaceTime is unavailable", async () => {
    const before = (await outbox()).length;
    assert.equal((await api("POST", "/dev/facetime/fail-next-group", { code: "facetime_group_unavailable" })).status, 200);
    const r = await api("POST", "/escalate", { patient_id: patientId, room_name: "none", reason: "Fell in the kitchen", summary: "Rose fell" });
    assert.equal(r.status, 200);
    const a = await waitFor(async () => {
      const x = await alertRow(r.json.alert_id);
      return x.sent_to?.includes("fallback") ? x : undefined;
    });
    assert.equal(a.sent_to, "caregiver,fallback_text:facetime_group_unavailable");
    const texts = (await outbox()).slice(before).filter((m) => m.kind === "text" && m.to === "caregiver").length;
    assert.equal(texts, 2);
    row("escalate (group refused)", `${r.status}, alert red, caregiver texts ${texts} (alert + "Please FaceTime"), fallback recorded`);
  });

  await t.test("demo/remind → tapback → taken (pills_left −1)", async () => {
    const r = await api("POST", "/demo/remind", { patient_id: patientId, medication_id: levo.id });
    assert.equal(r.status, 200);
    const pillsBefore = (await db.from("medications").select("pills_left").eq("id", levo.id).single()).data!.pills_left;
    const tb = await api("POST", "/dev/chert/tapback", { message_id: r.json.chert_message_id });
    assert.equal(tb.status, 200);
    assert.equal(tb.json.status, "processed");
    const ev = (await db.from("dose_events").select("status, confirmed_via").eq("id", r.json.dose_event_id).single()).data!;
    assert.equal(ev.status, "taken");
    assert.equal(ev.confirmed_via, "imessage_tapback");
    const pillsAfter = (await db.from("medications").select("pills_left").eq("id", levo.id).single()).data!.pills_left;
    if (pillsBefore != null) assert.equal(pillsAfter, Math.max(0, pillsBefore - 1));
    const dup = await api("POST", "/dev/chert/tapback", { message_id: r.json.chert_message_id });
    row("demo/remind → tapback → taken", `${r.status} → ${tb.status} ${tb.json.status} → taken, pills_left ${pillsBefore}→${pillsAfter}; 2nd tapback ${dup.json.status}`);
  });

  await t.test("red-flag text → escalation", async () => {
    const r = await api("POST", "/dev/chert/text", { patient_id: patientId, text: "I have chest pain and I think I took two pills" });
    assert.equal(r.status, 200);
    assert.ok(r.json.actions.some((a: string) => a.startsWith("escalated")));
    const g = await waitFor(async () => {
      const l = await line();
      return l?.group ? l : undefined;
    });
    row("red-flag text → escalation", `${r.status} ${r.json.status}, escalated, group call placed`);
    await api("POST", "/calls/ended", { room_name: g.room_name, transcript: "Pal: Maya is on the call.", language: "en", vision_events: [] });
  });

  await t.test("reports/generate", async () => {
    const r = await api("POST", "/reports/generate", { patient_id: patientId });
    assert.equal(r.status, 200);
    assert.equal(r.json.patient_id, patientId);
    const n = await db.from("reports").select("id", { count: "exact", head: true }).eq("patient_id", patientId).gte("created_at", t0);
    assert.equal(n.count, 1);
    row("reports/generate", `${r.status}, adherence ${r.json.adherence_pct}%, taken ${r.json.doses_taken}, missed ${r.json.doses_missed}, wrong ${r.json.wrong_pills_caught}, reports row 1`);
  });

  await t.test("notify/dose-change", async () => {
    const r = await api("POST", "/notify/dose-change", {
      patient_id: patientId, medication_id: metformin.id, old_dose: "500 mg twice daily", new_dose: "1000 mg twice daily", doctor_note: "Take with meals.",
    });
    assert.equal(r.status, 200);
    const kinds = (r.json.messages as { kind: string }[]).map((m) => m.kind);
    assert.deepEqual(kinds, ["text", "voice_note", "care_chat_post", "caregiver_summary"]);
    assert.deepEqual(r.json.sent, { text: true, voice_note: true, group_chat: true });
    row("notify/dose-change", `${r.status}, sent ${kinds.join(", ")}`);
  });

  await t.test("one scheduler tick", async () => {
    const r = await api("POST", "/dev/scheduler/tick");
    assert.equal(r.status, 200);
    assert.ok(r.json.patients >= 1);
    const s = r.json;
    row("scheduler tick", `${r.status}, patients ${s.patients}, reminders ${s.reminders}, dials ${s.dials}, missed ${s.missed}, alerts ${s.alerts}, celebrations ${s.celebrations}, low-pill ${s.low_pill_notices}`);
  });
});
