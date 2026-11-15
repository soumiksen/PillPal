"use client";
/**
 * The two home-screen phone apps: /patient ("PillPal") and /caregiver ("PillPal Care").
 * setup (access code) → Start (unlocks audio, keeps the screen on) → waiting → incoming call → in call → waiting.
 * Big text and buttons for an older user; works in iPhone Safari standalone mode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "livekit-client";
import { Phone, PhoneOff, Settings } from "lucide-react";
import type { CallRole, RingEvent } from "@pillpal/shared";
import { keepAwake, loadPrefs, primeMedia, Ringer, savePrefs, type CallPrefs } from "./device";
import { InCall, newCallRoom } from "./in-call";
import { CallerPhoto, RoundButton } from "./parts";
import { useCallSignal, type SignalStatus } from "./use-call-signal";

type Screen =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "start" }
  | { kind: "idle"; note?: string }
  | { kind: "incoming"; ring: RingEvent }
  | { kind: "call"; ring: RingEvent; room: Room };

const APP_NAME: Record<CallRole, string> = { patient: "PillPal", caregiver: "PillPal Care" };

export function CallApp({ role }: { role: CallRole }) {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [prefs, setPrefs] = useState<CallPrefs | null>(null);
  const ringer = useRef<Ringer | null>(null);
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  });

  useEffect(() => {
    const p = loadPrefs(role);
    queueMicrotask(() => {
      setPrefs(p);
      setScreen(p ? { kind: "start" } : { kind: "setup" });
    });
  }, [role]);

  const ready = screen.kind === "idle" || screen.kind === "incoming" || screen.kind === "call";

  const onRing = useCallback((ring: RingEvent) => {
    const s = screenRef.current;
    if (s.kind === "call" || s.kind === "incoming") return; // busy: the API rings again or times out
    if (s.kind !== "idle") return;
    ringer.current?.start();
    setScreen({ kind: "incoming", ring });
  }, []);

  const onCancel = useCallback((ev: { call_id: string }) => {
    const s = screenRef.current;
    if (s.kind === "incoming" && s.ring.call_id === ev.call_id) {
      ringer.current?.stop();
      setScreen({ kind: "idle", note: `Missed call from ${s.ring.from}` });
    }
  }, []);

  const { status, send } = useCallSignal(role, prefs?.patientId ?? null, ready, { ring: onRing, cancel: onCancel });

  // Screen stays on while the app is ready for calls.
  useEffect(() => {
    if (!ready) return;
    return keepAwake();
  }, [ready]);

  useEffect(() => () => ringer.current?.stop(), []);

  const start = async () => {
    ringer.current ??= new Ringer();
    await ringer.current.unlock();
    void primeMedia();
    setScreen({ kind: "idle" });
  };

  const accept = (ring: RingEvent) => {
    ringer.current?.stop();
    // Created inside the tap so iOS lets the call's audio play.
    const room = newCallRoom();
    void room.startAudio().catch(() => undefined);
    void send("accepted", ring.call_id);
    setScreen({ kind: "call", ring, room });
  };

  const decline = (ring: RingEvent) => {
    ringer.current?.stop();
    void send("declined", ring.call_id);
    setScreen({ kind: "idle" });
  };

  if (screen.kind === "loading") return <Shell />;
  if (screen.kind === "setup") {
    return (
      <Setup
        role={role}
        initial={prefs}
        onSaved={(p) => {
          savePrefs(role, p);
          setPrefs(p);
          setScreen({ kind: "start" });
        }}
      />
    );
  }
  if (screen.kind === "start") return <Start role={role} onStart={start} />;
  if (screen.kind === "incoming") {
    return <Incoming role={role} ring={screen.ring} onAccept={() => accept(screen.ring)} onDecline={() => decline(screen.ring)} />;
  }
  if (screen.kind === "call") {
    return (
      <InCall
        role={role}
        ring={screen.ring}
        room={screen.room}
        code={prefs?.code ?? ""}
        onEnded={(note) => {
          void send("ended", screen.ring.call_id);
          setScreen({ kind: "idle", note });
        }}
      />
    );
  }
  return (
    <Idle
      role={role}
      status={status}
      note={screen.note}
      onSettings={() => {
        savePrefs(role, null);
        setScreen({ kind: "setup" });
      }}
    />
  );
}

// ---------------------------------------------------------------- screens

function Shell({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <main
      className={`fixed inset-0 flex flex-col bg-black text-white select-none ${className}`}
      style={{
        paddingTop: "max(env(safe-area-inset-top), 16px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
        paddingLeft: 16,
        paddingRight: 16,
        fontFamily: "var(--font-sans)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </main>
  );
}

function Setup({ role, initial, onSaved }: { role: CallRole; initial: CallPrefs | null; onSaved: (p: CallPrefs) => void }) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [patientId, setPatientId] = useState(initial?.patientId ?? process.env.NEXT_PUBLIC_PATIENT_ID ?? "");
  const [more, setMore] = useState(!process.env.NEXT_PUBLIC_PATIENT_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!code.trim()) return setError("Please type the access code.");
    if (!/^[0-9a-f-]{36}$/i.test(patientId.trim())) return setError("The patient id does not look right.");
    setBusy(true);
    try {
      const r = await fetch("/api/call-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, room_name: "pillpal-check", code: code.trim(), check: true }),
      });
      if (r.status === 401) return setError("That code is not right. Please try again.");
      if (!r.ok) return setError("Could not check the code. Is the internet on?");
      onSaved({ code: code.trim(), patientId: patientId.trim() });
    } catch {
      setError("Could not check the code. Is the internet on?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell className="overflow-y-auto">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <CallerPhoto role={role} size={110} />
          <h1 className="text-4xl font-bold">{APP_NAME[role]}</h1>
          <p className="text-xl text-white/70">Type the access code once. This phone will remember it.</p>
        </div>
        <label className="flex flex-col gap-2 text-xl">
          Access code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            className="rounded-2xl border-2 border-white/30 bg-white/10 px-4 py-4 text-2xl text-white outline-none focus:border-green-400"
          />
        </label>
        {more ? (
          <label className="flex flex-col gap-2 text-lg">
            Patient id
            <input
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              className="rounded-2xl border-2 border-white/30 bg-white/10 px-4 py-3 font-mono text-base text-white outline-none focus:border-green-400"
            />
          </label>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="text-left text-base text-white/50 underline">
            Change patient
          </button>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-red-500/20 px-4 py-3 text-lg text-red-200">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="min-h-16 rounded-full bg-green-500 px-6 text-2xl font-bold text-black active:bg-green-400 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Save"}
        </button>
      </form>
    </Shell>
  );
}

function Start({ role, onStart }: { role: CallRole; onStart: () => void }) {
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <CallerPhoto role={role} size={150} />
        <h1 className="text-5xl font-bold">{APP_NAME[role]}</h1>
        <p className="max-w-sm text-2xl text-white/75">
          {role === "patient" ? "Tap Start so Pal can call you." : "Tap Start to get calls from Pal."}
        </p>
      </div>
      <button
        onClick={onStart}
        className="mx-auto mb-6 min-h-20 w-full max-w-md rounded-full bg-green-500 text-3xl font-bold text-black active:bg-green-400"
      >
        Start
      </button>
    </Shell>
  );
}

const STATUS: Record<SignalStatus, { color: string; text: string }> = {
  off: { color: "bg-gray-500", text: "Starting…" },
  connecting: { color: "bg-amber-400", text: "Connecting…" },
  live: { color: "bg-green-500", text: "Ready" },
  error: { color: "bg-red-500", text: "Offline — check the internet" },
};

function Idle({ role, status, note, onSettings }: { role: CallRole; status: SignalStatus; note?: string; onSettings: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);
  const s = STATUS[status];
  return (
    <Shell>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-lg text-white/70" aria-live="polite">
          <span className={`inline-block h-3 w-3 rounded-full ${s.color}`} aria-hidden />
          {s.text}
        </span>
        <button onClick={onSettings} aria-label="Settings" className="flex h-12 w-12 items-center justify-center rounded-full text-white/40">
          <Settings aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <p className="text-7xl font-light tabular-nums">
          {now ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : " "}
        </p>
        <CallerPhoto role={role} size={120} />
        <h1 className="text-4xl font-bold">{APP_NAME[role]}</h1>
        <p className="text-2xl text-white/75">Waiting for calls</p>
        {note && <p className="rounded-full bg-white/10 px-5 py-2 text-xl text-white/80">{note}</p>}
      </div>
      <p className="pb-2 text-center text-base text-white/40">Keep this app open. The screen stays on.</p>
    </Shell>
  );
}

function subtitle(role: CallRole, ring: RingEvent): string {
  if (role === "caregiver") return ring.kind === "escalation" ? "Needs you now · Pal is on the call" : "Pal is on the call";
  if (ring.kind === "dose") return "Time for your medicine";
  if (ring.kind === "escalation") return "Checking on you";
  return "Video call";
}

function Incoming({ role, ring, onAccept, onDecline }: { role: CallRole; ring: RingEvent; onAccept: () => void; onDecline: () => void }) {
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 pt-6 text-center">
        <div className="animate-pulse rounded-full ring-4 ring-white/20">
          <CallerPhoto role={role} size={170} />
        </div>
        <h1 className="text-5xl font-bold" aria-live="assertive">
          {ring.from} is calling…
        </h1>
        <p className="text-2xl text-white/70">{subtitle(role, ring)}</p>
      </div>
      <div className="mx-auto mb-8 flex w-full max-w-md items-end justify-between px-4">
        <RoundButton label="Decline" color="bg-red-600 active:bg-red-500" onClick={onDecline}>
          <PhoneOff className="h-10 w-10" aria-hidden />
        </RoundButton>
        <RoundButton label="Accept" color="bg-green-500 active:bg-green-400" onClick={onAccept}>
          <Phone className="h-10 w-10" aria-hidden />
        </RoundButton>
      </div>
    </Shell>
  );
}
