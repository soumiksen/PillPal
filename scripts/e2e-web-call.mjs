// npm run test:e2e:web — end-to-end check of the web call path with two headless Chrome "phones" (fake media).
// Needs the API + agent running (CHERT_MODE=mock npm run demo:up) and the web app (local :3000 or E2E_WEB=https://…).
// Creates its own throwaway patient (no phone, no consent, so the scheduler never touches it; its Realtime channels
// are not the ones your phones listen on) and deletes it and every row it created at the end.
// E2E_API (default http://localhost:8787) points at the API under test. No secret is printed. Screenshots → $TMPDIR.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env"));
const require = createRequire(join(root, "api/package.json"));
const { RoomServiceClient } = require("livekit-server-sdk");
const { createClient } = require("@supabase/supabase-js");
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright missing: npm install, then npx playwright install chromium");
  process.exit(1);
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const t0 = new Date().toISOString();

const WEB = process.env.E2E_WEB ?? "http://localhost:3000";
const API = process.env.E2E_API ?? "http://localhost:8787";
const OUT = mkdtempSync(join(tmpdir(), "pillpal-e2e-"));
const created = await db
  .from("patients")
  .insert({ name: "E2E Test Patient", preferred_name: "Testy", language: "en", caregiver_name: "Casey" })
  .select("id")
  .single();
if (created.error) {
  console.error(`could not create the test patient: ${created.error.message}`);
  process.exit(1);
}
const PID = created.data.id;
console.log(`test patient ${PID.slice(0, 8)}… created`);
const CODE = process.env.DEMO_ACCESS_CODE;
const rooms = new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/, "http"), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chicagoHHMM(d) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

async function openPhone(browser, role) {
  const ctx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${role} pageerror] ${e.message.slice(0, 200)}`));
  await page.goto(`${WEB}/${role}`);
  await page.getByLabel("Access code").fill(CODE);
  if (await page.getByText("Change patient").isVisible().catch(() => false)) await page.getByText("Change patient").click();
  await page.getByLabel("Patient id").fill(PID);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByText("Waiting for calls").waitFor({ timeout: 15000 });
  await page.getByText("Ready", { exact: true }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/${role}-idle.png` });
  return page;
}

/** Remote <video> elements with real frames (not the mirrored self view). */
const remoteVideos = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("video")]
      .filter((v) => v.style.transform !== "scaleX(-1)")
      .map((v) => ({ w: v.videoWidth, h: v.videoHeight, t: v.currentTime })),
  );
const audioEls = (page) => page.evaluate(() => document.querySelectorAll("audio").length);

let browser;
let roomName = "";
try {
  browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const patient = await openPhone(browser, "patient");
  const caregiver = await openPhone(browser, "caregiver");
  step("both apps set up, started and subscribed (Ready)", true);

  // Ring at the next minute (America/Chicago).
  const at = chicagoHHMM(new Date(Date.now() + 60_000));
  const r = await fetch(`${API}/demo/call-at`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-code": CODE },
    body: JSON.stringify({ patient_id: PID, at, kind: "check_in" }),
  });
  const j = await r.json();
  step("POST /demo/call-at accepted", r.status === 202, `at ${at} Chicago, in ${j.in_seconds}s`);

  await patient.getByText("Pal is calling…").waitFor({ timeout: 100_000 });
  await patient.screenshot({ path: `${OUT}/patient-incoming.png` });
  step("patient app rings (Pal is calling…)", true);
  roomName = (await (await fetch(`${API}/dev/call/line`)).json()).line?.room_name ?? "";
  step("API holds the line for the call", Boolean(roomName), roomName);

  await patient.getByRole("button", { name: "Accept" }).click();
  let palVideo = false;
  for (let i = 0; i < 40 && !palVideo; i++) {
    await sleep(1000);
    const vids = await remoteVideos(patient);
    palVideo = vids.some((v) => v.w > 0 && v.t > 0);
  }
  await sleep(4000); // greeting
  await patient.screenshot({ path: `${OUT}/patient-incall.png` });
  step("Pal's video arrives on the patient app", palVideo, JSON.stringify(await remoteVideos(patient)));
  const nAudio = await audioEls(patient);
  step("Pal's audio track is attached on the patient app", nAudio >= 1, `${nAudio} audio element(s)`);

  let ids = (await rooms.listParticipants(roomName)).map((p) => p.identity);
  step("room has Pal + patient-web", ids.some((i) => i.startsWith("patient-web-")) && ids.length >= 2, ids.map((i) => i.replace(/[0-9a-f-]{36}$/, "<uuid>")).join(", "));

  // Escalation: as if Pal called escalate_now after "I need Maya".
  const e = await fetch(`${API}/escalate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ patient_id: PID, room_name: roomName, reason: "E2E test: patient asked for her caregiver", summary: "Automated test of the web call path.", requested_by: "patient" }),
  });
  const ej = await e.json();
  step("POST /escalate", e.ok, `alert ${ej.alert_id ?? "?"}`);

  await caregiver.getByText(/is calling…/).waitFor({ timeout: 20_000 });
  await caregiver.screenshot({ path: `${OUT}/caregiver-incoming.png` });
  const ringRoom = (await (await fetch(`${API}/dev/call/line`)).json()).line?.room_name;
  step("caregiver app rings for the SAME room", ringRoom === roomName, ringRoom);
  await caregiver.getByRole("button", { name: "Accept" }).click();
  let tiles = 0;
  for (let i = 0; i < 30 && tiles < 2; i++) {
    await sleep(1000);
    tiles = (await remoteVideos(caregiver)).filter((v) => v.w > 0).length;
  }
  await sleep(5000);
  await caregiver.screenshot({ path: `${OUT}/caregiver-incall.png` });
  await patient.screenshot({ path: `${OUT}/patient-group.png` });
  step("caregiver sees Pal + patient (2 video tiles)", tiles >= 2, `${tiles} tile(s)`);
  ids = (await rooms.listParticipants(roomName)).map((p) => p.identity);
  step(
    "room has Pal + patient-web + caregiver-web",
    ids.some((i) => i.startsWith("patient-web-")) && ids.some((i) => i.startsWith("caregiver-web-")) && ids.length >= 3,
    ids.map((i) => i.replace(/[0-9a-f-]{36}$/, "<uuid>")).join(", "),
  );

  await sleep(8000); // let Pal greet the caregiver
  // Hang up both.
  await patient.getByRole("button", { name: "End" }).click();
  await sleep(1500);
  await caregiver.getByRole("button", { name: "End" }).click();
  await patient.getByText("Waiting for calls").waitFor({ timeout: 15000 });
  await caregiver.getByText("Waiting for calls").waitFor({ timeout: 15000 });
  step("both apps back to Waiting for calls", true);

  let closed = false;
  for (let i = 0; i < 30 && !closed; i++) {
    await sleep(1000);
    const line = (await (await fetch(`${API}/dev/call/line`)).json()).line;
    const live = (await rooms.listRooms([roomName])).length > 0;
    closed = !line && !live;
  }
  step("line freed and LiveKit room closed", closed);
} catch (err) {
  step("run", false, err.message.split("\n")[0]);
} finally {
  await browser?.close().catch(() => undefined);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`room: ${roomName} · screenshots: ${OUT}`);
  await cleanup();
  process.exitCode = failed ? 1 : 0;
}

/** Delete the throwaway patient and everything that references it. */
async function cleanup() {
  const deleted = [];
  const calls = (await db.from("calls").select("id").eq("patient_id", PID)).data ?? [];
  if (calls.length) await db.from("check_ins").delete().in("call_id", calls.map((c) => c.id));
  for (const table of ["check_ins", "alerts", "memories", "dose_events", "medications", "reports", "calls", "care_team"]) {
    const r = await db.from(table).delete().eq("patient_id", PID).select("*");
    if (r.data?.length) deleted.push(`${table} ${r.data.length}`);
  }
  const p = await db.from("patients").delete().eq("id", PID).select("id");
  deleted.push(`patients ${p.data?.length ?? 0}${p.error ? ` (error: ${p.error.message})` : ""}`);
  console.log(`cleanup: deleted ${deleted.join(", ")} (since ${t0})`);
}
