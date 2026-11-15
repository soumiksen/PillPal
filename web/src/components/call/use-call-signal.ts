"use client";
/**
 * Supabase Realtime broadcast channel for one phone app: pillpal:<role>:<patient_id>.
 * Receives ring / cancel from the API; sends accepted / declined / ended.
 * Uses its own anon client (no auth session) so it never interferes with the portal's sign-in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { CancelEvent, RingEvent, callChannel, type CallRole } from "@pillpal/shared";

export type SignalStatus = "off" | "connecting" | "live" | "error";

let client: SupabaseClient | null | undefined;
function realtimeClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

export function useCallSignal(
  role: CallRole,
  patientId: string | null,
  enabled: boolean,
  on: { ring: (ev: RingEvent) => void; cancel: (ev: CancelEvent) => void },
) {
  const [status, setStatus] = useState<SignalStatus>("off");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlers = useRef(on);
  useEffect(() => {
    handlers.current = on;
  });

  useEffect(() => {
    if (!enabled || !patientId) return;
    const sb = realtimeClient();
    if (!sb) {
      queueMicrotask(() => setStatus("error"));
      return;
    }
    queueMicrotask(() => setStatus("connecting"));
    const ch = sb.channel(callChannel(role, patientId), { config: { broadcast: { self: false, ack: true } } });
    ch.on("broadcast", { event: "ring" }, (msg) => {
      const ev = RingEvent.safeParse(msg.payload);
      if (ev.success) handlers.current.ring(ev.data);
    });
    ch.on("broadcast", { event: "cancel" }, (msg) => {
      const ev = CancelEvent.safeParse(msg.payload);
      if (ev.success) handlers.current.cancel(ev.data);
    });
    ch.subscribe((s) => {
      if (s === "SUBSCRIBED") setStatus("live");
      else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") setStatus("error");
      else if (s === "CLOSED") setStatus("connecting");
    });
    channelRef.current = ch;

    // iOS suspends sockets in the background; when the app comes back, make sure we are joined again.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (ch.state !== "joined" && ch.state !== "joining") {
        setStatus("connecting");
        ch.subscribe();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channelRef.current = null;
      void sb.removeChannel(ch);
      setStatus("off");
    };
  }, [role, patientId, enabled]);

  const send = useCallback(
    async (event: "accepted" | "declined" | "ended", callId: string) => {
      const ch = channelRef.current;
      if (!ch) return;
      try {
        await ch.send({ type: "broadcast", event, payload: { call_id: callId, role } });
      } catch {
        /* the API also watches the LiveKit room, so a lost reply is recovered */
      }
    },
    [role],
  );

  return { status, send };
}
