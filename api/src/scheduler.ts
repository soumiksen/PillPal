/**
 * Every minute: make sure today's dose_events exist (one pending row per active medicine time), and
 * mark doses still pending 12 h after their time as missed. This is what fills the portal's pill box.
 *
 * Reminders (iMessage at pill time) and auto-dial (FaceTime) from the working sheet hook in here later;
 * they need the Chert keys and a real /dial, so they are not wired yet.
 */
import { db } from "./db.js";
import { must } from "./lib/data.js";
import { zonedDate, zonedTime } from "./lib/time.js";

/** Same window the agent uses for "still due" (PENDING_LOOKBACK_MS in lib/data.ts). */
const MISSED_AFTER_MS = 12 * 60 * 60_000;

type MedSlotRow = { id: string; patient_id: string | null; times: string[] | null };

export async function ensureTodayDoses(now = new Date()): Promise<number> {
  const meds = must("list active meds", await db.from("medications").select("id,patient_id,times").eq("active", true)) as MedSlotRow[];
  const today = zonedDate(now);
  const slots = meds.flatMap((m) =>
    m.patient_id ? (m.times ?? []).flatMap((t) => {
      const at = zonedTime(today, t);
      return at ? [{ medication_id: m.id, patient_id: m.patient_id!, at }] : [];
    }) : [],
  );
  if (slots.length === 0) return 0;

  const times = slots.map((s) => s.at.getTime());
  const existing = must(
    "list today's doses",
    await db
      .from("dose_events")
      .select("medication_id,scheduled_at")
      .gte("scheduled_at", new Date(Math.min(...times)).toISOString())
      .lte("scheduled_at", new Date(Math.max(...times)).toISOString()),
  ) as { medication_id: string | null; scheduled_at: string | null }[];
  const have = new Set(existing.map((e) => `${e.medication_id}|${e.scheduled_at ? new Date(e.scheduled_at).getTime() : ""}`));

  const rows = slots
    .filter((s) => !have.has(`${s.medication_id}|${s.at.getTime()}`))
    .map((s) => ({ medication_id: s.medication_id, patient_id: s.patient_id, scheduled_at: s.at.toISOString(), status: "pending" }));
  if (rows.length) must("insert today's doses", await db.from("dose_events").insert(rows));
  return rows.length;
}

export async function markMissed(now = new Date()): Promise<void> {
  must(
    "mark missed doses",
    await db
      .from("dose_events")
      .update({ status: "missed" })
      .eq("status", "pending")
      .lt("scheduled_at", new Date(now.getTime() - MISSED_AFTER_MS).toISOString()),
  );
}

export function startScheduler(): void {
  const tick = async () => {
    try {
      const created = await ensureTodayDoses();
      await markMissed();
      if (created) console.log(`[scheduler] created ${created} dose slot(s) for today`);
    } catch (e) {
      console.error(`[scheduler] ${e instanceof Error ? `${e.name}: ${e.message}` : "error"}`);
    }
  };
  void tick();
  setInterval(() => void tick(), 60_000);
}
