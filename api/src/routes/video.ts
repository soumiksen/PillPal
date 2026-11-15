/**
 * Devpost video mode (laptop only). Every route needs `x-demo-code: <DEMO_ACCESS_CODE>`.
 *   GET  /director              tiny page with three big buttons (asks for the code once)
 *   GET  /video/status          current call + today's doses for VIDEO_PATIENT_ID
 *   POST /video/scene/1|2       ring the patient app; the agent (PAL_MODE=script) plays video_morning / video_fall
 *   POST /video/reset           close any call, today's magnesium back to pending, clear today's alerts
 *   POST /video/dose            agent action: mark today's dose of {drug} taken  {patient_id, drug, confirmed_via}
 *   POST /video/end             agent action: end the call in {room_name}
 * No LLM is called here. Logs ids/kinds only.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { webCalls } from "../calls/index.js";
import { LineBusyError } from "../chert/facetime.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { must } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { startOfZonedDay } from "../lib/time.js";

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

const demoCode: MiddlewareHandler = async (c, next) => {
  const code = c.req.header("x-demo-code");
  if (!env.DEMO_ACCESS_CODE) throw new HTTPException(503, { message: "DEMO_ACCESS_CODE is not set" });
  if (!code || !sameSecret(code, env.DEMO_ACCESS_CODE)) throw new HTTPException(401, { message: "wrong_code" });
  return next();
};

const SCENES = { "1": "video_morning", "2": "video_fall" } as const;

function videoPatient(): string {
  const id = env.VIDEO_PATIENT_ID ?? env.PATIENT_ID;
  if (!id) throw new HTTPException(503, { message: "VIDEO_PATIENT_ID is not set (npm run video:seed)" });
  return id;
}

function service() {
  if (!webCalls) throw new HTTPException(503, { message: "video mode needs CALL_TRANSPORT=web" });
  return webCalls;
}

/** Today's (America/Chicago) dose events for the patient's medication named `drug`. */
async function todaysDoses(patientId: string, drug: string) {
  const meds = must(
    "find medication",
    await db.from("medications").select("id").eq("patient_id", patientId).eq("active", true).ilike("drug", drug),
  ) as { id: string }[];
  if (!meds.length) throw new HTTPException(404, { message: "medication_not_found" });
  const from = startOfZonedDay();
  const to = startOfZonedDay(new Date(from.getTime() + 30 * 3600_000)); // tomorrow 00:00 (DST-safe)
  const rows = must(
    "find today's doses",
    await db
      .from("dose_events")
      .select("id, status, scheduled_at")
      .in("medication_id", meds.map((m) => m.id))
      .gte("scheduled_at", from.toISOString())
      .lt("scheduled_at", to.toISOString())
      .order("scheduled_at"),
  ) as { id: string; status: string; scheduled_at: string }[];
  return { medId: meds[0]!.id, rows };
}

export const video = new Hono();
video.use("*", demoCode);

video.get("/status", async (c) => {
  const pid = videoPatient();
  const line = service().activeLine();
  const doses = must(
    "status doses",
    await db
      .from("dose_events")
      .select("status, scheduled_at, medications(drug)")
      .eq("patient_id", pid)
      .gte("scheduled_at", startOfZonedDay().toISOString())
      .order("scheduled_at"),
  ) as unknown as { status: string; scheduled_at: string; medications: { drug: string } | null }[];
  return c.json({
    line: line && line.patient_id === pid ? { room_name: line.room_name, outcome: line.outcome, in_call: [...line.inCall.keys()], ringing: [...line.ringing.keys()] } : null,
    doses: doses.map((d) => ({ drug: d.medications?.drug ?? "?", status: d.status, scheduled_at: d.scheduled_at })),
  });
});

video.post("/scene/:n", async (c) => {
  const kind = SCENES[c.req.param("n") as keyof typeof SCENES];
  if (!kind) throw new HTTPException(404, { message: "unknown_scene" });
  const pid = videoPatient();
  try {
    const r = await service().dial(pid, "check_in", false, { kind, script: kind });
    console.log(`[video] scene ${kind} ringing (room ${r.room_name})`);
    return c.json({ ok: true, scene: kind, room_name: r.room_name, call_id: r.call_id });
  } catch (err) {
    if (err instanceof LineBusyError) throw new HTTPException(409, { message: "a call is already on the line: press Reset first" });
    throw err;
  }
});

video.post("/reset", async (c) => {
  const pid = videoPatient();
  const closed = await service().hangUp(undefined, "video_reset");
  const { rows } = await todaysDoses(pid, "Magnesium");
  if (rows.length) {
    must(
      "reset magnesium",
      await db.from("dose_events").update({ status: "pending", confirmed_via: null, evidence_jpeg_url: null }).in("id", rows.map((r) => r.id)),
    );
  }
  const alerts = must(
    "clear today's alerts",
    await db.from("alerts").delete().eq("patient_id", pid).gte("created_at", startOfZonedDay().toISOString()).select("id"),
  ) as { id: string }[];
  console.log(`[video] reset: call ${closed ? "closed" : "none"}, magnesium pending (${rows.length}), ${alerts.length} alert(s) cleared`);
  return c.json({ ok: true, call_closed: closed, magnesium_reset: rows.length, alerts_cleared: alerts.length });
});

const DoseBody = z.object({ patient_id: z.string().uuid(), drug: z.string().min(1), confirmed_via: z.string().min(1).default("facetime") });

video.post("/dose", async (c) => {
  const body = await jsonBody(c, DoseBody);
  const { medId, rows } = await todaysDoses(body.patient_id, body.drug);
  const target = rows.find((r) => r.status === "pending") ?? rows[0];
  if (target) {
    must("mark taken", await db.from("dose_events").update({ status: "taken", confirmed_via: body.confirmed_via }).eq("id", target.id));
    return c.json({ id: target.id });
  }
  const row = must(
    "insert taken dose",
    await db
      .from("dose_events")
      .insert({ patient_id: body.patient_id, medication_id: medId, scheduled_at: new Date().toISOString(), status: "taken", confirmed_via: body.confirmed_via })
      .select("id")
      .single(),
  ) as { id: string };
  return c.json({ id: row.id }, 201);
});

video.post("/end", async (c) => {
  const body = await jsonBody(c, z.object({ room_name: z.string().min(1) }));
  const ended = await service().hangUp(body.room_name, "video_script");
  return c.json({ ok: true, ended });
});

// ---------------------------------------------------------------- director page

export const director = new Hono();

director.get("/", (c) => c.html(DIRECTOR_HTML));

const DIRECTOR_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PillPal Director</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #111; color: #eee; display: flex; flex-direction: column; align-items: center; padding: 24px 16px; gap: 16px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  button { width: min(560px, 100%); min-height: 96px; font-size: 28px; font-weight: 700; border: 0; border-radius: 20px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .s1 { background: #8fd14f; color: #111; } .s2 { background: #ff6b5b; color: #111; } .reset { background: #444; color: #eee; min-height: 72px; font-size: 22px; }
  #status, #msg { width: min(560px, 100%); font: 15px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: #1c1c1c; border-radius: 12px; padding: 12px; box-sizing: border-box; }
  #msg:empty { display: none; }
  form { display: flex; gap: 8px; width: min(560px, 100%); } input { flex: 1; font-size: 20px; padding: 10px; border-radius: 10px; border: 1px solid #555; background: #222; color: #eee; }
  form button { width: auto; min-height: 0; font-size: 18px; padding: 10px 18px; background: #8fd14f; color: #111; }
</style></head><body>
<h1>PillPal Director</h1>
<form id="codeForm" hidden><input id="code" type="password" placeholder="Access code" autocomplete="off"><button>Save</button></form>
<button class="s1" data-path="/video/scene/1">Scene 1 – morning call</button>
<button class="s2" data-path="/video/scene/2">Scene 2 – fall</button>
<button class="reset" data-path="/video/reset">Reset (magnesium dose back to pending, close any call)</button>
<div id="msg"></div>
<div id="status">…</div>
<script>
  const KEY = "pillpal-director-code";
  let code = ""; try { code = localStorage.getItem(KEY) || ""; } catch {}
  const form = document.getElementById("codeForm"), msg = document.getElementById("msg"), status = document.getElementById("status");
  const askCode = () => { form.hidden = false; document.getElementById("code").focus(); };
  form.onsubmit = (e) => { e.preventDefault(); code = document.getElementById("code").value.trim(); try { localStorage.setItem(KEY, code); } catch {} form.hidden = true; refresh(); };
  async function call(method, path) {
    const r = await fetch(path, { method, headers: { "x-demo-code": code } });
    if (r.status === 401) { askCode(); throw new Error("Access code needed"); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || ("HTTP " + r.status));
    return j;
  }
  for (const b of document.querySelectorAll("button[data-path]")) b.onclick = async () => {
    b.disabled = true; msg.textContent = "";
    try { const j = await call("POST", b.dataset.path); msg.textContent = "✓ " + b.textContent + "\\n" + JSON.stringify(j); }
    catch (e) { msg.textContent = "✗ " + e.message; }
    finally { b.disabled = false; refresh(); }
  };
  async function refresh() {
    if (!code) return askCode();
    try {
      const s = await call("GET", "/video/status");
      const line = s.line ? "call: " + s.line.outcome + " · in call: " + (s.line.in_call.join(", ") || "–") + " · ringing: " + (s.line.ringing.join(", ") || "–") : "call: none";
      const doses = s.doses.map((d) => (d.status === "taken" ? "🟢 " : "⚪ ") + d.drug + " " + new Date(d.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " " + d.status).join("\\n");
      status.textContent = line + "\\n" + doses;
    } catch (e) { status.textContent = e.message; }
  }
  refresh(); setInterval(refresh, 2000);
</script>
</body></html>`;
