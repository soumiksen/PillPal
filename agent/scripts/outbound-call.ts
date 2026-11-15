/**
 * One-shot outbound FaceTime call: Pal calls the patient (Chert BYOR outbound, docs.trychert.com/facetime/outbound).
 *
 *   node --env-file=../.env --import tsx scripts/outbound-call.ts [--at HH:MM] [--audio-only]
 *
 * Flow: create a LiveKit room → dispatch pillpal-agent (job metadata: patient_id, outbound) → mint a bridge token →
 * POST /api/v1/calls → wait for bridge_ready → set room metadata {"chert_bridge_ready":true} (the agent greets on it) →
 * wait for the call to end → end it and delete the room.
 *
 * `chert dev` holds the line, so stop it first. Never logs tokens, phone numbers or response bodies.
 */
import { randomUUID } from "node:crypto";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const CHERT = "https://facetime.trychert.com/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
};
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

async function waitUntil(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = new Date();
  t.setHours(h ?? 0, m ?? 0, 0, 0);
  const ms = t.getTime() - Date.now();
  if (ms <= 0) return;
  log(`waiting until ${hhmm} (${Math.round(ms / 1000)} s)`);
  await sleep(ms);
}

async function chert(method: string, path: string, body?: unknown, idem?: string) {
  const res = await fetch(`${CHERT}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${need("CHERT_API_KEY")}`,
      "x-chert-project-id": need("CHERT_PROJECT_ID"),
      "content-type": "application/json",
      ...(idem ? { "idempotency-key": idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

async function main() {
  const livekitUrl = need("LIVEKIT_URL");
  const apiKey = need("LIVEKIT_API_KEY");
  const apiSecret = need("LIVEKIT_API_SECRET");
  const agentName = process.env.AGENT_NAME ?? "pillpal-agent";
  const patientId = need("PATIENT_ID");
  const video = !process.argv.includes("--audio-only");

  // Destination comes from the patient record (via our API), never typed into logs.
  const ctxRes = await fetch(`${process.env.API_URL ?? "http://localhost:8787"}/patients/${patientId}/context`);
  if (!ctxRes.ok) throw new Error(`could not load patient context (HTTP ${ctxRes.status})`);
  const phone = ((await ctxRes.json()) as { patient: { phone?: string | null } }).patient.phone;
  if (!phone) throw new Error("patient has no phone number");

  const at = arg("--at");
  if (at) await waitUntil(at);

  const httpUrl = livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const rooms = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const dispatch = new AgentDispatchClient(httpUrl, apiKey, apiSecret);

  const roomName = `pillpal-check_in-${patientId.slice(0, 8)}-${Date.now()}`;
  await rooms.createRoom({ name: roomName, emptyTimeout: 300 });
  await dispatch.createDispatch(roomName, agentName, {
    metadata: JSON.stringify({ patient_id: patientId, kind: "check_in", outbound: true }),
  });
  log("room created, agent dispatched");

  // Bridge identity starts with chert-bridge- so the agent recognises it (agent/src/agent.ts).
  const bridgeIdentity = `chert-bridge-out-${randomUUID().slice(0, 8)}`;
  const at2 = new AccessToken(apiKey, apiSecret, { identity: bridgeIdentity, ttl: 3600 });
  at2.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const bridgeToken = await at2.toJwt();

  // Give the agent a moment to join and publish its (silent) audio track before dialing.
  await sleep(4000);

  const create = await chert(
    "POST",
    "/calls",
    {
      direction: "outbound",
      mode: "customer_managed",
      line_id: need("CHERT_LINE_ID"),
      destination: phone,
      destination_type: "phone",
      media: { audio: true, video },
      livekit_url: livekitUrl,
      participant_token: bridgeToken,
      remote_participant_identity: agentName,
    },
    `pillpal-${randomUUID()}`,
  );
  log(`create call → HTTP ${create.status}`);
  const callId: string | undefined = create.json?.data?.id;
  if (create.status !== 201 || !callId) {
    // Chert error bodies carry codes/messages, not secrets; print only the error code/message fields.
    const e = create.json?.error ?? create.json;
    log(`call not created: ${String(e?.code ?? "")} ${String(e?.message ?? "").slice(0, 300)}`);
    await rooms.deleteRoom(roomName).catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  let ready = false;
  const started = Date.now();
  let lastStatus = "";
  for (;;) {
    await sleep(2000);
    const call = await chert("GET", `/calls/${callId}`);
    const status = String(call.json?.data?.status ?? "?");
    if (status !== lastStatus) {
      log(`call status: ${status}`);
      lastStatus = status;
    }
    if (!ready) {
      const ev = await chert("GET", `/calls/${callId}/events`);
      if (JSON.stringify(ev.json).includes("bridge_ready")) {
        ready = true;
        log("bridge_ready → telling Pal to greet");
        await rooms.updateRoomMetadata(
          roomName,
          JSON.stringify({ chert_call: callId, chert_bridge_ready: true, at: new Date().toISOString() }),
        );
      }
    }
    if (/ended|failed|terminated|declined|canceled|cancelled|missed|no_answer|expired/i.test(status)) break;
    if (!ready && Date.now() - started > 120_000) {
      log("never became ready within 120 s; ending the call");
      await chert("POST", `/calls/${callId}/end`, {}, `pillpal-end-${randomUUID()}`);
      break;
    }
    if (Date.now() - started > 15 * 60_000) {
      await chert("POST", `/calls/${callId}/end`, {}, `pillpal-end-${randomUUID()}`);
      break;
    }
  }
  const final = await chert("GET", `/calls/${callId}`);
  log(`final: status=${String(final.json?.data?.status ?? "?")} reason=${String(final.json?.data?.terminal_reason ?? "none")}`);
  await rooms.deleteRoom(roomName).catch(() => undefined);
  log("done");
}

main().catch((e) => {
  console.error("outbound-call failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
