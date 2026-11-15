/**
 * Web calls (CALL_TRANSPORT=web): our own FaceTime-style home-screen apps on LiveKit Cloud, no Chert FaceTime.
 *
 * dial(patient, kind):
 *   1. LiveKit room pillpal-<kind>-<short id>
 *   2. dispatch AGENT_NAME with metadata {patient_id, kind, transport:"web"}
 *   3. calls row (patient_id, kind, room_name, started_at, language)
 *   4. broadcast `ring` on pillpal:patient:<id> (from "Pal")
 *   5. no `accepted` within RING_TIMEOUT_MS → `cancel`, the call ends as no answer (room deleted)
 * Escalation (ringCaregiver): same room, `ring` on pillpal:caregiver:<id> (from the patient's name). With no call
 * on the line a new escalation room is started and both phones ring.
 * accepted / declined / ended come back from the apps; while a call is live the room is polled and closed when
 * no human (patient-web-*, caregiver-web-*) is left. One active call at a time (LineBusyError → 409).
 * Logs ids, roles and kinds only.
 */
import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";
import type { CallReplyEvent, CallRole, WebCallKind } from "@pillpal/shared";
import { identityPrefix } from "@pillpal/shared";
import { LineBusyError, roomNameFor } from "../chert/facetime.js";
import type { ReplyName, SignalBus } from "./signal.js";

export const RING_TIMEOUT_MS = 45_000;
const WATCH_EVERY_MS = 4000;
/** After an accept, how long we wait for that phone to show up in the room before giving up on it. */
const JOIN_GRACE_MS = 30_000;
/** No human in the room for this long (after someone joined) → close. Covers app kills and lost networks. */
const EMPTY_CLOSE_MS = 10_000;

export type CallOutcome = "ringing" | "answered" | "no_answer" | "declined";

export interface WebLiveKit {
  createRoom(name: string): Promise<void>;
  dispatchAgent(room: string, metadata: Record<string, unknown>): Promise<void>;
  /** Identities currently in the room ([] if the room is gone). */
  participants(room: string): Promise<string[]>;
  deleteRoom(name: string): Promise<void>;
}

export interface CallStore {
  /** → calls.id */
  insertCall(row: { patient_id: string; kind: string; room_name: string }): Promise<string>;
  markEnded(callId: string): Promise<void>;
  callerName(patientId: string): Promise<string>;
}

export type WebLine = {
  call_id: string;
  room_name: string;
  patient_id: string;
  kind: WebCallKind;
  started_at: number;
  outcome: CallOutcome;
  /** Phones being rung right now → ring timeout timer. */
  ringing: Map<CallRole, NodeJS.Timeout>;
  /** Phones that accepted and have not hung up → accepted at (ms). */
  inCall: Map<CallRole, number>;
  humanSeen: boolean;
  emptySince: number | null;
  watch: NodeJS.Timeout | null;
  ending: boolean;
};

export type DialResult = { chert_call_id: null; room_name: string; call_id: string };

export function webLiveKit(url: string, key: string, secret: string, agentName: string): WebLiveKit {
  const httpUrl = url.replace(/^ws(s?):\/\//, "http$1://");
  const rooms = new RoomServiceClient(httpUrl, key, secret);
  const dispatch = new AgentDispatchClient(httpUrl, key, secret);
  return {
    async createRoom(name) {
      await rooms.createRoom({ name, emptyTimeout: 120, departureTimeout: 20 });
    },
    async dispatchAgent(room, metadata) {
      await dispatch.createDispatch(room, agentName, { metadata: JSON.stringify(metadata) });
    },
    async participants(room) {
      try {
        return (await rooms.listParticipants(room)).map((p) => p.identity);
      } catch {
        return [];
      }
    },
    async deleteRoom(name) {
      await rooms.deleteRoom(name);
    },
  };
}

const isHuman = (identity: string) =>
  identity.startsWith(identityPrefix("patient")) || identity.startsWith(identityPrefix("caregiver"));

export class WebCallService {
  readonly mode = "web" as const;
  private line: WebLine | null = null;
  /** call_id → final outcome, for the scheduler's retry rule (bounded). */
  private outcomes = new Map<string, CallOutcome>();
  private claiming = false;

  constructor(
    private readonly lk: WebLiveKit,
    private readonly bus: SignalBus,
    private readonly store: CallStore,
    private readonly opts: { ringTimeoutMs?: number; watchEveryMs?: number } = {},
  ) {
    bus.onReply((patientId, name, ev) => void this.onReply(patientId, name, ev));
  }

  /** Open the patient's two Realtime channels ahead of the first call. */
  listen(patientId: string): Promise<void> {
    return this.bus.watch(patientId);
  }

  activeLine(): WebLine | null {
    return this.line;
  }

  outcome(callId: string): CallOutcome | undefined {
    return this.line?.call_id === callId ? this.line.outcome : this.outcomes.get(callId);
  }

  /** Ring the patient (and, for escalation with no call on the line, the caregiver too). */
  async dial(patientId: string, kind: WebCallKind, alsoCaregiver = false): Promise<DialResult> {
    if (this.line || this.claiming) throw new LineBusyError();
    this.claiming = true;
    try {
      await this.bus.watch(patientId);
      const room = roomNameFor(kind);
      await this.lk.createRoom(room);
      let callId: string;
      try {
        await this.lk.dispatchAgent(room, { patient_id: patientId, kind, transport: "web" });
        callId = await this.store.insertCall({ patient_id: patientId, kind, room_name: room });
      } catch (err) {
        await this.lk.deleteRoom(room).catch(() => undefined);
        throw err;
      }
      const line: WebLine = {
        call_id: callId,
        room_name: room,
        patient_id: patientId,
        kind,
        started_at: Date.now(),
        outcome: "ringing",
        ringing: new Map(),
        inCall: new Map(),
        humanSeen: false,
        emptySince: null,
        watch: null,
        ending: false,
      };
      this.line = line;
      console.log(`[webcall] dial kind=${kind} room=${room}`);
      await this.ring(line, "patient", "Pal");
      if (alsoCaregiver) await this.ring(line, "caregiver", await this.store.callerName(patientId));
      this.startWatch(line);
      return { chert_call_id: null, room_name: room, call_id: callId };
    } finally {
      this.claiming = false;
    }
  }

  /**
   * Escalation: bring the caregiver into the current call for this patient, or start a new escalation call
   * that rings both phones. → room name.
   */
  async ringCaregiver(patientId: string): Promise<{ room_name: string; new_call: boolean }> {
    const line = this.line;
    if (line && line.patient_id === patientId && !line.ending) {
      if (line.inCall.has("caregiver") || line.ringing.has("caregiver")) {
        console.log("[webcall] caregiver already in / being rung, not ringing again");
        return { room_name: line.room_name, new_call: false };
      }
      await this.ring(line, "caregiver", await this.store.callerName(patientId));
      return { room_name: line.room_name, new_call: false };
    }
    if (line) {
      // Another patient's call holds the line (single-patient demo: should not happen). Do not hijack it.
      throw new LineBusyError();
    }
    const placed = await this.dial(patientId, "escalation", true);
    return { room_name: placed.room_name, new_call: true };
  }

  /** The agent finished (POST /calls/ended). Free the line; the room closes once no human is left. */
  releaseRoom(roomName: string): void {
    const line = this.line;
    if (!line || line.room_name !== roomName) return;
    void (async () => {
      const humans = (await this.lk.participants(roomName)).filter(isHuman);
      if (humans.length === 0) await this.end(line, "agent_done");
      // Otherwise the watcher closes the room when the last person hangs up.
    })();
  }

  private async ring(line: WebLine, role: CallRole, from: string): Promise<void> {
    const timeout = this.opts.ringTimeoutMs ?? RING_TIMEOUT_MS;
    clearTimeout(line.ringing.get(role));
    line.ringing.set(
      role,
      setTimeout(() => void this.ringTimedOut(line, role), timeout),
    );
    await this.bus.ring(role, line.patient_id, { call_id: line.call_id, room_name: line.room_name, kind: line.kind, from });
  }

  private async stopRinging(line: WebLine, role: CallRole, sendCancel: boolean): Promise<void> {
    const t = line.ringing.get(role);
    if (t === undefined) return;
    clearTimeout(t);
    line.ringing.delete(role);
    if (sendCancel) await this.bus.cancel(role, line.patient_id, { call_id: line.call_id }).catch(() => undefined);
  }

  private async ringTimedOut(line: WebLine, role: CallRole): Promise<void> {
    if (this.line !== line || !line.ringing.has(role)) return;
    console.log(`[webcall] ${role} did not answer in time`);
    await this.stopRinging(line, role, true);
    if (line.inCall.size === 0 && line.ringing.size === 0) {
      line.outcome = "no_answer";
      await this.end(line, "no_answer");
    }
  }

  private async onReply(patientId: string, name: ReplyName, ev: CallReplyEvent): Promise<void> {
    const line = this.line;
    if (!line || line.patient_id !== patientId || line.call_id !== ev.call_id || line.ending) return;
    const role = ev.role;
    if (name === "accepted") {
      await this.stopRinging(line, role, false);
      line.inCall.set(role, Date.now());
      if (role === "patient") line.outcome = "answered";
      return;
    }
    if (name === "declined") {
      await this.stopRinging(line, role, false);
      if (role === "patient" && line.outcome === "ringing") line.outcome = "declined";
    } else {
      // ended: that phone hung up
      line.inCall.delete(role);
      await this.stopRinging(line, role, false);
    }
    if (line.inCall.size === 0 && line.ringing.size === 0) {
      await this.end(line, name === "declined" ? "declined" : "hung_up");
    }
  }

  private startWatch(line: WebLine): void {
    const every = this.opts.watchEveryMs ?? WATCH_EVERY_MS;
    const tick = async () => {
      line.watch = null;
      if (this.line !== line || line.ending) return;
      const humans = (await this.lk.participants(line.room_name)).filter(isHuman);
      const now = Date.now();
      // Forget accepts whose phone never arrived.
      for (const [role, at] of line.inCall) {
        const there = humans.some((h) => h.startsWith(identityPrefix(role)));
        if (!there && now - at > JOIN_GRACE_MS && !line.humanSeen) line.inCall.delete(role);
      }
      if (humans.length > 0) {
        line.humanSeen = true;
        line.emptySince = null;
      } else if (line.humanSeen) {
        line.emptySince ??= now;
        if (now - line.emptySince >= EMPTY_CLOSE_MS && line.ringing.size === 0) {
          await this.end(line, "room_empty");
          return;
        }
      } else if (line.inCall.size === 0 && line.ringing.size === 0 && line.outcome !== "ringing") {
        await this.end(line, "never_joined");
        return;
      }
      if (this.line === line) line.watch = setTimeout(() => void tick(), every);
    };
    line.watch = setTimeout(() => void tick(), every);
  }

  /** ended_at, cancel any ringing phone, delete the room (the agent leaves with it), free the line. Idempotent. */
  private async end(line: WebLine, why: string): Promise<void> {
    if (line.ending) return;
    line.ending = true;
    if (line.watch) clearTimeout(line.watch);
    for (const role of [...line.ringing.keys()]) await this.stopRinging(line, role, true);
    if (line.outcome === "ringing") line.outcome = "no_answer";
    this.outcomes.set(line.call_id, line.outcome);
    if (this.outcomes.size > 200) this.outcomes.delete(this.outcomes.keys().next().value!);
    if (this.line === line) this.line = null;
    console.log(`[webcall] call over (${why}), closing room`);
    await this.store.markEnded(line.call_id).catch((err: Error) => console.error(`[webcall] mark ended failed: ${err.message}`));
    await this.lk.deleteRoom(line.room_name).catch(() => undefined);
  }

  /** Test/dev hook: identities in the active room. */
  async participants(): Promise<string[]> {
    return this.line ? this.lk.participants(this.line.room_name) : [];
  }
}
