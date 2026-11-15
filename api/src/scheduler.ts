/**
 * Reminder scheduler (SCHEDULER=on; default off). node-cron, every minute, America/Chicago, no overlapping runs.
 *
 * Each tick, per patient:
 *   1. a med time that came due in the last MISSED_AFTER_MIN with no dose_event → pending dose_event +
 *      reminder text in the patient's language (ai.translate), message id saved for the ❤ tapback
 *   2. facetime: pending > REMINDER_TIMEOUT_MIN with no call on the line → dial(patient, "dose"), once per dose.
 *      web (CALL_TRANSPORT=web): ring the patient's app at the dose time; if nobody answers (45 s ring timeout)
 *      or the line was busy, ring again after REMINDER_TIMEOUT_MIN, at most WEB_DOSE_ATTEMPTS times per dose.
 *      A declined or answered call is not retried.
 *   3. pending > MISSED_AFTER_MIN → missed; 2+ missed today → orange alert + caregiver text (once a day)
 *   4. 3 taken in a row (newest today) → 🎉 celebration message, once per streak
 *   5. pills_left ≤ 5 → caregiver text + pharmacy info, once a day per med (also checked on every "taken")
 * Only patients with consent_at set and their own phone number on file are considered (no PATIENT_PHONE fallback),
 * and a patient with no active medications is skipped, so test patients never get reminders or calls.
 * Logs counts only.
 */
import cron from "node-cron";
import * as ai from "@pillpal/ai";
import type { DoseEventRow, MedicationRow, PatientRow } from "@pillpal/shared";
import { callLine } from "./calls/index.js";
import { LineBusyError } from "./chert/facetime.js";
import { messaging } from "./chert/messaging.js";
import { db } from "./db.js";
import { env } from "./env.js";
import { activeMeds, insertDoseEvent, must, updateDoseEvent } from "./lib/data.js";
import { displayName, lowPillNotice, patientPhone, reminderTemplate, textCaregiver } from "./lib/notices.js";
import { TZ, startOfZonedDay, zonedDate, zonedTime } from "./lib/time.js";

export type TickSummary = {
  patients: number;
  reminders: number;
  dials: number;
  missed: number;
  alerts: number;
  celebrations: number;
  low_pill_notices: number;
};

const MIN = 60_000;
/** patient id → id of the newest dose_event of the streak we already celebrated. */
const celebrated = new Map<string, string>();

async function sendReminder(patient: PatientRow, med: MedicationRow, ev: DoseEventRow): Promise<boolean> {
  const phone = patientPhone(patient);
  if (!phone) return false;
  try {
    const text = await ai.translate(reminderTemplate(med.drug ?? "medicine"), patient.language ?? "en");
    const id = await messaging.sendText(phone, text);
    await updateDoseEvent(ev.id, { chert_message_id: id });
    return true;
  } catch (err) {
    console.error(`[scheduler] reminder failed: ${(err as Error).message}`);
    return false;
  }
}

const WEB_DOSE_ATTEMPTS = 2;
/** dose_event id → web ring attempts (call ids, newest last) and when the last one started. */
const webAttempts = new Map<string, { calls: string[]; at: number }>();

/** Web transport: should this pending dose ring now? */
function webShouldRing(ev: DoseEventRow, now: Date, reminderMs: number): boolean {
  const a = webAttempts.get(ev.id);
  if (!a) return true;
  if (a.calls.length >= WEB_DOSE_ATTEMPTS) return false;
  const last = callLine.outcome(a.calls.at(-1)!);
  if (last === "answered" || last === "declined" || last === "ringing") return false;
  return now.getTime() - a.at >= reminderMs;
}

async function alreadyDialed(patientId: string, since: string): Promise<boolean> {
  const rows = must(
    "find dose call",
    await db.from("calls").select("id").eq("patient_id", patientId).eq("kind", "dose").gte("started_at", since).limit(1),
  ) as unknown[];
  return rows.length > 0;
}

async function tickPatient(patient: PatientRow, now: Date, s: TickSummary): Promise<void> {
  const meds = await activeMeds(patient.id);
  if (meds.length === 0) return;
  const byId = new Map(meds.map((m) => [m.id, m]));
  const dayStart = startOfZonedDay(now);
  const today = zonedDate(now);
  const missedMs = env.MISSED_AFTER_MIN * MIN;
  const reminderMs = env.REMINDER_TIMEOUT_MIN * MIN;

  const events = must(
    "list today's doses",
    await db
      .from("dose_events")
      .select("*")
      .eq("patient_id", patient.id)
      .gte("scheduled_at", dayStart.toISOString())
      .lte("scheduled_at", now.toISOString()),
  ) as DoseEventRow[];
  const have = new Set(events.map((e) => `${e.medication_id}|${new Date(e.scheduled_at!).getTime()}`));

  // 1. newly due slots
  for (const med of meds) {
    for (const t of med.times ?? []) {
      const at = zonedTime(today, t);
      if (!at || at > now || now.getTime() - at.getTime() >= missedMs) continue;
      if (med.created_at && at.getTime() < new Date(med.created_at).getTime()) continue;
      if (have.has(`${med.id}|${at.getTime()}`)) continue;
      const ev = await insertDoseEvent({
        patient_id: patient.id,
        medication_id: med.id,
        scheduled_at: at.toISOString(),
        status: "pending",
      });
      events.push(ev);
      have.add(`${med.id}|${at.getTime()}`);
      if (await sendReminder(patient, med, ev)) s.reminders++;
    }
  }

  // 2 + 3. pending → dose call / missed
  let dialedThisTick = false;
  for (const ev of events) {
    if (ev.status !== "pending" || !ev.scheduled_at) continue;
    const age = now.getTime() - new Date(ev.scheduled_at).getTime();
    if (age > missedMs) {
      await updateDoseEvent(ev.id, { status: "missed" });
      ev.status = "missed";
      s.missed++;
    } else if (callLine.transport === "web") {
      if (age < 0 || dialedThisTick || callLine.active() || !webShouldRing(ev, now, reminderMs)) continue;
      // After a restart the map is empty: one dose call already on record counts as the first attempt.
      if (!webAttempts.has(ev.id) && (await alreadyDialed(patient.id, ev.scheduled_at))) {
        webAttempts.set(ev.id, { calls: ["(before restart)"], at: now.getTime() });
        continue;
      }
      try {
        const placed = await callLine.dial(patient.id, "dose");
        // One call covers every medicine due at this time (Pal sees them all in due_now).
        for (const other of events) {
          if (other.status !== "pending" || other.scheduled_at !== ev.scheduled_at) continue;
          const a = webAttempts.get(other.id) ?? { calls: [], at: 0 };
          a.calls.push(placed.call_id);
          a.at = now.getTime();
          webAttempts.set(other.id, a);
        }
        dialedThisTick = true;
        s.dials++;
      } catch (err) {
        if (!(err instanceof LineBusyError)) console.error(`[scheduler] dose call failed: ${(err as Error).message}`);
      }
    } else if (age > reminderMs && ev.chert_message_id && !dialedThisTick && !callLine.active()) {
      if (await alreadyDialed(patient.id, ev.scheduled_at)) continue;
      try {
        await callLine.dial(patient.id, "dose");
        dialedThisTick = true;
        s.dials++;
      } catch (err) {
        if (!(err instanceof LineBusyError)) console.error(`[scheduler] dose call failed: ${(err as Error).message}`);
      }
    }
  }

  const missedToday = events.filter((e) => e.status === "missed").length;
  if (missedToday >= 2) {
    const prior = must(
      "find missed alert",
      await db
        .from("alerts")
        .select("id")
        .eq("patient_id", patient.id)
        .eq("level", "orange")
        .like("reason", "Missed doses%")
        .gte("created_at", dayStart.toISOString())
        .limit(1),
    ) as unknown[];
    if (prior.length === 0) {
      const reason = `Missed doses today: ${missedToday}`;
      must("insert missed alert", await db.from("alerts").insert({ patient_id: patient.id, level: "orange", reason, sent_to: "caregiver" }));
      await textCaregiver(
        patient,
        `🟠 PillPal: ${displayName(patient)} has missed ${missedToday} doses today. A quick call might help.`,
        "missed doses",
      );
      s.alerts++;
    }
  }

  // 4. streak
  const recent = must(
    "recent resolved doses",
    await db
      .from("dose_events")
      .select("id, status, scheduled_at")
      .eq("patient_id", patient.id)
      .neq("status", "pending")
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at", { ascending: false })
      .limit(4),
  ) as Pick<DoseEventRow, "id" | "status" | "scheduled_at">[];
  const newest = recent[0];
  const streakOf3 =
    recent.length >= 3 &&
    recent.slice(0, 3).every((e) => e.status === "taken") &&
    (recent.length === 3 || recent[3]!.status !== "taken");
  if (streakOf3 && newest && new Date(newest.scheduled_at!) >= dayStart && celebrated.get(patient.id) !== newest.id) {
    celebrated.set(patient.id, newest.id);
    const phone = patientPhone(patient);
    if (phone) {
      try {
        const text = await ai.translate(
          `🎉 3 doses in a row, ${displayName(patient, "friend")}! Wonderful job — keep it up.`,
          patient.language ?? "en",
        );
        await messaging.sendText(phone, text, "celebration");
        s.celebrations++;
      } catch (err) {
        console.error(`[scheduler] celebration failed: ${(err as Error).message}`);
      }
    }
  }

  // 5. low pills
  for (const med of byId.values()) {
    if (await lowPillNotice(patient, med, now).catch(() => false)) s.low_pill_notices++;
  }
}

/** One scheduler pass over every patient. Exported for /dev/scheduler/tick and tests. */
export async function tick(now = new Date()): Promise<TickSummary> {
  const s: TickSummary = { patients: 0, reminders: 0, dials: 0, missed: 0, alerts: 0, celebrations: 0, low_pill_notices: 0 };
  const patients = must(
    "list patients",
    await db.from("patients").select("*").not("consent_at", "is", null).not("phone", "is", null).neq("phone", ""),
  ) as PatientRow[];
  for (const p of patients) {
    s.patients++;
    try {
      await tickPatient(p, now, s);
    } catch (err) {
      console.error(`[scheduler] patient tick failed: ${(err as Error).message}`);
    }
  }
  const did = Object.entries(s).filter(([k, v]) => k !== "patients" && v > 0);
  if (did.length) console.log(`[scheduler] tick: ${did.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  return s;
}

let running = false;

/** Guarded tick: never two at once (node-cron noOverlap plus this flag for manual ticks). */
export async function safeTick(now = new Date()): Promise<TickSummary | { skipped: "tick_in_progress" }> {
  if (running) return { skipped: "tick_in_progress" };
  running = true;
  try {
    return await tick(now);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  cron.schedule("* * * * *", () => safeTick().then(() => undefined), {
    timezone: TZ,
    noOverlap: true,
    name: "pillpal-scheduler",
  });
  console.log(`[scheduler] on: every minute (${TZ}), reminder timeout ${env.REMINDER_TIMEOUT_MIN} min, missed after ${env.MISSED_AFTER_MIN} min`);
}
