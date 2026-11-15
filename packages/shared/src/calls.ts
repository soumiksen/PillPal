/**
 * Web call signalling (CALL_TRANSPORT=web) over Supabase Realtime *broadcast* — no tables involved.
 *
 * One channel per person and patient:
 *   pillpal:patient:<patient_id>     the patient's home-screen app ("PillPal")
 *   pillpal:caregiver:<patient_id>   the caregiver's home-screen app ("PillPal Care")
 * The API sends `ring` / `cancel`; the apps send `accepted` / `declined` / `ended` on their own channel.
 * LiveKit identities: patient-web-<uuid>, caregiver-web-<uuid>; the agent is AGENT_NAME.
 */
import { z } from "zod";

export const CallRole = z.enum(["patient", "caregiver"]);
export type CallRole = z.infer<typeof CallRole>;

export const WebCallKind = z.enum(["check_in", "dose", "escalation"]);
export type WebCallKind = z.infer<typeof WebCallKind>;

export const callChannel = (role: CallRole, patientId: string) => `pillpal:${role}:${patientId}`;

/** Every LiveKit room we create starts with this; the token route refuses anything else. */
export const ROOM_PREFIX = "pillpal-";

export const identityPrefix = (role: CallRole) => `${role}-web-`;

/** Who is calling: "Pal" (the agent) or the patient's name (e.g. "Rose") when the caregiver is rung in. */
export const RingEvent = z.object({
  call_id: z.string(),
  room_name: z.string(),
  kind: WebCallKind,
  from: z.string(),
});
export type RingEvent = z.infer<typeof RingEvent>;

export const CancelEvent = z.object({ call_id: z.string() });
export type CancelEvent = z.infer<typeof CancelEvent>;

/** accepted / declined / ended, sent by an app. */
export const CallReplyEvent = z.object({ call_id: z.string(), role: CallRole });
export type CallReplyEvent = z.infer<typeof CallReplyEvent>;

export const CallSignal = {
  ring: "ring",
  cancel: "cancel",
  accepted: "accepted",
  declined: "declined",
  ended: "ended",
} as const;
export type CallSignalName = (typeof CallSignal)[keyof typeof CallSignal];

/** POST /demo/call-at: ring the patient at HH:MM America/Chicago (today, or tomorrow if passed). */
export const DemoCallAtBody = z.object({
  patient_id: z.string().uuid(),
  at: z.string().regex(/^\d{1,2}:\d{2}$/),
  kind: z.enum(["check_in", "dose"]).default("check_in"),
});
export type DemoCallAtBody = z.infer<typeof DemoCallAtBody>;

export const DemoCallAtResponse = z.object({ scheduled_for: z.string(), in_seconds: z.number() });
export type DemoCallAtResponse = z.infer<typeof DemoCallAtResponse>;

/** POST /call-token (web route): body and response. */
export const CallTokenBody = z.object({
  role: CallRole,
  room_name: z.string().min(1).max(128),
  code: z.string().min(1).max(200),
});
export type CallTokenBody = z.infer<typeof CallTokenBody>;

export const CallTokenResponse = z.object({ url: z.string(), token: z.string(), identity: z.string() });
export type CallTokenResponse = z.infer<typeof CallTokenResponse>;
