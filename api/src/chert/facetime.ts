/**
 * Chert FaceTime calls (CHERT_FACETIME_MODE=mock|live), docs: facetime/outbound, facetime/group-calls,
 * facetime/calls-api, facetime/bring-your-own-room, facetime/limits.
 *
 * live dial():
 *   1. LiveKit room `pillpal-<kind>-<short uuid>`
 *   2. AgentDispatchClient.createDispatch(room, AGENT_NAME, metadata {patient_id, kind})
 *   3. bridge token: identity bridge-<uuid>, roomJoin/canPublish/canSubscribe on that room only,
 *      integer nbf/exp (jose), ttl 3600 s (≤ 7200, and > 90 s left at allocation)
 *   4. POST {FACETIME_BASE}/v1/calls {direction:"outbound", mode:"customer_managed", line_id, destination,
 *      destination_type:"phone", media:{audio:true, video:true}, livekit_url, participant_token,
 *      remote_participant_identity} with a fresh Idempotency-Key. 201 = allocated (not answered); id = data.id
 *   5. calls row saved (chert_call_id, room_name, kind, language)
 * Group calls use `recipients: [{type:"phone_number", value}]` instead of destination/destination_type.
 *
 * One line = one call: while a call is active, dial() throws LineBusyError (→ HTTP 409).
 * The line frees on endCall → terminal, POST /calls/ended, or (live) the watcher seeing a terminal state.
 * mock: no Chert or LiveKit request at all; ids are mock_call_<uuid>.
 * Never logs phones, tokens or keys.
 */
import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import { db } from "../db.js";
import { env } from "../env.js";
import { getPatient, must, mustOne } from "../lib/data.js";
import { patientPhone } from "../lib/notices.js";
import { ChertApiError, FACETIME_BASE, idempotencyKey, pickString, projectJson } from "./project-http.js";

export type CallKindName = "check_in" | "dose" | "escalation" | "reminder" | (string & {});

export type CallTarget = { destination: string } | { recipients: string[] };
export type CallContext = { patient_id: string; kind: CallKindName };
export type PlacedCall = { chert_call_id: string; room_name: string };
export type CallState = { status: string; terminal: boolean };

/** Transport: one implementation talks to Chert + LiveKit, the other to nothing. */
export interface ChertFaceTime {
  readonly mode: "mock" | "live";
  placeCall(target: CallTarget, ctx: CallContext): Promise<PlacedCall>;
  endCall(callId: string): Promise<void>;
  getCall(callId: string): Promise<CallState>;
  /** Lifecycle event type names (GET /v1/calls/{id}/events), for logs. */
  callEvents(callId: string): Promise<string[]>;
  /** Best-effort LiveKit cleanup after a call. */
  cleanup(roomName: string): Promise<void>;
}

/** Chert refusals: facetime_group_unavailable, recipient_not_verified, line_busy, … */
export class FaceTimeError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? `facetime: ${code}`);
    this.name = "FaceTimeError";
  }
}

export class LineBusyError extends HTTPException {
  constructor() {
    super(409, { message: "line_busy" });
    this.name = "LineBusyError";
  }
}

// ---------------------------------------------------------------- shared helpers

const shortId = () => randomUUID().replace(/-/g, "").slice(0, 8);
export const roomNameFor = (kind: string) => `pillpal-${kind.replace(/[^a-z0-9_]/gi, "")}-${shortId()}`;

/** Status values that mean the call is over. The docs do not enumerate them, so match broadly. */
const TERMINAL = /^(ended|completed|complete|failed|failure|canceled|cancelled|terminated|declined|rejected|busy|no_answer|missed|expired|timed_out|timeout|hung_up|closed|finished)$/i;

export function callStateFrom(json: unknown): CallState {
  const data = ((json as { data?: unknown })?.data ?? json ?? {}) as Record<string, unknown>;
  const status = String(data.status ?? data.state ?? "unknown");
  const terminal =
    TERMINAL.test(status) ||
    typeof data.ended_at === "string" ||
    typeof data.terminal_reason === "string" ||
    data.terminal === true;
  return { status, terminal };
}

// ---------------------------------------------------------------- live

/** LiveKit server operations (injectable for tests; no network in mock mode). */
export interface LiveKitOps {
  createRoom(name: string): Promise<void>;
  dispatchAgent(room: string, metadata: Record<string, unknown>): Promise<void>;
  bridgeToken(room: string, identity: string): Promise<string>;
  deleteRoom(name: string): Promise<void>;
}

export const BRIDGE_TTL_S = 3600;

export function liveKitOps(): LiveKitOps {
  const url = env.LIVEKIT_URL!;
  const key = env.LIVEKIT_API_KEY!;
  const secret = env.LIVEKIT_API_SECRET!;
  const httpUrl = url.replace(/^ws(s?):\/\//, "http$1://");
  const rooms = new RoomServiceClient(httpUrl, key, secret);
  const dispatch = new AgentDispatchClient(httpUrl, key, secret);
  return {
    async createRoom(name) {
      await rooms.createRoom({ name, emptyTimeout: 120, departureTimeout: 20 });
    },
    async dispatchAgent(room, metadata) {
      await dispatch.createDispatch(room, env.AGENT_NAME, { metadata: JSON.stringify(metadata) });
    },
    bridgeToken: (room, identity) => mintBridgeToken(key, secret, room, identity),
    async deleteRoom(name) {
      await rooms.deleteRoom(name);
    },
  };
}

/** Room-scoped bridge JWT: sub = identity, join/publish/subscribe on `room` only, integer nbf/exp. */
export async function mintBridgeToken(key: string, secret: string, room: string, identity: string): Promise<string> {
  const at = new AccessToken(key, secret, { identity, ttl: BRIDGE_TTL_S });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

export class LiveChertFaceTime implements ChertFaceTime {
  readonly mode = "live" as const;
  constructor(private readonly lk: LiveKitOps = liveKitOps()) {}

  async placeCall(target: CallTarget, ctx: CallContext): Promise<PlacedCall> {
    const room = roomNameFor(ctx.kind);
    await this.lk.createRoom(room);
    try {
      await this.lk.dispatchAgent(room, { patient_id: ctx.patient_id, kind: ctx.kind });
      const identity = `bridge-${randomUUID()}`;
      const participant_token = await this.lk.bridgeToken(room, identity);
      const body = {
        direction: "outbound",
        mode: "customer_managed",
        line_id: env.CHERT_LINE_ID,
        ...("destination" in target
          ? { destination: target.destination, destination_type: "phone" }
          : { recipients: target.recipients.map((value) => ({ type: "phone_number", value })) }),
        media: { audio: true, video: true },
        livekit_url: env.LIVEKIT_URL,
        participant_token,
        remote_participant_identity: env.AGENT_NAME,
      };
      let json: unknown;
      try {
        json = await projectJson({
          base: FACETIME_BASE,
          method: "POST",
          path: "/v1/calls",
          body,
          idempotencyKey: idempotencyKey("call"),
        });
      } catch (err) {
        if (err instanceof ChertApiError) throw new FaceTimeError(err.code ?? `http_${err.status}`, err.message);
        throw err;
      }
      const id = pickString(json, ["id", "call_id"]);
      if (!id) throw new FaceTimeError("no_call_id", "POST /v1/calls response had no data.id");
      console.log(`[facetime] call allocated (${"destination" in target ? "1:1" : "group"}, kind=${ctx.kind})`);
      return { chert_call_id: id, room_name: room };
    } catch (err) {
      await this.lk.deleteRoom(room).catch(() => undefined);
      throw err;
    }
  }

  async endCall(callId: string): Promise<void> {
    await projectJson({
      base: FACETIME_BASE,
      method: "POST",
      path: `/v1/calls/${encodeURIComponent(callId)}/end`,
      body: {},
      idempotencyKey: idempotencyKey("end"),
    });
  }

  async getCall(callId: string): Promise<CallState> {
    return callStateFrom(
      await projectJson({ base: FACETIME_BASE, method: "GET", path: `/v1/calls/${encodeURIComponent(callId)}` }),
    );
  }

  async callEvents(callId: string): Promise<string[]> {
    const json = (await projectJson({
      base: FACETIME_BASE,
      method: "GET",
      path: `/v1/calls/${encodeURIComponent(callId)}/events`,
    })) as { data?: unknown; events?: unknown };
    const list = Array.isArray(json.data) ? json.data : Array.isArray(json.events) ? json.events : [];
    return list.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return String(o.type ?? o.event_type ?? o.name ?? "?");
    });
  }

  async cleanup(roomName: string): Promise<void> {
    await this.lk.deleteRoom(roomName).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- mock

export class MockChertFaceTime implements ChertFaceTime {
  readonly mode = "mock" as const;
  private readonly ended = new Set<string>();
  private failGroup: string | undefined;
  readonly placed: { id: string; kind: string; group: boolean }[] = [];

  /** Dev/test hook: the next group call is refused with `code` (e.g. facetime_group_unavailable). */
  failNextGroup(code: string): void {
    this.failGroup = code;
  }

  async placeCall(target: CallTarget, ctx: CallContext): Promise<PlacedCall> {
    const group = "recipients" in target;
    if (group && this.failGroup) {
      const code = this.failGroup;
      this.failGroup = undefined;
      console.log(`[facetime-mock] group call refused: ${code}`);
      throw new FaceTimeError(code);
    }
    const id = `mock_call_${randomUUID()}`;
    this.placed.push({ id, kind: ctx.kind, group });
    console.log(`[facetime-mock] placeCall ${group ? "group" : "1:1"} kind=${ctx.kind}`);
    return { chert_call_id: id, room_name: roomNameFor(ctx.kind) };
  }

  async endCall(callId: string): Promise<void> {
    this.ended.add(callId);
    console.log("[facetime-mock] endCall");
  }

  async getCall(callId: string): Promise<CallState> {
    return this.ended.has(callId) ? { status: "ended", terminal: true } : { status: "active", terminal: false };
  }

  async callEvents(callId: string): Promise<string[]> {
    return this.ended.has(callId) ? ["call.started", "call.ended"] : ["call.started"];
  }

  async cleanup(): Promise<void> {}
}

// ---------------------------------------------------------------- line state + call service

export type ActiveLine = { chert_call_id: string; room_name: string; patient_id: string; kind: string; group: boolean };

/** How long a calls row with no ended_at still blocks the line after a restart (Shared calls are ≤ 5 min). */
const STALE_CALL_MS = 6 * 60_000;
const WATCH_EVERY_MS = 3000;
const WATCH_MAX_MS = 15 * 60_000;

export class FaceTimeService {
  private line: ActiveLine | null = null;
  private watchers = new Set<string>();

  constructor(readonly transport: ChertFaceTime) {}

  get mode() {
    return this.transport.mode;
  }

  activeLine(): ActiveLine | null {
    return this.line;
  }

  /** Busy if we hold the line, or a recent calls row with a Chert id has not ended (restart safety). */
  private async assertLineFree(): Promise<void> {
    if (this.line) throw new LineBusyError();
    const rows = must(
      "check line",
      await db
        .from("calls")
        .select("id, chert_call_id, started_at")
        .not("chert_call_id", "is", null)
        .is("ended_at", null)
        .gte("started_at", new Date(Date.now() - STALE_CALL_MS).toISOString())
        .order("started_at", { ascending: false })
        .limit(1),
    ) as { id: string; chert_call_id: string }[];
    const row = rows[0];
    if (!row) return;
    const state = await this.transport.getCall(row.chert_call_id).catch(() => ({ status: "unknown", terminal: false }));
    if (state.terminal) {
      await this.markEnded(row.chert_call_id);
      return;
    }
    throw new LineBusyError();
  }

  private async place(patientId: string, kind: CallKindName, target: CallTarget): Promise<PlacedCall & { call_id: string }> {
    await this.assertLineFree();
    const patient = await getPatient(patientId);
    // Claim the line before any await on the network so a concurrent dial gets 409.
    const claim: ActiveLine = { chert_call_id: "", room_name: "", patient_id: patientId, kind, group: "recipients" in target };
    this.line = claim;
    let placed: PlacedCall;
    try {
      placed = await this.transport.placeCall(target, { patient_id: patientId, kind });
    } catch (err) {
      if (this.line === claim) this.line = null;
      if (err instanceof FaceTimeError && err.code === "line_busy") throw new LineBusyError();
      throw err;
    }
    Object.assign(claim, placed);
    const row = mustOne(
      "insert call",
      await db
        .from("calls")
        .insert({
          patient_id: patientId,
          chert_call_id: placed.chert_call_id,
          room_name: placed.room_name,
          kind,
          language: patient.language,
        })
        .select("id")
        .single(),
    );
    if (this.transport.mode === "live") this.watch(placed);
    return { ...placed, call_id: row.id };
  }

  /** 1:1 FaceTime video to the patient's phone. */
  async dial(patientId: string, kind: CallKindName): Promise<PlacedCall & { call_id: string }> {
    const patient = await getPatient(patientId);
    const phone = patientPhone(patient);
    if (!phone) throw new HTTPException(409, { message: "patient_has_no_phone" });
    return this.place(patientId, kind, { destination: phone });
  }

  /** Group FaceTime (2–31 recipients, set at creation). */
  async dialGroup(patientId: string, phones: string[], kind: CallKindName): Promise<PlacedCall & { call_id: string }> {
    const recipients = [...new Set(phones)];
    if (recipients.length < 2) throw new FaceTimeError("not_enough_recipients");
    return this.place(patientId, kind, { recipients });
  }

  async endCall(callId: string): Promise<void> {
    await this.transport.endCall(callId);
  }

  getCall(callId: string): Promise<CallState> {
    return this.transport.getCall(callId);
  }

  /** Poll until the call is terminal (true) or the timeout passes (false). Marks it ended either way if terminal. */
  async waitUntilEnded(callId: string, timeoutMs = 10_000, everyMs = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.transport.getCall(callId).catch(() => ({ status: "unknown", terminal: false }));
      if (s.terminal) {
        await this.markEnded(callId);
        return true;
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, everyMs));
    }
  }

  /** calls.ended_at (if not set) + free the line + LiveKit cleanup. Idempotent. */
  async markEnded(callId: string): Promise<void> {
    must(
      "mark call ended",
      await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("chert_call_id", callId).is("ended_at", null),
    );
    if (this.line?.chert_call_id === callId) {
      const room = this.line.room_name;
      this.line = null;
      await this.transport.cleanup(room);
    }
  }

  /** POST /calls/ended: the agent finished this room → free the line. */
  releaseRoom(roomName: string): void {
    if (this.line?.room_name === roomName) {
      this.line = null;
      void this.transport.cleanup(roomName);
    }
  }

  /** live: poll the call state; on terminal, close the row, free the line and log event type names. */
  private watch(placed: PlacedCall): void {
    const id = placed.chert_call_id;
    if (this.watchers.has(id)) return;
    this.watchers.add(id);
    const started = Date.now();
    let last = "";
    const tick = async () => {
      try {
        const s = await this.transport.getCall(id);
        if (s.status !== last) console.log(`[facetime] call status ${s.status}`);
        last = s.status;
        if (s.terminal) {
          await this.markEnded(id);
          const types = await this.transport.callEvents(id).catch(() => []);
          if (types.length) console.log(`[facetime] call events: ${types.join(", ")}`);
          this.watchers.delete(id);
          return;
        }
      } catch (err) {
        console.error(`[facetime] watch failed: ${(err as Error).message}`);
      }
      if (Date.now() - started > WATCH_MAX_MS) {
        this.watchers.delete(id);
        if (this.line?.chert_call_id === id) this.line = null;
        return;
      }
      setTimeout(tick, WATCH_EVERY_MS);
    };
    setTimeout(tick, WATCH_EVERY_MS);
  }
}

const transport: ChertFaceTime = env.CHERT_FACETIME_MODE === "live" ? new LiveChertFaceTime() : new MockChertFaceTime();

export const facetime = new FaceTimeService(transport);

/** The mock transport (undefined in live mode). */
export const mockFaceTime = (): MockChertFaceTime | undefined =>
  transport instanceof MockChertFaceTime ? transport : undefined;
