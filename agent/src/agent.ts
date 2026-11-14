/**
 * Pal — PillPal's FaceTime voice+vision agent (LiveKit Agents for Node, Gemini Live).
 * Run under Chert: `npm run dev -w @pillpal/agent` then `chert dev --agent pillpal-agent`,
 * or dispatched by the API (agent name = AGENT_NAME).
 * Gemini Live handles voice only; video frames go to Claude via @pillpal/ai (tools).
 */
import { AutoSubscribe, cli, defineAgent, ServerOptions, voice, type JobContext } from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
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

export default defineAgent({
  entry: async (ctx: JobContext) => {
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
      inputOptions: { videoEnabled: true },
    });
    await ctx.waitForParticipant();
    session.generateReply({
      instructions: `Greet ${context.patient.preferred_name ?? context.patient.name ?? "the patient"} warmly by name and ask one friendly question.`,
    });
  },
});

// Only start the worker CLI when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME ?? "pillpal-agent" }));
}
