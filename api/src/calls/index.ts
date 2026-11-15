/**
 * Which call transport the API uses (CALL_TRANSPORT): web (default; our home-screen apps on LiveKit) or
 * facetime (the old Chert FaceTime path, unchanged). Callers use `callLine` and never branch on the transport
 * except where the flows differ (escalation).
 */
import type { WebCallKind } from "@pillpal/shared";
import { facetime } from "../chert/facetime.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { getPatient, must, mustOne } from "../lib/data.js";
import { displayName } from "../lib/notices.js";
import { SupabaseSignalBus } from "./signal.js";
import { WebCallService, webLiveKit, type CallStore } from "./web.js";

const store: CallStore = {
  async insertCall(row) {
    const patient = await getPatient(row.patient_id);
    const saved = mustOne(
      "insert call",
      await db
        .from("calls")
        .insert({ ...row, started_at: new Date().toISOString(), language: patient.language })
        .select("id")
        .single(),
    );
    return saved.id as string;
  },
  async markEnded(callId) {
    must("mark call ended", await db.from("calls").update({ ended_at: new Date().toISOString() }).eq("id", callId).is("ended_at", null));
  },
  async names(patientId) {
    const p = await getPatient(patientId);
    return { patient: displayName(p, "Your loved one"), caregiver: p.caregiver_name ?? undefined };
  },
};

export const webCalls: WebCallService | null =
  env.CALL_TRANSPORT === "web"
    ? new WebCallService(
        // env.ts requires the three LiveKit vars when CALL_TRANSPORT=web.
        webLiveKit(env.LIVEKIT_URL!, env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, env.AGENT_NAME),
        new SupabaseSignalBus(),
        store,
      )
    : null;

/**
 * After a restart no web call is live (the line lives in memory and LiveKit drops empty rooms), so web-call rows
 * still open are leftovers from a crash or Ctrl+C: close them so dashboards and the scheduler do not see them as live.
 */
export async function closeOrphanedWebCalls(): Promise<number> {
  const r = must(
    "close orphaned web calls",
    await db
      .from("calls")
      .update({ ended_at: new Date().toISOString() })
      .is("ended_at", null)
      .is("chert_call_id", null)
      .like("room_name", "pillpal-%")
      .select("id"),
  ) as { id: string }[];
  return r.length;
}

export type LineInfo = { room_name: string; patient_id: string; kind: string; group: boolean } | null;

export const callLine = {
  transport: env.CALL_TRANSPORT,

  /** Ring the patient now. LineBusyError (409) while another call is active. */
  async dial(patientId: string, kind: "check_in" | "dose"): Promise<{ chert_call_id: string | null; room_name: string; call_id: string }> {
    if (webCalls) return webCalls.dial(patientId, kind as WebCallKind);
    return facetime.dial(patientId, kind);
  },

  active(): LineInfo {
    if (webCalls) {
      const l = webCalls.activeLine();
      return l ? { room_name: l.room_name, patient_id: l.patient_id, kind: l.kind, group: l.inCall.has("caregiver") || l.ringing.has("caregiver") } : null;
    }
    const l = facetime.activeLine();
    return l ? { room_name: l.room_name, patient_id: l.patient_id, kind: l.kind, group: l.group } : null;
  },

  /** POST /calls/ended: the agent is done with this room. */
  releaseRoom(roomName: string): void {
    if (webCalls) webCalls.releaseRoom(roomName);
    else facetime.releaseRoom(roomName);
  },

  /** Final outcome of a web call (scheduler retry rule); undefined for FaceTime. */
  outcome(callId: string) {
    return webCalls?.outcome(callId);
  },
};
