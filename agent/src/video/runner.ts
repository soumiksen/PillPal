/**
 * PAL_MODE=script: Pal plays the Devpost video timeline (agent/video/script.json). No Gemini, no LLM, no listening.
 * The timeline starts the moment the patient's phone joins the room (= Accept). Each line is a pre-recorded WAV
 * played through Pal's own audio track; Helen's mouth follows its volume as in live mode. Expressions and actions
 * (log_dose / escalate / end_call) fire at their planned times; "caregiver_join" steps count from the caregiver's
 * phone joining. One log line per step: planned vs actual time. Logs step ids only (never the spoken text).
 */
import { AutoSubscribe, type JobContext } from "@livekit/agents";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  type RemoteParticipant,
  type Room,
} from "@livekit/rtc-node";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MouthLevel } from "../avatar/audio-tap.js";
import { startAvatar, type Avatar } from "../avatar/publish.js";
import { isSceneKind, lineHash, loadScript, parseWav, VOICES_DIR, type Pcm, type Step } from "./script.js";

const isPatientWeb = (id: string) => id.startsWith("patient-web-");
const isCaregiverWeb = (id: string) => id.startsWith("caregiver-web-");
const ANSWER_TIMEOUT_MS = 75_000;

const apiBase = () => (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-code": process.env.DEMO_ACCESS_CODE ?? "" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}`);
  return res.json();
}

const fmt = (ms: number) => `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(3)}s`;

/** Plays PCM on one published audio track, one line at a time (an overlapping line waits for the previous one). */
class Speaker {
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(
    private readonly source: AudioSource,
    private readonly sampleRate: number,
    private readonly level: MouthLevel,
    private readonly avatar: Avatar | null,
  ) {}

  /** Queue a line; onStart fires when its first sample is handed to LiveKit. */
  say(pcm: Pcm, onStart: () => void): Promise<void> {
    const run = async () => {
      if (this.stopped) return;
      const mono = toMono(pcm);
      const samples = pcm.sampleRate === this.sampleRate ? mono : resample(mono, pcm.sampleRate, this.sampleRate);
      const per = this.sampleRate / 100; // 10 ms
      this.avatar?.controller.setState("speaking");
      onStart();
      for (let i = 0; i < samples.length && !this.stopped; i += per) {
        const chunk = new Int16Array(per);
        chunk.set(samples.subarray(i, Math.min(samples.length, i + per)));
        const frame = new AudioFrame(chunk, this.sampleRate, 1, per);
        try {
          this.level.push(frame);
        } catch {
          /* visual only */
        }
        await this.source.captureFrame(frame);
      }
      await this.source.waitForPlayout().catch(() => undefined);
      this.avatar?.controller.setState("idle");
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  stop() {
    this.stopped = true;
    this.source.clearQueue();
    this.level.clear();
  }
}

function toMono(p: Pcm): Int16Array {
  if (p.channels === 1) return p.samples;
  const out = new Int16Array(Math.floor(p.samples.length / p.channels));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let c = 0; c < p.channels; c++) s += p.samples[i * p.channels + c]!;
    out[i] = s / p.channels;
  }
  return out;
}

function resample(x: Int16Array, from: number, to: number): Int16Array {
  const out = new Int16Array(Math.floor((x.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const t = (i * from) / to;
    const a = Math.floor(t);
    const b = Math.min(x.length - 1, a + 1);
    out[i] = x[a]! + (x[b]! - x[a]!) * (t - a);
  }
  return out;
}

function waitFor(room: Room, pick: (p: RemoteParticipant) => boolean, timeoutMs: number): Promise<RemoteParticipant | null> {
  const have = [...room.remoteParticipants.values()].find(pick);
  if (have) return Promise.resolve(have);
  return new Promise((resolve) => {
    const done = (p: RemoteParticipant | null) => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve(p);
    };
    const onJoin = (p: RemoteParticipant) => pick(p) && done(p);
    const timer = setTimeout(() => done(null), timeoutMs);
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
}

export async function runScriptedCall(ctx: JobContext, kind: string | undefined, patientId: string): Promise<void> {
  const tag = `[script]`;
  if (!isSceneKind(kind)) {
    console.log(`${tag} PAL_MODE=script but dispatch kind "${kind ?? "none"}" is not a video scene; leaving`);
    ctx.shutdown("no scene");
    return;
  }
  const script = loadScript();
  const scene = script.scenes[kind];
  if (!scene) {
    console.log(`${tag} scene ${kind} is missing from script.json; leaving`);
    ctx.shutdown("no scene");
    return;
  }

  await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_NONE);
  const room = ctx.room;
  const roomName = room.name ?? "unknown";
  const avatar = await startAvatar(room);

  const SAMPLE_RATE = 24_000;
  const source = new AudioSource(SAMPLE_RATE, 1);
  const track = LocalAudioTrack.createAudioTrack("pal-voice", source);
  await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  const level = new MouthLevel();
  avatar?.controller.setMouthLevel(() => level.read());
  avatar?.controller.setState("idle");
  const speaker = new Speaker(source, SAMPLE_RATE, level, avatar);

  // Load every voice up front so playback never waits on disk.
  const manifest = (() => {
    try {
      return JSON.parse(readFileSync(join(VOICES_DIR, "manifest.json"), "utf8")) as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  })();
  const voices = new Map<string, Pcm>();
  for (const st of scene.steps) {
    if (!st.say || !st.id) continue;
    try {
      voices.set(st.id, parseWav(readFileSync(join(VOICES_DIR, `${st.id}.wav`))));
      if (manifest[st.id] !== lineHash(script, st.say)) console.log(`${tag} voice ${st.id} is out of date (text changed); run npm run video:voices`);
    } catch {
      console.log(`${tag} voice ${st.id}.wav missing or unreadable; that line will be skipped`);
    }
  }

  let ended = false;
  const timers: NodeJS.Timeout[] = [];
  const finish = (why: string) => {
    if (ended) return;
    ended = true;
    for (const t of timers) clearTimeout(t);
    speaker.stop();
    console.log(`${tag} ${kind} over (${why})`);
    setTimeout(() => ctx.shutdown(why), 300);
  };
  ctx.addShutdownCallback(async () => {
    ended = true;
    for (const t of timers) clearTimeout(t);
    await avatar?.stop().catch(() => undefined);
    await source.close().catch(() => undefined);
  });
  room.on(RoomEvent.Disconnected, () => finish("room closed"));

  const hangUp = async (why: string) => {
    if (ended) return;
    await post("/video/end", { room_name: roomName }).catch((e: Error) => console.log(`${tag} end_call failed: ${e.message}`));
    finish(why);
  };

  const run = (st: Step, i: number, anchor: number, anchorName: string) => {
    const planned = st.at * 1000;
    const fire = () => {
      if (ended) return;
      const actual = performance.now() - anchor;
      const what = [st.say ? `say ${st.id}` : "", st.expr ? `expr ${st.expr}` : "", st.nod ? "nod" : "", st.action ? `action ${st.action}` : ""]
        .filter(Boolean)
        .join(", ");
      const c = avatar?.controller;
      if (st.expr) c?.show(st.expr);
      if (st.nod) c?.nod();
      if (st.then) {
        const next = st.then.expr;
        timers.push(setTimeout(() => !ended && c?.show(next), st.then.after * 1000));
      }
      if (st.say) {
        const pcm = st.id ? voices.get(st.id) : undefined;
        if (!pcm) console.log(`${tag} #${i} ${what}: voice missing, skipped (planned ${anchorName}${fmt(planned)})`);
        else {
          void speaker.say(pcm, () => {
            const started = performance.now() - anchor;
            console.log(
              `${tag} #${i} ${what} · planned ${anchorName}${fmt(planned)} actual ${anchorName}${fmt(started)} (Δ ${Math.round(started - planned)} ms)`,
            );
          });
        }
      } else {
        console.log(`${tag} #${i} ${what} · planned ${anchorName}${fmt(planned)} actual ${anchorName}${fmt(actual)} (Δ ${Math.round(actual - planned)} ms)`);
      }
      if (st.action === "log_dose") {
        void post("/video/dose", { patient_id: patientId, drug: st.args?.drug ?? "Magnesium", confirmed_via: st.args?.confirmed_via ?? "facetime" })
          .then(() => console.log(`${tag} #${i} log_dose done (+${Math.round(performance.now() - anchor - planned)} ms after plan)`))
          .catch((e: Error) => console.log(`${tag} #${i} log_dose failed: ${e.message}`));
      } else if (st.action === "escalate") {
        const reason = st.args?.reason ?? "The patient asked for their caregiver";
        void post("/escalate", {
          patient_id: patientId,
          room_name: roomName,
          reason,
          summary: st.args?.summary ?? reason,
          requested_by: st.args?.requested_by ?? "patient",
        })
          .then(() => console.log(`${tag} #${i} escalate done (+${Math.round(performance.now() - anchor - planned)} ms after plan)`))
          .catch((e: Error) => console.log(`${tag} #${i} escalate failed: ${e.message}`));
      } else if (st.action === "end_call") {
        void hangUp("script end_call");
      }
    };
    timers.push(setTimeout(fire, Math.max(0, anchor + planned - performance.now())));
  };

  const steps = scene.steps.map((st, i) => ({ st, i: i + 1 }));
  const onPatient = steps.filter((s) => s.st.on === "patient_join");
  const onCaregiver = steps.filter((s) => s.st.on === "caregiver_join");

  // Any phone hanging up ends the call for everyone (the API deletes the room).
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    if (isPatientWeb(p.identity) || isCaregiverWeb(p.identity)) {
      console.log(`${tag} ${isPatientWeb(p.identity) ? "patient" : "caregiver"} hung up`);
      void hangUp("hung up");
    }
  });

  let caregiverAnchored = false;
  const anchorCaregiver = (p: RemoteParticipant) => {
    if (caregiverAnchored || !isCaregiverWeb(p.identity) || ended) return;
    caregiverAnchored = true;
    const t1 = performance.now();
    console.log(`${tag} caregiver joined → ${onCaregiver.length} caregiver step(s) scheduled`);
    for (const { st, i } of onCaregiver) run(st, i, t1, "cg");
  };
  room.on(RoomEvent.ParticipantConnected, anchorCaregiver);

  console.log(`${tag} ${kind}: ${scene.steps.length} steps, ${voices.size} voice(s) loaded; waiting for the patient to accept`);
  const patient = await waitFor(room, (p) => isPatientWeb(p.identity), ANSWER_TIMEOUT_MS);
  if (!patient) {
    console.log(`${tag} patient did not answer; leaving`);
    finish("no answer");
    return;
  }
  const t0 = performance.now();
  console.log(`${tag} patient joined → timeline started (t0)`);
  for (const { st, i } of onPatient) run(st, i, t0, "t0");
  for (const p of room.remoteParticipants.values()) anchorCaregiver(p);
}
