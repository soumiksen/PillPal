/** Pal's function tools. All data goes through the REST API (never the DB); vision via @pillpal/ai. */
import { llm } from "@livekit/agents";
import { checkPill, checkPlate } from "@pillpal/ai";
import type { PatientContext, VisionEvent } from "@pillpal/shared";
import { z } from "zod";
import { api } from "./api.js";
import type { FrameGrabber } from "./frames.js";

export interface CallState {
  patientId: string;
  roomName: string;
  language: string;
  ctx: PatientContext;
  grabber: FrameGrabber;
  visionEvents: VisionEvent[];
  transcript: string[];
  matched: Set<string>; // medication ids verified by camera
  wrongLogged: Set<string>;
  escalated: boolean;
  ended: boolean;
  /** web: our call apps (the caregiver joins this room); facetime: Chert bridge. */
  transport: "web" | "facetime";
  lastFrameB64?: string;
  finish: () => Promise<void>; // end the call (idempotent)
  /** Visual-only hook for the avatar; must never affect tool behaviour. */
  onTool?: (name: string, phase: "start" | "end", result?: unknown) => void;
  /** Resolves once Pal has stopped speaking (or after maxMs). Set by agent.ts. */
  waitUntilIdle?: (maxMs: number) => Promise<void>;
}

const log = (s: CallState, e: Omit<VisionEvent, "at">) => s.visionEvents.push({ at: new Date().toISOString(), ...e });

/** Raise the red alert + caregiver call via the API. Idempotent per call. Used by the escalate_now tool and the keyword trigger. */
export async function escalateNow(
  s: CallState,
  reason: string,
  summary: string,
  requestedBy?: "patient" | "pal",
): Promise<{ ok: boolean; group_call: boolean; already: boolean }> {
  if (s.escalated) return { ok: true, group_call: false, already: true };
  s.escalated = true;
  const r = await api.escalate({ patient_id: s.patientId, room_name: s.roomName, reason, summary, requested_by: requestedBy });
  return { ok: true, group_call: r.group_call_id !== null, already: false };
}

export function buildTools(s: CallState) {
  const medOf = (id?: string) => {
    const meds = s.ctx.meds.filter((m) => m.active !== false);
    return (id && meds.find((m) => m.id === id)) || meds.find((m) => m.id === s.ctx.due_now[0]?.medication_id) || meds[0];
  };
  const medId = z.string().optional().describe("medication_id of the medicine due now (omit if only one is due)");

  const tools = {
    get_context: llm.tool({
      description: "Get the patient's profile, what is due now, medicines and recent check-ins. Call once at the start if unsure.",
      execute: async () => {
        s.ctx = await api.context(s.patientId);
        return {
          patient: s.ctx.patient.preferred_name ?? s.ctx.patient.name,
          language: s.ctx.patient.language,
          due_now: s.ctx.due_now,
          memories: s.ctx.memories.map((m) => m.fact),
          last_checkins: s.ctx.last_checkins.slice(0, 2).map((c) => c.summary),
        };
      },
    }),

    check_meal: llm.tool({
      description: "Look at the food/drink the patient is showing on camera and check it against the medicine's food rule.",
      parameters: z.object({ medication_id: medId }),
      execute: async ({ medication_id }) => {
        const med = medOf(medication_id);
        const g = await s.grabber.grabFrame();
        if (!g.ok) {
          log(s, { kind: "camera_off", what_i_see: "no fresh camera frame during meal check" });
          return { verdict: "camera_off", say: "Ask the patient to turn on the camera or move closer, once." };
        }
        s.lastFrameB64 = g.jpegB64;
        if (!med) return { verdict: "unsure", say: "No medicine is on file; just chat kindly." };
        const r = await checkPlate(g.jpegB64, med);
        log(s, { kind: "plate", verdict: r.verdict, what_i_see: r.what_i_see, medication_id: med.id });
        return r;
      },
    }),

    verify_pill: llm.tool({
      description: "Look at the pill the patient holds up and check it is the medicine that is due.",
      parameters: z.object({ medication_id: medId }),
      execute: async ({ medication_id }) => {
        const med = medOf(medication_id);
        if (!med) return { verdict: "unsure", say: "No medicine is on file; do not confirm any pill." };
        const g = await s.grabber.grabFrame();
        if (!g.ok) {
          log(s, { kind: "camera_off", what_i_see: "no fresh camera frame during pill check", medication_id: med.id });
          return { verdict: "camera_off", say: "Ask once to hold the pill closer to the camera in good light, then ask them to read the label aloud." };
        }
        s.lastFrameB64 = g.jpegB64;
        const r = await checkPill(g.jpegB64, s.ctx.meds, med.id);
        log(s, { kind: "pill", verdict: r.verdict, what_i_see: r.what_i_see, medication_id: med.id });
        if (r.verdict === "match") s.matched.add(med.id);
        if (r.verdict === "mismatch" && !s.wrongLogged.has(med.id)) {
          s.wrongLogged.add(med.id);
          await api
            .dose({ patient_id: s.patientId, medication_id: med.id, status: "wrong_pill_caught", confirmed_via: "facetime_camera", evidence_jpeg_b64: g.jpegB64 })
            .catch(() => undefined);
        }
        return r;
      },
    }),

    log_dose: llm.tool({
      description:
        "Record that the patient took (or skipped) the due medicine. Only after verify_pill returned match, or the patient read the label aloud.",
      parameters: z.object({
        medication_id: medId,
        status: z.enum(["taken", "skipped"]),
        basis: z.enum(["camera", "label_read"]).describe("camera = verify_pill matched; label_read = patient read the label aloud"),
      }),
      execute: async ({ medication_id, status, basis }) => {
        const med = medOf(medication_id);
        if (!med) return { ok: false, say: "No medicine on file." };
        if (status === "taken" && basis === "camera" && !s.matched.has(med.id)) {
          return { ok: false, say: "The pill was not verified on camera yet. Call verify_pill first." };
        }
        await api.dose({
          patient_id: s.patientId,
          medication_id: med.id,
          status,
          confirmed_via: basis === "camera" ? "facetime_camera" : "facetime_label_read",
          evidence_jpeg_b64: basis === "camera" ? s.lastFrameB64 : undefined,
        });
        return { ok: true, say: status === "taken" ? "Dose logged. Praise them warmly." : "Skip noted." };
      },
    }),

    record_symptom: llm.tool({
      description: "Record a symptom the patient mentioned, with their own words.",
      parameters: z.object({
        name: z.string(),
        severity: z.enum(["mild", "moderate", "severe"]),
        quote: z.string().describe("the patient's exact words, original language"),
      }),
      execute: async (a) => {
        await api.symptom({ patient_id: s.patientId, ...a });
        return { ok: true };
      },
    }),

    save_memory: llm.tool({
      description: "Remember a lasting personal fact about the patient (family, hobbies, preferences) for future calls. Not medical advice.",
      parameters: z.object({ fact: z.string().min(1) }),
      execute: async ({ fact }) => {
        await api.memory({ patient_id: s.patientId, fact });
        return { ok: true };
      },
    }),

    escalate_now: llm.tool({
      description:
        "Bring the caregiver into the call: the patient asked for them (any words, any language), or chest pain, a fall, trouble breathing, confusion, dizziness, or a double dose. Never call 911 yourself.",
      parameters: z.object({
        reason: z.string().describe("short factual reason"),
        summary: z.string().describe("1–2 sentence English summary for the caregiver"),
        requested_by: z.enum(["patient", "pal"]).optional().describe('"patient" when the patient asked for their caregiver; "pal" for a red flag'),
      }),
      execute: async ({ reason, summary, requested_by }) => {
        // FaceTime: the backend ends this call right away, so let Pal finish her sentence first.
        if (s.transport === "facetime") await s.waitUntilIdle?.(9000);
        const r = await escalateNow(s, reason, summary, requested_by);
        if (r.already) return { ok: true, say: "Caregiver already notified. Keep reassuring the patient." };
        if (s.transport === "web") {
          return {
            ok: true,
            say: `${s.ctx.patient.caregiver_name ?? "The caregiver"}'s phone is ringing and they will join this call. Stay with the patient and keep them company calmly. Do not end the call.`,
          };
        }
        return {
          ok: true,
          group_call: r.group_call,
          say: `Tell the patient calmly that ${s.ctx.patient.caregiver_name ?? "their caregiver"} has been alerted and is joining. If it is an emergency they should call 911.`,
        };
      },
    }),

    end_call: llm.tool({
      description: "Say goodbye first, then call this to end the call and save the check-in.",
      execute: async () => {
        void s.finish();
        return { ok: true };
      },
    }),
  };

  // Let the avatar react to tool activity without changing what the tools do.
  for (const [name, t] of Object.entries(tools) as [string, { execute?: (...a: unknown[]) => Promise<unknown> }][]) {
    const orig = t.execute;
    if (!orig) continue;
    t.execute = async (...a: unknown[]) => {
      try {
        s.onTool?.(name, "start");
      } catch {
        /* visual only */
      }
      try {
        const r = await orig(...a);
        try {
          s.onTool?.(name, "end", r);
        } catch {
          /* visual only */
        }
        return r;
      } catch (e) {
        try {
          s.onTool?.(name, "end");
        } catch {
          /* visual only */
        }
        throw e;
      }
    };
  }
  return tools;
}
