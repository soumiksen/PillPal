/**
 * Call signalling over Supabase Realtime broadcast (no tables, no migrations). See @pillpal/shared calls.ts.
 * The API sends ring/cancel and listens for accepted/declined/ended on both channels of every patient it calls.
 * Logs channel roles and event names only (never patient data or tokens).
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CallReplyEvent, callChannel, type CallRole, type CancelEvent, type RingEvent } from "@pillpal/shared";
import { db } from "../db.js";

export type ReplyName = "accepted" | "declined" | "ended";
export type ReplyHandler = (patientId: string, name: ReplyName, ev: CallReplyEvent) => void;

export interface SignalBus {
  /** Start listening to both channels of a patient (idempotent). */
  watch(patientId: string): Promise<void>;
  ring(role: CallRole, patientId: string, ev: RingEvent): Promise<void>;
  cancel(role: CallRole, patientId: string, ev: CancelEvent): Promise<void>;
  onReply(h: ReplyHandler): void;
}

const SUBSCRIBE_TIMEOUT_MS = 10_000;

export class SupabaseSignalBus implements SignalBus {
  private channels = new Map<string, RealtimeChannel>();
  private pending = new Map<string, Promise<RealtimeChannel>>();
  private handlers: ReplyHandler[] = [];

  onReply(h: ReplyHandler): void {
    this.handlers.push(h);
  }

  async watch(patientId: string): Promise<void> {
    await Promise.all([this.channel("patient", patientId), this.channel("caregiver", patientId)]);
  }

  async ring(role: CallRole, patientId: string, ev: RingEvent): Promise<void> {
    await this.send(role, patientId, "ring", ev);
  }

  async cancel(role: CallRole, patientId: string, ev: CancelEvent): Promise<void> {
    await this.send(role, patientId, "cancel", ev);
  }

  private async send(role: CallRole, patientId: string, event: string, payload: object): Promise<void> {
    const ch = await this.channel(role, patientId);
    const res = await ch.send({ type: "broadcast", event, payload });
    if (res !== "ok") console.warn(`[signal] ${event} → ${role} not acknowledged (${res})`);
    else console.log(`[signal] ${event} → ${role}`);
  }

  private channel(role: CallRole, patientId: string): Promise<RealtimeChannel> {
    const name = callChannel(role, patientId);
    const have = this.channels.get(name);
    if (have) return Promise.resolve(have);
    const inflight = this.pending.get(name);
    if (inflight) return inflight;
    const p = new Promise<RealtimeChannel>((resolve, reject) => {
      const ch = db.channel(name, { config: { broadcast: { self: false, ack: true } } });
      for (const evName of ["accepted", "declined", "ended"] as const) {
        ch.on("broadcast", { event: evName }, (msg) => {
          const parsed = CallReplyEvent.safeParse(msg.payload);
          if (!parsed.success) return;
          console.log(`[signal] ${evName} ← ${parsed.data.role}`);
          for (const h of this.handlers) {
            try {
              h(patientId, evName, parsed.data);
            } catch (err) {
              console.error(`[signal] handler failed: ${(err as Error).message}`);
            }
          }
        });
      }
      const timer = setTimeout(() => reject(new Error(`realtime subscribe timed out (${role})`)), SUBSCRIBE_TIMEOUT_MS);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          this.channels.set(name, ch);
          resolve(ch);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // supabase-js rejoins on its own; only the first attempt can fail the promise.
          clearTimeout(timer);
          if (!this.channels.has(name)) reject(new Error(`realtime subscribe failed (${role}): ${status}`));
        }
      });
    }).finally(() => this.pending.delete(name));
    this.pending.set(name, p);
    return p;
  }
}

/** In-memory bus for tests: records sends; `reply()` simulates an app. */
export class MemorySignalBus implements SignalBus {
  readonly sent: { role: CallRole; event: "ring" | "cancel"; payload: RingEvent | CancelEvent }[] = [];
  private handlers: ReplyHandler[] = [];
  async watch(): Promise<void> {}
  async ring(role: CallRole, _p: string, ev: RingEvent) {
    this.sent.push({ role, event: "ring", payload: ev });
  }
  async cancel(role: CallRole, _p: string, ev: CancelEvent) {
    this.sent.push({ role, event: "cancel", payload: ev });
  }
  onReply(h: ReplyHandler) {
    this.handlers.push(h);
  }
  reply(patientId: string, name: ReplyName, ev: CallReplyEvent) {
    for (const h of this.handlers) h(patientId, name, ev);
  }
}
