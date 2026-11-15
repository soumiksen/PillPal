/**
 * Shared Supabase queries used by routes and Chert event handlers.
 * Errors carry the step + Supabase message only — never row data.
 */
import { HTTPException } from "hono/http-exception";
import type {
  CheckInRow,
  DoseEventRow,
  DoseStatus,
  DueDose,
  MedicationRow,
  MemoryRow,
  PatientRow,
} from "@pillpal/shared";
import { db } from "../db.js";
import { slotsAround } from "./time.js";

type PgError = { code?: string; message: string };

export class DbError extends Error {
  constructor(step: string, err: PgError) {
    super(`${step}: ${err.code ?? ""} ${err.message}`.trim());
    this.name = "DbError";
  }
}

/** Unwrap a Supabase result, throwing a DbError (→ 500) on failure. */
export function must<T>(step: string, r: { data: T | null; error: PgError | null }): T {
  if (r.error) throw new DbError(step, r.error);
  return r.data as T;
}

/** Like must(), for `.single()` results: the row is guaranteed. */
export function mustOne<T = { id: string }>(step: string, r: { data: unknown; error: PgError | null }): T {
  const row = must(step, r);
  if (row == null) throw new DbError(step, { message: "no row returned" });
  return row as T;
}

export const notFound = (what: string) => new HTTPException(404, { message: `${what}_not_found` });

export async function getPatient(id: string): Promise<PatientRow> {
  const row = must("get patient", await db.from("patients").select("*").eq("id", id).maybeSingle());
  if (!row) throw notFound("patient");
  return row as PatientRow;
}

export async function getMedication(id: string): Promise<MedicationRow> {
  const row = must("get medication", await db.from("medications").select("*").eq("id", id).maybeSingle());
  if (!row) throw notFound("medication");
  return row as MedicationRow;
}

export async function activeMeds(patientId: string): Promise<MedicationRow[]> {
  return must(
    "list medications",
    await db
      .from("medications")
      .select("*")
      .eq("patient_id", patientId)
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ) as MedicationRow[];
}

const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);

/** Match an inbound iMessage handle (E.164 or Apple ID email) to a patient. */
export async function findPatientByHandle(handle: string): Promise<PatientRow | undefined> {
  const rows = must("lookup patients", await db.from("patients").select("*")) as PatientRow[];
  const h = handle.trim().toLowerCase();
  const d = last10(h);
  return rows.find((p) => {
    const ph = p.phone?.trim().toLowerCase();
    if (!ph) return false;
    if (ph === h) return true;
    return d.length === 10 && last10(ph) === d;
  });
}

// ---------------------------------------------------------------- due now

export const DUE_WINDOW_MS = 60 * 60_000;
/** How far back an unresolved (pending) dose_event still counts as due. */
const PENDING_LOOKBACK_MS = 12 * 60 * 60_000;

/**
 * Doses due now: every med time within ±60 min of now (America/Chicago), plus any pending
 * dose_events from the last 12 h. Slots that already have a non-pending event (taken, skipped, …)
 * are left out; slots with a pending event carry its dose_event_id.
 */
export async function dueNow(patientId: string, meds: MedicationRow[], now = new Date()): Promise<DueDose[]> {
  const from = new Date(now.getTime() - PENDING_LOOKBACK_MS).toISOString();
  const to = new Date(now.getTime() + DUE_WINDOW_MS).toISOString();
  const events = must(
    "list dose events",
    await db
      .from("dose_events")
      .select("*")
      .eq("patient_id", patientId)
      .gte("scheduled_at", from)
      .lte("scheduled_at", to),
  ) as DoseEventRow[];

  const byId = new Map(meds.map((m) => [m.id, m]));
  const key = (medId: string | null, at: string | null) => `${medId}|${at ? new Date(at).getTime() : ""}`;
  const eventAt = new Map(events.map((e) => [key(e.medication_id, e.scheduled_at), e]));
  const out = new Map<string, DueDose>();

  const push = (m: MedicationRow, at: Date, ev?: DoseEventRow) =>
    out.set(key(m.id, at.toISOString()), {
      ...(ev ? { dose_event_id: ev.id } : {}),
      medication_id: m.id,
      drug: m.drug ?? "",
      dose: m.dose ?? "",
      scheduled_at: at.toISOString(),
      food_rule: m.food_rule ?? "none",
    });

  for (const m of meds) {
    for (const at of slotsAround(m.times ?? [], now)) {
      if (Math.abs(at.getTime() - now.getTime()) > DUE_WINDOW_MS) continue;
      const ev = eventAt.get(key(m.id, at.toISOString()));
      if (ev && ev.status !== "pending") continue;
      push(m, at, ev);
    }
  }
  for (const ev of events) {
    if (ev.status !== "pending" || !ev.scheduled_at || !ev.medication_id) continue;
    const m = byId.get(ev.medication_id);
    if (m) push(m, new Date(ev.scheduled_at), ev);
  }
  return [...out.values()].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

// ---------------------------------------------------------------- doses

export async function findDoseEvent(medicationId: string, scheduledAt: Date): Promise<DoseEventRow | undefined> {
  const rows = must(
    "find dose event",
    await db
      .from("dose_events")
      .select("*")
      .eq("medication_id", medicationId)
      .eq("scheduled_at", scheduledAt.toISOString())
      .order("created_at", { ascending: false })
      .limit(1),
  ) as DoseEventRow[];
  return rows[0];
}

export async function insertDoseEvent(row: {
  patient_id: string;
  medication_id: string;
  scheduled_at: string;
  status: DoseStatus;
  confirmed_via?: string | null;
  chert_message_id?: string | null;
  evidence_jpeg_url?: string | null;
}): Promise<DoseEventRow> {
  return must("insert dose event", await db.from("dose_events").insert(row).select("*").single()) as DoseEventRow;
}

export async function updateDoseEvent(id: string, patch: Partial<DoseEventRow>): Promise<void> {
  must("update dose event", await db.from("dose_events").update(patch).eq("id", id));
}

// ---------------------------------------------------------------- context bits

export async function recentMemories(patientId: string, limit = 10): Promise<MemoryRow[]> {
  return must(
    "list memories",
    await db
      .from("memories")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as MemoryRow[];
}

export async function recentCheckIns(patientId: string, limit = 3): Promise<CheckInRow[]> {
  return must(
    "list check-ins",
    await db
      .from("check_ins")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as CheckInRow[];
}

/** The newest check-in not yet finalized by /calls/ended (summary is null). */
export async function openCheckIn(patientId: string): Promise<CheckInRow | undefined> {
  const rows = must(
    "find open check-in",
    await db
      .from("check_ins")
      .select("*")
      .eq("patient_id", patientId)
      .is("summary", null)
      .order("created_at", { ascending: false })
      .limit(1),
  ) as CheckInRow[];
  return rows[0];
}

/** Newest call for this patient that has not ended. */
export async function activeCall(patientId: string): Promise<{ id: string } | undefined> {
  const rows = must(
    "find active call",
    await db
      .from("calls")
      .select("id")
      .eq("patient_id", patientId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1),
  ) as { id: string }[];
  return rows[0];
}
