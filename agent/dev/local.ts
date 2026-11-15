/**
 * Localhost harness for Pal (no Chert line needed).
 *   livekit-server --dev          → ws://localhost:7880 (key "devkey", secret "secret")
 *   npm run dev:agent             → Pal registers as AGENT_NAME
 *   npm run dev:local             → this file: test page + mock REST API on :8788
 * Open http://localhost:8788 — your mic + camera are sent to Pal; the camera is published
 * as "facetime-remote-video", exactly like the Chert bridge does.
 * Mock data only (fictional patient). Not part of the product build.
 */
import { createServer } from "node:http";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { PatientContext } from "@pillpal/shared";
import { AVATARS, findAvatar } from "../src/avatars/catalog.js";

const PORT = Number(process.env.LOCAL_PORT ?? 8788);
const KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const SECRET = process.env.LIVEKIT_API_SECRET ?? "secret";
const WS = process.env.LIVEKIT_URL ?? "ws://localhost:7880";
const AGENT = process.env.AGENT_NAME ?? "pillpal-agent";

const now = new Date().toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PATIENT = uuid(1);
const med = (n: number, drug: string, strength: string, food: "with_food" | "empty_stomach", look: string) => ({
  id: uuid(n), patient_id: PATIENT, drug, strength, dose: "1 tablet", times: ["08:00"], food_rule: food,
  avoid_foods: food === "empty_stomach" ? ["grapefruit"] : ["alcohol"], pills_left: 20, refill_info: null,
  pill_description: look, reference_photo_url: null, active: true, confirmed_by: "demo", created_at: now,
});
const meds = [
  med(2, "Metformin", "500 mg", "with_food", "white oblong tablet"),
  med(3, "Levothyroxine", "50 mcg", "empty_stomach", "small round pale-orange tablet"),
];
const context = PatientContext.parse({
  patient: {
    id: PATIENT, name: "Rose Miller", preferred_name: "Rose", phone: null, language: process.env.DEMO_LANGUAGE ?? "en",
    meal_times: null, caregiver_name: "Anna", caregiver_phone: null, doctor_name: "Patel", address: null,
    consent_at: now, care_chat_id: null, created_at: now,
  },
  meds,
  due_now: [{ medication_id: uuid(3), drug: "Levothyroxine", dose: "1 tablet", scheduled_at: now, food_rule: "empty_stomach" }],
  memories: [{ id: uuid(9), patient_id: PATIENT, fact: "Her granddaughter visits on Sundays", created_at: now }],
  last_checkins: [],
});

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Pal local test</title>
<style>body{font:18px system-ui;margin:2rem auto;max-width:640px;padding:0 1rem}video{width:100%;max-height:65vh;object-fit:contain;border-radius:12px;background:#000}
button{font:inherit;padding:.6rem 1.2rem;margin:.5rem .5rem .5rem 0}#log{white-space:pre-wrap;font:14px monospace;color:#555}</style>
<h1>Talk to Pal (localhost)</h1>
<p>Local test · fictional patient · simulated caregiver alerts · no FaceTime calls</p>
<video id=pal autoplay playsinline aria-label="Pal avatar"></video>
<video id=me autoplay muted playsinline style="width:140px" aria-label="Your camera"></video>
<p><label>Companion <select id=avatar><option value="">Familiar face (automatic)</option>${AVATARS.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}</select></label></p>
<p><button id=go>Start call</button><button id=stop disabled>Hang up</button></p><div id=log></div>
<script src="https://unpkg.com/livekit-client@2.9.0/dist/livekit-client.umd.js"></script>
<script>
const go=document.getElementById('go'),stopButton=document.getElementById('stop'),pal=document.getElementById('pal'),me=document.getElementById('me'),avatar=document.getElementById('avatar');
const log=m=>document.getElementById('log').textContent+=m+'\\n';let room;
go.onclick=async()=>{go.disabled=true;try{
 const {token,url}=await (await fetch('/token?avatar_id='+encodeURIComponent(avatar.value))).json();
 room=new LivekitClient.Room();
 room.on('trackSubscribed',(t)=>{if(t.kind==='audio'){const el=t.attach();el.dataset.palAudio='true';document.body.appendChild(el);log('Pal joined (audio)')}else if(t.kind==='video'){t.attach(pal);pal.muted=true;log('Pal joined (video)')}});
 room.on('trackUnsubscribed',t=>t.detach().forEach(el=>{if(el.tagName==='AUDIO')el.remove()}));
 await room.connect(url,token);
 const tracks=await LivekitClient.createLocalTracks({audio:true,video:{resolution:{width:640,height:480}}});
 for(const t of tracks){ if(t.kind==='video'){me.srcObject=new MediaStream([t.mediaStreamTrack]);
   await room.localParticipant.publishTrack(t,{name:'facetime-remote-video',source:LivekitClient.Track.Source.Camera});}
  else await room.localParticipant.publishTrack(t,{name:'facetime-remote-audio'});}
 log('Connected. Say hello to Pal.');stopButton.disabled=false;
 }catch{room&&room.disconnect();go.disabled=false;stopButton.disabled=true;log('Could not start the call. Check microphone/camera permissions and the terminal.')}};
stopButton.onclick=()=>{room&&room.disconnect();document.querySelectorAll('[data-pal-audio]').forEach(el=>el.remove());pal.srcObject=null;me.srcObject=null;go.disabled=false;stopButton.disabled=true;log('Hung up.')};
</script>`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (o: unknown, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return void res.end(PAGE);
  }
  if (req.method === "GET" && url.pathname === "/token") {
    const avatar = findAvatar(url.searchParams.get("avatar_id"));
    const room = `local-${Date.now()}`;
    const at = new AccessToken(KEY, SECRET, { identity: "local-avatar-tester", ttl: 3600 });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    at.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT, metadata: JSON.stringify({ patient_id: PATIENT, kind: "check_in", ...(avatar ? { avatar_id: avatar.id } : {}) }) })],
    });
    return json({ token: await at.toJwt(), url: WS });
  }
  // Mock of the REST API (contracts 5.3); logs only the route, never bodies.
  console.log(`[mock-api] ${req.method} ${url.pathname.replace(/[0-9a-f-]{36}/g, ":id")}`);
  for await (const _ of req) void _;
  if (req.method === "GET" && /^\/patients\/[^/]+\/context$/.test(url.pathname)) return json(context);
  if (req.method === "POST") {
    if (url.pathname === "/symptoms") return json({ ok: true });
    if (url.pathname === "/calls/ended") return json({ check_in_id: uuid(7), check_in: { summary: "(mock)", mood: 4, symptoms: [], visual_notes: [], quotes: [], risk_level: "green" } });
    if (url.pathname === "/escalate") return json({ alert_id: uuid(8), group_call_id: null });
    return json({ id: uuid(6) });
  }
  json({ error: "not found" }, 404);
}).listen(PORT, "127.0.0.1", () => console.log(`Pal test page + mock API → http://localhost:${PORT}`));
