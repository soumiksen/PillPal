/**
 * Pal — PillPal's FaceTime voice+vision agent (LiveKit Agents for Node, Gemini Live).
 * Run under Chert: `npm run dev -w @pillpal/agent` then `chert dev --agent pillpal-agent`,
 * or dispatched by the API (agent name = AGENT_NAME).
 * Gemini Live handles voice only; video frames go to Claude via @pillpal/ai (tools).
 */
import { AutoSubscribe, cli, defineAgent, ServerOptions, voice, type JobContext } from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import { RoomEvent, TrackKind, type RemoteParticipant, type Room } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";
import { FrameGrabber } from "./frames.js";
import { buildInstructions } from "./prompt.js";
import { buildTools, type CallState } from "./tools.js";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025";

function parseMeta(raw: string | undefined): { patient_id?: string; kind?: string } {
  try {
    return raw ? (JSON.parse(raw) as { patient_id?: string; kind?: string }) : {};
  } catch {
    return {};
  }
}

const bridgeReady = (metadata: string | undefined): boolean => {
  try {
    return Boolean(metadata && (JSON.parse(metadata) as { chert_bridge_ready?: unknown }).chert_bridge_ready);
  } catch {
    return false;
  }
};

/**
 * Under `chert dev`, the room metadata becomes {"chert_bridge_ready":true,...} once FaceTime media is live.
 * Chert's rule: greet once on that signal (within 10 s, or the call ends), never merely because the caller joined.
 * Resolves true on the signal, false after timeoutMs.
 */
function waitForBridgeReady(room: Room, timeoutMs: number): Promise<boolean> {
  if (bridgeReady(room.metadata)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      room.off(RoomEvent.RoomMetadataChanged, onMeta);
      resolve(ok);
    };
    const onMeta = (m: string) => {
      if (bridgeReady(m)) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    room.on(RoomEvent.RoomMetadataChanged, onMeta);
  });
}

/** Resolve once the participant's audio track is subscribed, or after timeoutMs (never blocks the call). */
function waitForCallerAudio(room: Room, p: RemoteParticipant, timeoutMs: number): Promise<void> {
  const hasAudio = () =>
    [...p.trackPublications.values()].some((t) => t.kind === TrackKind.KIND_AUDIO && t.subscribed);
  if (hasAudio()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      room.off(RoomEvent.TrackSubscribed, onSub);
      resolve();
    };
    const onSub = (_t: unknown, _pub: unknown, who: RemoteParticipant) => {
      if (who.identity === p.identity && hasAudio()) done();
    };
    const timer = setTimeout(done, timeoutMs);
    room.on(RoomEvent.TrackSubscribed, onSub);
  });
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const startedAt = Date.now();
    const meta = parseMeta(ctx.job.metadata);
    const patientId = meta.patient_id ?? process.env.PATIENT_ID;
    if (!patientId) throw new Error("No patient_id in job metadata and PATIENT_ID is unset");

    // Register frame handlers before connecting, and subscribe to video too (starter is audio-only).
    const grabber = new FrameGrabber();
    grabber.attach(ctx.room);
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    const context = await api.context(patientId);
    const roomName = ctx.room.name ?? "unknown";
    const kind = (["check_in", "reminder", "group", "inbound"] as const).find((k) => k === meta.kind) ?? "inbound";
    await api.callStarted({ patient_id: patientId, room_name: roomName, kind }).catch(() => undefined);

    const state: CallState = {
      patientId,
      roomName,
      language: context.patient.language ?? "en",
      ctx: context,
      grabber,
      visionEvents: [],
      transcript: [],
      matched: new Set(),
      wrongLogged: new Set(),
      escalated: false,
      ended: false,
      finish: async () => undefined,
    };

    const agent = new voice.Agent({
      instructions: buildInstructions(context),
      tools: buildTools(state),
    });
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel({
        model: GEMINI_LIVE_MODEL,
        voice: "Kore",
        temperature: 0.6,
        instructions: buildInstructions(context),
        // Thinking adds seconds before every spoken reply; Pal needs speed, not deliberation.
        thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0), includeThoughts: false },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      }),
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.type !== "message") return;
      const text = ev.item.textContent;
      if (text) state.transcript.push(`${ev.item.role === "user" ? "Patient" : "Pal"}: ${text}`);
    });

    // Idempotent: save transcript + vision events, run extraction (API → ai.extractCheckIn), close.
    state.finish = async () => {
      if (state.ended) return;
      state.ended = true;
      try {
        await api.callEnded({
          room_name: roomName,
          transcript: state.transcript.join("\n"),
          language: state.language,
          vision_events: state.visionEvents,
        });
      } catch {
        /* best effort — never log patient data */
      }
      // Let the goodbye finish playing, then hang up.
      setTimeout(() => ctx.shutdown("call ended"), 4000);
    };
    ctx.addShutdownCallback(async () => {
      await state.finish(); // caller hung up without end_call
    });

    // Wait for the caller (Chert bridge participant) before greeting.
    await session.start({
      agent,
      room: ctx.room,
      // Video frames go to Claude via the FrameGrabber, not to Gemini Live (less load, fewer session errors).
      inputOptions: { videoEnabled: false },
    });
    const caller = await ctx.waitForParticipant();
    // Under Chert, greet on the bridge_ready room signal (media is live). Anywhere else (local test page),
    // or if the signal never comes, fall back to: caller audio subscribed + a short beat.
    const underChert = caller.identity.startsWith("chert-bridge-");
    let how = "fallback";
    if (underChert && (await waitForBridgeReady(ctx.room, 9000))) {
      how = "bridge_ready";
    } else {
      await waitForCallerAudio(ctx.room, caller, 8000);
      await new Promise((r) => setTimeout(r, Number(process.env.GREETING_DELAY_MS ?? 2500)));
    }
    console.log(`[pal] greeting via ${how} (+${Date.now() - startedAt} ms since job start)`);
    session.generateReply({
      instructions: `Greet ${context.patient.preferred_name ?? context.patient.name ?? "the patient"} warmly by name and ask one friendly question.`,
    });
  },
});

// Only start the worker CLI when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME ?? "pillpal-agent" }));
}
