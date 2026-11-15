/**
 * Pal — PillPal's video-call voice+vision agent (LiveKit Agents for Node, Gemini Live).
 * Web calls (dispatch metadata transport:"web"): patient-web-* / caregiver-web-* participants from our phone apps.
 * FaceTime calls: the chert-bridge-* participant.
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
import { installMouthTap, MouthLevel } from "./avatar/audio-tap.js";
import { startAvatar, type Avatar } from "./avatar/publish.js";
import { buildInstructions } from "./prompt.js";
import { MixedAudioInput } from "./mixer.js";
import { buildTools, escalateNow, type CallState } from "./tools.js";

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL ?? "gemini-2.5-flash-native-audio-preview-12-2025";

type JobMeta = { patient_id?: string; kind?: string; outbound?: boolean; transport?: string };

function parseMeta(raw: string | undefined): JobMeta {
  try {
    return raw ? (JSON.parse(raw) as JobMeta) : {};
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

/** Words that mean "get my caregiver now". Safety-biased: a false alarm is better than a miss. */
const EMERGENCY_WORDS = [
  /\bemergenc(y|ies)\b/i,
  /\bcall (my |the )?care[ -]?(giver|taker)\b/i,
  /\bemergencia\b/i,
  /\bllam\w*\s+(a\s+)?(mi|la)\s+cuidador/i,
  /\b(call|get|need|want)\b.{0,15}\bmy (daughter|son|caregiver)\b/i,
  /\bllam\w*\s+(a\s+)?mi\s+(hija|hijo)\b/i,
];

const isPatientWeb = (identity: string) => identity.startsWith("patient-web-");
const isCaregiverWeb = (identity: string) => identity.startsWith("caregiver-web-");

/** First participant matching `pick` (already in the room or joining within timeoutMs), else null. */
function waitForParticipantWhere(room: Room, pick: (p: RemoteParticipant) => boolean, timeoutMs: number): Promise<RemoteParticipant | null> {
  const have = [...room.remoteParticipants.values()].find(pick);
  if (have) return Promise.resolve(have);
  return new Promise((resolve) => {
    const done = (p: RemoteParticipant | null) => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve(p);
    };
    const onJoin = (p: RemoteParticipant) => {
      if (pick(p)) done(p);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
}

/** Resolve once the participant's audio track is subscribed, or after timeoutMs (never blocks the call). */
function waitForCallerAudio(room: Room, p: RemoteParticipant, timeoutMs: number): Promise<boolean> {
  const hasAudio = () =>
    [...p.trackPublications.values()].some((t) => t.kind === TrackKind.KIND_AUDIO && t.subscribed);
  if (hasAudio()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok = true) => {
      clearTimeout(timer);
      room.off(RoomEvent.TrackSubscribed, onSub);
      resolve(ok);
    };
    const onSub = (_t: unknown, _pub: unknown, who: RemoteParticipant) => {
      if (who.identity === p.identity && hasAudio()) done();
    };
    const timer = setTimeout(() => done(false), timeoutMs);
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
    let avatar: Avatar | null = null;
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    // Publish Helen's video first: Chert wants the agent's video in the room before an outbound call is dialed.
    avatar = await startAvatar(ctx.room);

    const context = await api.context(patientId);
    const roomName = ctx.room.name ?? "unknown";
    const web = meta.transport === "web";
    // Web calls keep their own kinds (check_in, dose, escalation); FaceTime keeps the old mapping.
    const kind = web
      ? ((["check_in", "dose", "escalation"] as const).find((k) => k === meta.kind) ?? "check_in")
      : ((["check_in", "reminder", "group", "inbound"] as const).find((k) => k === meta.kind) ?? (meta.kind === "escalation" ? "group" : "inbound"));
    const emergencyGroup = meta.kind === "escalation" || meta.kind === "group";
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
      transport: web ? "web" : "facetime",
      finish: async () => undefined,
      onTool: (name, phase, result) => {
        const c = avatar?.controller;
        if (!c) return;
        if (phase === "start") {
          if (name === "check_meal" || name === "verify_pill") c.show("looking");
          else if (name === "escalate_now") c.show("serious");
          return;
        }
        const verdict = (result as { verdict?: string } | undefined)?.verdict;
        if (name === "check_meal" || name === "verify_pill") {
          if (verdict === "match" || verdict === "ok") c.show("pleased", 3500);
          else if (verdict === "mismatch" || verdict === "not_allowed" || verdict === "unsure" || verdict === "camera_off") c.show("concerned", 4000);
          else c.clear();
        } else if (name === "log_dose") c.show("pleased", 3000);
        else if (name === "end_call") c.show("goodbye");
        // escalate_now stays serious-calm until the call ends
      },
    };

    const agent = new voice.Agent({
      instructions: buildInstructions(context, { extraCaregiver: emergencyGroup, transport: web ? "web" : "facetime" }),
      tools: buildTools(state),
    });
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel({
        model: GEMINI_LIVE_MODEL,
        voice: "Kore",
        temperature: 0.6,
        instructions: buildInstructions(context, { extraCaregiver: emergencyGroup, transport: web ? "web" : "facetime" }),
        // Thinking adds seconds before every spoken reply; Pal needs speed, not deliberation.
        thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET ?? 0), includeThoughts: false },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      }),
    });

    let groupAudio = false;
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      if (ev.item.type !== "message") return;
      const text = ev.item.textContent;
      if (text) state.transcript.push(`${ev.item.role === "user" ? (groupAudio ? "Patient/Caregiver" : "Patient") : "Pal"}: ${text}`);
    });


    // Pal's own state, so a tool can wait until she has finished speaking.
    let agentState = "initializing";
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => {
      agentState = ev.newState;
    });
    state.waitUntilIdle = async (maxMs) => {
      const end = Date.now() + maxMs;
      while (Date.now() < end && agentState === "speaking") await new Promise((r) => setTimeout(r, 150));
      await new Promise((r) => setTimeout(r, 900)); // let the last audio finish playing out
    };

    // Safety net for "emergency" / "call my caregiver": the prompt makes Pal say the hold sentence and call
    // escalate_now. If the model does not do that within 10 s, escalate from code (no speech injection:
    // generateReply with instructions mid-call restarts Gemini Live and kills the session). Never logs speech.
    let netArmed = false;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal || netArmed || state.escalated || state.ended) return;
      const cg = context.patient.caregiver_name?.trim();
      const named =
        cg && cg.length > 1 ? new RegExp(`\\b(call|need|want|get)\\s+${cg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
      if (!EMERGENCY_WORDS.some((re) => re.test(ev.transcript)) && !(named && named.test(ev.transcript))) return;
      netArmed = true;
      avatar?.controller.show("serious");
      setTimeout(() => {
        if (state.escalated || state.ended) return;
        void (async () => {
          await state.waitUntilIdle?.(9000);
          await escalateNow(
            state,
            "Patient asked for their caregiver or said it is an emergency",
            "During the call the patient said 'emergency' or asked Pal to call their caregiver. Pal is bringing the caregiver in.",
            "patient",
          ).catch(() => undefined);
        })();
      }, 10_000);
    });

    // Idempotent: save transcript + vision events, run extraction (API → ai.extractCheckIn), close.
    let humanJoined = false;
    state.finish = async () => {
      if (state.ended) return;
      state.ended = true;
      // Unanswered web call: nobody talked, so there is nothing to save (the API closes the row itself).
      if (web && !humanJoined) {
        setTimeout(() => ctx.shutdown("no answer"), 500);
        return;
      }
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
      await avatar?.stop().catch(() => undefined);
      await state.finish(); // caller hung up without end_call
    });

    // Wait for the caller (Chert bridge participant) before greeting.
    await session.start({
      agent,
      room: ctx.room,
      // Video frames go to Claude via the FrameGrabber, not to Gemini Live (less load, fewer session errors).
      // Web calls: we decide when the call is over (the patient leaving), not the first linked participant.
      inputOptions: web ? { videoEnabled: false, closeOnDisconnect: false } : { videoEnabled: false },
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) => avatar?.controller.setState(ev.newState));
    // Helen's mouth follows Pal's real voice: a read-only tap at the head of the audio output chain.
    if (avatar) {
      try {
        const level = new MouthLevel();
        if (installMouthTap(session, level)) avatar.controller.setMouthLevel(() => level.read());
      } catch {
        /* procedural mouth stays in charge */
      }
    }
    /**
     * Web calls (our phone apps): greet when the patient joins (no bridge_ready signal), bring the caregiver in when
     * her phone joins (Pal greets her and summarises), mix both voices for Pal, and leave when the patient leaves.
     */
    async function runWebCall(): Promise<void> {
      const room = ctx.room;
      const pname = context.patient.preferred_name ?? context.patient.name ?? "the patient";
      const cname = context.patient.caregiver_name ?? "your caregiver";
      let mixer: MixedAudioInput | null = null;
      let greeted = false;
      let caregiverGreeted = false;
      let caregiverWaiting: RemoteParticipant | null = null;

      const micOf = (p: RemoteParticipant) =>
        [...p.trackPublications.values()].find((t) => t.kind === TrackKind.KIND_AUDIO && t.subscribed && t.track);
      const humans = () => [...room.remoteParticipants.values()].filter((p) => isPatientWeb(p.identity) || isCaregiverWeb(p.identity));

      // Two people in the room → Pal hears both through one mixed input (the default input hears only one).
      const syncAudio = () => {
        const people = humans();
        if (!mixer && people.length < 2) return;
        if (!mixer) {
          mixer = new MixedAudioInput();
          session.input.audio = mixer;
          groupAudio = true;
          console.log("[pal] group call: mixing both voices");
        }
        for (const p of people) {
          const mic = micOf(p);
          if (mic?.track && mic.sid) mixer.addTrack(p.identity, mic.track, mic.sid);
        }
      };
      room.on(RoomEvent.TrackSubscribed, () => syncAudio());
      room.on(RoomEvent.ParticipantConnected, (p) => {
        if (isPatientWeb(p.identity) || isCaregiverWeb(p.identity)) humanJoined = true;
        syncAudio();
        if (isCaregiverWeb(p.identity)) void greetCaregiver(p);
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        mixer?.removeTrack(p.identity);
        if (isPatientWeb(p.identity) && !state.ended) {
          console.log("[pal] patient left; ending the call");
          void state.finish();
        } else if (humans().length === 0 && !state.ended) {
          void state.finish();
        }
      });

      async function greetCaregiver(p: RemoteParticipant) {
        if (caregiverGreeted || state.ended) return;
        if (!greeted) {
          caregiverWaiting = p; // the first greeting is still pending; handled right after it
          return;
        }
        caregiverGreeted = true;
        await waitForCallerAudio(room, p, 6000);
        await state.waitUntilIdle?.(8000);
        if (state.ended) return;
        console.log("[pal] caregiver joined; greeting and summarising");
        avatar?.controller.hello();
        try {
          session.generateReply({
            instructions: `${cname} has just joined the call. Greet ${cname} by name, then give ${cname} a two-sentence summary of this call so far (what ${pname} said and why ${cname} was called). Then continue, addressing each person by name.`,
          });
        } catch {
          /* Pal still hears her and the prompt covers it */
        }
      }

      // Who answers first? Normally the patient; an escalation call rings both phones.
      const first = await waitForParticipantWhere(
        room,
        (p) => isPatientWeb(p.identity) || (emergencyGroup && isCaregiverWeb(p.identity)),
        75_000,
      );
      if (!first) {
        console.log("[pal] web call was not answered; not greeting");
        return;
      }
      humanJoined = true;
      syncAudio();
      await waitForCallerAudio(room, first, 8000);
      await new Promise((r) => setTimeout(r, Math.min(delay, 1500)));
      if (state.ended) return;
      greeted = true;
      if (isCaregiverWeb(first.identity)) caregiverGreeted = true;
      console.log(`[pal] greeting via web_join (+${Date.now() - startedAt} ms since job start)`);
      avatar?.controller.hello();
      session.generateReply({
        instructions: emergencyGroup
          ? `Calmly greet ${isCaregiverWeb(first.identity) ? cname : pname} by name, say you are checking in because ${pname} reported a problem, and ${isCaregiverWeb(first.identity) ? `that ${pname} is being called too` : `ask how they feel right now`}.`
          : `Greet ${pname} warmly by name and ask one friendly question.`,
      });
      const waiting = caregiverWaiting as RemoteParticipant | null;
      if (waiting && !caregiverGreeted && room.remoteParticipants.has(waiting.identity)) void greetCaregiver(waiting);
    }

    const delay = Number(process.env.GREETING_DELAY_MS ?? 2500);
    if (web) {
      await runWebCall();
      return;
    }

    const caller = await ctx.waitForParticipant();
    // A call placed outside POST /dial (scripts/outbound-call.ts) announces its Chert call id in the room metadata.
    // Tell the backend as soon as it appears (not only at greeting time: the greeting can fire first, via caller audio)
    // so escalation can end this 1:1 call before it starts the caregiver group call. Idempotent per call id.
    let adoptedCall = "";
    const adoptCall = (raw: string | undefined) => {
      try {
        const id = (JSON.parse(raw || "{}") as { chert_call?: string }).chert_call;
        if (!id || id === adoptedCall) return;
        adoptedCall = id;
        void api.callStarted({ patient_id: patientId, room_name: roomName, kind, chert_call_id: id }).catch(() => {
          adoptedCall = ""; // try again on the next metadata change
        });
      } catch {
        /* not JSON */
      }
    };
    adoptCall(ctx.room.metadata);
    ctx.room.on(RoomEvent.RoomMetadataChanged, adoptCall);

    // Greeting rules (Chert): never greet merely because the bridge joined.
    //  - `chert dev` inbound: greet on the chert_bridge_ready room signal (media live).
    //  - Calls placed by the backend (check_in / reminder / escalation) or our outbound script: the bridge joins
    //    while the phone is still ringing, so wait up to 90 s for either the ready signal or the caller's
    //    audio track, and stay quiet if neither comes (nobody answered).
    //  - Local test page: caller audio + a short beat.
    const outboundish = meta.outbound === true || (meta.kind !== undefined && meta.kind !== "inbound");
    const underChert = caller.identity.startsWith("chert-bridge-");
    let how = "fallback";
    if (outboundish) {
      const won = await Promise.race([
        waitForBridgeReady(ctx.room, 90_000).then((ok) => (ok ? "bridge_ready" : "none")),
        waitForCallerAudio(ctx.room, caller, 90_000).then(async (ok) => {
          if (!ok) return "none";
          await new Promise((r) => setTimeout(r, delay));
          return "caller_audio";
        }),
      ]);
      if (won === "none") {
        console.log("[pal] outbound call never became ready; not greeting");
        return;
      }
      how = won;
    } else if (underChert && (await waitForBridgeReady(ctx.room, 9000))) {
      how = "bridge_ready";
    } else {
      await waitForCallerAudio(ctx.room, caller, 8000);
      await new Promise((r) => setTimeout(r, delay));
    }
    console.log(`[pal] greeting via ${how} (+${Date.now() - startedAt} ms since job start)`);
    avatar?.controller.hello();
    const pname = context.patient.preferred_name ?? context.patient.name ?? "the patient";
    session.generateReply({
      instructions: emergencyGroup
        ? `Calmly greet ${pname} and ${context.patient.caregiver_name ?? "their caregiver"} by name, say you are checking in because ${pname} reported a problem, and ask ${pname} how they feel right now.`
        : `Greet ${pname} warmly by name and ask one friendly question.`,
    });
  },
});

// Only start the worker CLI when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME ?? "pillpal-agent" }));
}
