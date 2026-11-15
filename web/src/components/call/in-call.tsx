"use client";
/**
 * In-call screen: remote video full screen (a grid when several people are in the call), own camera small in a
 * corner (front camera mirrored), names under tiles, call timer, and a bottom bar with mic, camera, flip, hang up.
 * Handles the other side leaving and reconnects. Uses livekit-client directly.
 */
import { useEffect, useRef, useState } from "react";
import {
  DisconnectReason,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from "lucide-react";
import { identityPrefix, type CallRole, type CallTokenResponse, type RingEvent } from "@pillpal/shared";
import { CallerPhoto, RoundButton } from "./parts";

/** Create inside the Accept tap (iOS audio unlock). */
export function newCallRoom(): Room {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { facingMode: "user", resolution: VideoPresets.h540.resolution },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    publishDefaults: { simulcast: true },
  });
}

/** When nobody else is left in the room for this long, the call is over. */
const ALONE_END_MS = 5000;

type Phase = "connecting" | "live" | "reconnecting" | "failed";

function nameOf(p: Participant, ring: RingEvent): string {
  if (p.isAgent || p.identity.startsWith("agent")) return "Pal";
  if (p.identity.startsWith(identityPrefix("patient"))) return ring.names?.patient ?? (p.name || "Patient");
  if (p.identity.startsWith(identityPrefix("caregiver"))) return ring.names?.caregiver ?? (p.name || "Caregiver");
  return p.name || "Guest";
}

/** Pal first, then the other people. */
function remoteOrder(p: Participant): number {
  return p.isAgent || p.identity.startsWith("agent") ? 0 : 1;
}

export function InCall({
  role,
  ring,
  room,
  code,
  onEnded,
}: {
  role: CallRole;
  ring: RingEvent;
  room: Room;
  code: string;
  onEnded: (note: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState("");
  const [, setVersion] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [front, setFront] = useState(true);
  const [needsTap, setNeedsTap] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const audioBox = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const done = useRef(false);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });

  const finish = (note: string) => {
    if (done.current) return;
    done.current = true;
    void room.disconnect();
    onEndedRef.current(note);
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  // Connect once (guarded against React's dev double-invoke).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const bump = () => setVersion((v) => v + 1);
    let aloneTimer: ReturnType<typeof setTimeout> | null = null;
    const checkAlone = () => {
      if (aloneTimer) clearTimeout(aloneTimer);
      aloneTimer = null;
      if (room.remoteParticipants.size === 0) {
        aloneTimer = setTimeout(() => {
          if (room.remoteParticipants.size === 0) finishRef.current("Call ended");
        }, ALONE_END_MS);
      }
    };

    room
      .on(RoomEvent.ParticipantConnected, () => {
        setStartedAt((t) => t ?? Date.now());
        checkAlone();
        bump();
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        checkAlone();
        bump();
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.setAttribute("playsinline", "true");
          audioBox.current?.appendChild(el);
        }
        bump();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        bump();
      })
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room.canPlaybackAudio))
      .on(RoomEvent.Reconnecting, () => setPhase("reconnecting"))
      .on(RoomEvent.Reconnected, () => setPhase("live"))
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (done.current) return;
        const note =
          reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.PARTICIPANT_REMOVED
            ? "Call ended"
            : "Call dropped";
        finishRef.current(note);
      });

    void (async () => {
      try {
        const r = await fetch("/api/call-token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            role,
            room_name: ring.room_name,
            code,
            name: role === "patient" ? ring.names?.patient : ring.names?.caregiver,
          }),
        });
        if (!r.ok) throw new Error(r.status === 401 ? "The access code changed. Open Settings." : "Could not join the call.");
        const { url, token } = (await r.json()) as CallTokenResponse;
        await room.connect(url, token);
        if (done.current) return void room.disconnect();
        setPhase("live");
        if (room.remoteParticipants.size > 0) setStartedAt(Date.now());
        checkAlone();
        setNeedsTap(!room.canPlaybackAudio);
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setMicOn(false));
        await room.localParticipant.setCameraEnabled(true).catch(() => setCamOn(false));
        bump();
      } catch (err) {
        setPhase("failed");
        setError((err as Error).message || "Could not join the call.");
        setTimeout(() => finishRef.current("Call failed"), 3500);
      }
    })();

    const leaveOnClose = () => void room.disconnect();
    window.addEventListener("pagehide", leaveOnClose);
    return () => {
      window.removeEventListener("pagehide", leaveOnClose);
      if (aloneTimer) clearTimeout(aloneTimer);
    };
  }, [room, ring, role, code]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remotes = [...room.remoteParticipants.values()].sort((a, b) => remoteOrder(a) - remoteOrder(b));
  const localCam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;

  const toggleMic = async () => {
    const next = !micOn;
    setMicOn(next);
    await room.localParticipant.setMicrophoneEnabled(next).catch(() => setMicOn(!next));
  };
  const toggleCam = async () => {
    const next = !camOn;
    setCamOn(next);
    await room.localParticipant.setCameraEnabled(next).catch(() => setCamOn(!next));
  };
  const flip = async () => {
    if (!localCam) return;
    const next = !front;
    try {
      await localCam.restartTrack({ facingMode: next ? "user" : "environment", resolution: VideoPresets.h540.resolution });
      setFront(next);
    } catch {
      /* only one camera */
    }
  };

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const cols = remotes.length >= 3 ? "grid-cols-2" : "grid-cols-1";

  return (
    <main className="fixed inset-0 bg-black text-white select-none" style={{ fontFamily: "var(--font-sans)" }}>
      <div ref={audioBox} className="hidden" />

      {/* Remote people */}
      <div className={`absolute inset-0 grid ${cols} auto-rows-fr gap-1`}>
        {remotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 text-center">
            <CallerPhoto role={role} size={140} />
            <p className="text-3xl font-semibold">{phase === "failed" ? error : phase === "connecting" ? "Connecting…" : `Waiting for ${ring.from}…`}</p>
          </div>
        ) : (
          remotes.map((p) => <RemoteTile key={p.identity} participant={p} name={nameOf(p, ring)} speaking={p.isSpeaking} single={remotes.length === 1} />)
        )}
      </div>

      {/* Top bar: who + timer */}
      <div
        className="absolute inset-x-0 top-0 flex flex-col items-center bg-gradient-to-b from-black/70 to-transparent pb-8 text-center"
        style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}
      >
        <p className="text-2xl font-semibold">{remotes.length ? remotes.map((p) => nameOf(p, ring)).join(" · ") : ring.from}</p>
        <p className="text-xl tabular-nums text-white/80">{phase === "reconnecting" ? "Reconnecting…" : startedAt ? timer : "Connecting…"}</p>
      </div>

      {/* Own camera */}
      <div
        className="absolute right-3 overflow-hidden rounded-2xl border-2 border-white/30 bg-neutral-800 shadow-lg"
        style={{ top: "calc(max(env(safe-area-inset-top), 12px) + 76px)", width: 108, height: 152 }}
      >
        {localCam && camOn ? (
          <TrackVideo track={localCam} mirrored={front} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <VideoOff className="h-8 w-8 text-white/60" aria-hidden />
          </div>
        )}
      </div>

      {needsTap && (
        <button
          onClick={() => void room.startAudio().then(() => setNeedsTap(!room.canPlaybackAudio))}
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full bg-white px-8 py-5 text-2xl font-bold text-black"
        >
          <Volume2 aria-hidden /> Tap for sound
        </button>
      )}

      {/* Controls */}
      <div
        className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/80 to-transparent pt-10"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <div className="flex w-full max-w-md items-start justify-around px-2">
          <RoundButton label={micOn ? "Mute" : "Unmute"} color={micOn ? "bg-white/25" : "bg-white text-black!"} onClick={toggleMic} size={68} pressed={!micOn}>
            {micOn ? <Mic className="h-8 w-8" aria-hidden /> : <MicOff className="h-8 w-8" aria-hidden />}
          </RoundButton>
          <RoundButton label={camOn ? "Camera" : "Camera off"} color={camOn ? "bg-white/25" : "bg-white text-black!"} onClick={toggleCam} size={68} pressed={!camOn}>
            {camOn ? <Video className="h-8 w-8" aria-hidden /> : <VideoOff className="h-8 w-8" aria-hidden />}
          </RoundButton>
          <RoundButton label="Flip" color="bg-white/25" onClick={flip} size={68}>
            <SwitchCamera className="h-8 w-8" aria-hidden />
          </RoundButton>
          <RoundButton label="End" color="bg-red-600 active:bg-red-500" onClick={() => finish("Call ended")} size={68}>
            <PhoneOff className="h-8 w-8" aria-hidden />
          </RoundButton>
        </div>
      </div>
    </main>
  );
}

function RemoteTile({ participant, name, speaking, single }: { participant: Participant; name: string; speaking: boolean; single: boolean }) {
  const pub = [...participant.videoTrackPublications.values()].find((p) => p.track && !p.isMuted);
  return (
    <div className={`relative overflow-hidden bg-neutral-900 ${speaking && !single ? "ring-4 ring-green-400 ring-inset" : ""}`}>
      {pub?.track ? (
        <TrackVideo track={pub.track} cover />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white/15 text-5xl font-semibold">{name.slice(0, 1)}</span>
        </div>
      )}
      {!single && (
        <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-4 py-1 text-xl font-semibold">{name}</span>
      )}
    </div>
  );
}

function TrackVideo({ track, mirrored, cover = true }: { track: Track; mirrored?: boolean; cover?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`h-full w-full ${cover ? "object-cover" : "object-contain"}`}
      style={mirrored ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}
