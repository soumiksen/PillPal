// npm run test:e2e:video — end-to-end check of the Devpost video mode with two headless Chrome "phones" (fake media).
// Needs `npm run video:up` running (for a dry run that sends no iMessage, on a second port:
//   PORT=8788 API_URL=http://localhost:8788 AGENT_NAME=pillpal-video-e2e CHERT_MODE=mock npm run video:up > video.log
// ) and E2E_API=http://localhost:8788 E2E_AGENT_LOG=video.log. E2E_WEB defaults to the pillpal-devpost deployment.
// Uses the real video patient (VIDEO_PATIENT_ID) and resets it at the end. No secret is printed.
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env"));
const require = createRequire(join(root, "api/package.json"));
const { RoomServiceClient } = require("livekit-server-sdk");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = await import("playwright");

const WEB = process.env.E2E_WEB ?? "https://pillpal-devpost.vercel.app";
const API = process.env.E2E_API ?? "http://localhost:8787";
const LOG = process.env.E2E_AGENT_LOG;
const PID = process.env.VIDEO_PATIENT_ID;
const CODE = process.env.DEMO_ACCESS_CODE;
const TOLERANCE_MS = 300;
if (!PID || !CODE) {
  console.error("needs VIDEO_PATIENT_ID and DEMO_ACCESS_CODE");
  process.exit(1);
}
const OUT = mkdtempSync(join(tmpdir(), "pillpal-video-e2e-"));
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const rooms = new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/, "http"), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const video = async (method, path) => {
  const r = await fetch(API + path, { method, headers: { "x-demo-code": CODE } });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const magnesium = async () => (await video("GET", "/video/status")).j.doses?.find((d) => d.drug === "Magnesium")?.status;
const logOffset = () => (LOG ? statSync(LOG).size : 0);
/** [script] lines the agent wrote since `from`. */
const scriptLines = (from) => (LOG ? readFileSync(LOG).subarray(from).toString().split("\n").filter((l) => l.includes("[script]")) : []);
const deltas = (lines) => lines.map((l) => /#(\d+) (.*?) · planned .*\(Δ (-?\d+) ms\)/.exec(l)).filter(Boolean).map((m) => ({ step: Number(m[1]), what: m[2], delta: Number(m[3]) }));

async function openPhone(browser, role) {
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${role} pageerror] ${e.message.slice(0, 200)}`));
  await page.goto(`${WEB}/${role}`);
  await page.getByLabel("Access code").fill(CODE);
  const preset = await page.getByText("Change patient").isVisible().catch(() => false);
  if (preset) await page.getByText("Change patient").click();
  const shown = await page.getByLabel("Patient id").inputValue();
  if (role === "patient") step("deployment pre-fills the video patient id (NEXT_PUBLIC_PATIENT_ID)", preset && shown === PID);
  await page.getByLabel("Patient id").fill(PID);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByText("Ready", { exact: true }).waitFor({ timeout: 20000 });
  return page;
}

/**
 * In the page: watch the loudness of Pal's audio (the first remote audio track after Accept; the caregiver's fake
 * mic beeps are ignored) and record the onset of each burst of speech, in ms after this call.
 */
const armAudioProbe = (page) =>
  page.evaluate(() => {
    const w = window;
    w.__onsets = [];
    w.__armAt = performance.now();
    w.__pal = null;
    w.__known = new Set(document.querySelectorAll("audio"));
    if (w.__probe) return;
    w.__probe = true;
    const ctx = new AudioContext();
    let analyser = null;
    let loud = false;
    let quietSince = 0;
    const buf = new Float32Array(1024);
    setInterval(() => {
      if (!w.__pal) {
        const el = [...document.querySelectorAll("audio")].find((e) => !w.__known.has(e) && e.srcObject);
        if (!el) return;
        w.__pal = el;
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(el.srcObject).connect(analyser);
        loud = false;
      }
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > 0.01) {
        quietSince = 0;
        if (!loud) {
          loud = true;
          w.__onsets.push(Math.round(now - w.__armAt));
        }
      } else if (loud) {
        quietSince ||= now;
        if (now - quietSince > 500) loud = false;
      }
    }, 20);
  });
const onsets = (page) => page.evaluate(() => window.__onsets ?? []);

function checkTiming(scene, from, expectSteps) {
  const d = deltas(scriptLines(from));
  const worst = d.reduce((m, x) => Math.max(m, Math.abs(x.delta)), 0);
  step(`${scene}: agent logged ${d.length}/${expectSteps} timeline steps`, d.length === expectSteps, d.map((x) => `#${x.step} ${x.delta}ms`).join(" "));
  step(`${scene}: every step within ±${TOLERANCE_MS} ms of plan`, d.length > 0 && worst <= TOLERANCE_MS, `worst ${worst} ms`);
  return d;
}

let browser;
const timing = {};
try {
  const r0 = await video("POST", "/video/reset");
  step("reset before start", r0.status === 200, JSON.stringify(r0.j));
  step("magnesium is pending", (await magnesium()) === "pending");

  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const patient = await openPhone(browser, "patient");
  const caregiver = await openPhone(browser, "caregiver");
  step("both phone apps ready", true);

  // ---------------------------------------------------------------- scene 1
  let from = logOffset();
  let r = await video("POST", "/video/scene/1");
  step("scene 1 triggered", r.status === 200, r.j.room_name);
  await patient.getByText("Pal is calling…").waitFor({ timeout: 20000 });
  step("patient app rings: Pal is calling…", true);
  await patient.getByRole("button", { name: "Accept" }).click();
  await armAudioProbe(patient);
  let green = false;
  for (let i = 0; i < 40 && !green; i++) {
    await sleep(1000);
    green = (await magnesium()) === "taken";
    if (i === 6) await patient.screenshot({ path: `${OUT}/scene1-incall.png` });
  }
  step("scene 1: magnesium turned taken", green);
  await patient.getByText("Waiting for calls").waitFor({ timeout: 20000 });
  step("scene 1: call ended by the script, patient app back to Waiting for calls", true);
  timing.scene1 = { agent: checkTiming("scene 1", from, 6), phoneOnsets: await onsets(patient) };
  step("scene 1: Pal's voice heard on the patient phone (3 lines)", timing.scene1.phoneOnsets.length >= 3, `onsets after Accept tap: ${timing.scene1.phoneOnsets.join(", ")} ms`);
  let line = null;
  for (let i = 0; i < 10; i++) {
    line = (await video("GET", "/video/status")).j.line;
    if (!line) break;
    await sleep(1000);
  }
  step("scene 1: line freed", !line);

  // ---------------------------------------------------------------- reset
  r = await video("POST", "/video/reset");
  step("reset after scene 1", r.status === 200 && (await magnesium()) === "pending", JSON.stringify(r.j));

  // ---------------------------------------------------------------- scene 2
  from = logOffset();
  r = await video("POST", "/video/scene/2");
  const room = r.j.room_name;
  step("scene 2 triggered", r.status === 200, room);
  await patient.getByText("Pal is calling…").waitFor({ timeout: 20000 });
  await patient.getByRole("button", { name: "Accept" }).click();
  await armAudioProbe(patient);
  await caregiver.getByText("Shuvo is calling…").waitFor({ timeout: 30000 });
  await caregiver.screenshot({ path: `${OUT}/scene2-caregiver-ring.png` });
  await sleep(4000); // a person takes a few seconds to pick up (Pal is still finishing her line)
  const ringLine = (await video("GET", "/video/status")).j.line;
  step("caregiver app rings: Shuvo is calling…, same room", ringLine?.room_name === room, ringLine?.room_name);
  const alert = (await db.from("alerts").select("level, reason, sent_to").eq("patient_id", PID).order("created_at", { ascending: false }).limit(1)).data?.[0];
  step("escalation alert recorded (caregiver texted)", alert?.level === "orange" && /caregiver/.test(alert?.sent_to ?? ""), `${alert?.level} · ${alert?.sent_to}`);
  await caregiver.getByRole("button", { name: "Accept" }).click();
  await sleep(4000);
  const ids = (await rooms.listParticipants(room)).map((p) => p.identity);
  step(
    "room has Pal + patient + caregiver",
    ids.some((i) => i.startsWith("patient-web-")) && ids.some((i) => i.startsWith("caregiver-web-")) && ids.length >= 3,
    ids.map((i) => i.replace(/[0-9a-f-]{36}$/, "<uuid>")).join(", "),
  );
  await sleep(17000); // both caregiver lines (+1 s, +13 s)
  await caregiver.screenshot({ path: `${OUT}/scene2-caregiver-incall.png` });
  timing.scene2 = { agent: checkTiming("scene 2", from, 6), phoneOnsets: await onsets(patient) };
  step("scene 2: Pal's voice heard on the patient phone (4 lines)", timing.scene2.phoneOnsets.length >= 4, `onsets after Accept tap: ${timing.scene2.phoneOnsets.join(", ")} ms`);
  await patient.getByRole("button", { name: "End" }).click();
  await caregiver.getByText("Waiting for calls").waitFor({ timeout: 20000 });
  step("scene 2: patient hangs up → caregiver's call ends too", true);
  for (let i = 0; i < 15; i++) {
    line = (await video("GET", "/video/status")).j.line;
    if (!line) break;
    await sleep(1000);
  }
  step("scene 2: line freed", !line);
} catch (err) {
  step("run", false, err.message.split("\n")[0]);
} finally {
  await browser?.close().catch(() => undefined);
  const r = await video("POST", "/video/reset").catch(() => ({ status: 0 }));
  step("final reset", r.status === 200 && (await magnesium()) === "pending");
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots: ${OUT}`);
  console.log(`timing: ${JSON.stringify(timing)}`);
  process.exitCode = failed ? 1 : 0;
}
