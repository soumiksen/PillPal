/** Dose state transitions shared by POST /doses, Chert events and the scheduler. */
import type { DoseEventRow, MedicationRow } from "@pillpal/shared";
import { db } from "../db.js";
import { getPatient, must } from "./data.js";
import { lowPillNotice } from "./notices.js";

/** pills_left − 1 (never below 0), then the low-pill notice check. */
export async function decrementPills(medicationId: string): Promise<void> {
  const rows = must(
    "read pills_left",
    await db.from("medications").select("*").eq("id", medicationId).limit(1),
  ) as MedicationRow[];
  const med = rows[0];
  if (!med || med.pills_left == null) return;
  const pills_left = Math.max(0, med.pills_left - 1);
  must("decrement pills_left", await db.from("medications").update({ pills_left }).eq("id", medicationId));
  if (med.patient_id) {
    const patient = await getPatient(med.patient_id);
    await lowPillNotice(patient, { ...med, pills_left }).catch((e: Error) =>
      console.error(`[doses] low pill notice failed: ${e.message}`),
    );
  }
}

/**
 * Mark matching dose_events taken (only rows not already taken, so pills are counted once).
 * → the rows that changed.
 */
export async function markTaken(
  match: { id?: string; chert_message_id?: string },
  confirmed_via: string,
  extra: { evidence_jpeg_url?: string } = {},
): Promise<DoseEventRow[]> {
  let q = db.from("dose_events").update({ status: "taken", confirmed_via, ...extra }).neq("status", "taken");
  if (match.id) q = q.eq("id", match.id);
  if (match.chert_message_id) q = q.eq("chert_message_id", match.chert_message_id);
  if (!match.id && !match.chert_message_id) throw new Error("markTaken needs an id or chert_message_id");
  const changed = must("mark dose taken", await q.select("*")) as DoseEventRow[];
  for (const ev of changed) if (ev.medication_id) await decrementPills(ev.medication_id);
  return changed;
}

/** Newest pending dose_event that has a reminder message (for replies / text tapbacks on Shared). */
export async function latestPendingReminder(patientId: string): Promise<DoseEventRow | undefined> {
  const rows = must(
    "find pending reminder",
    await db
      .from("dose_events")
      .select("*")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .not("chert_message_id", "is", null)
      .gte("scheduled_at", new Date(Date.now() - 12 * 3_600_000).toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(1),
  ) as DoseEventRow[];
  return rows[0];
}
