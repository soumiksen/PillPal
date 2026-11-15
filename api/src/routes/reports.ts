import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import {
  GenerateReportBody,
  type AlertRow,
  type Brief,
  type CheckInRow,
  type DoseEventRow,
  type WeeklyBriefData,
} from "@pillpal/shared";
import { db } from "../db.js";
import { activeMeds, getPatient, must } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { startOfZonedDay, zonedDate } from "../lib/time.js";

export const reports = new Hono();

/** Web: gather the last 7 days (America/Chicago days, today included) → ai.weeklyBrief → reports row → Brief. */
reports.post("/generate", async (c) => {
  const { patient_id } = await jsonBody(c, GenerateReportBody);
  const patient = await getPatient(patient_id);
  const from = startOfZonedDay(new Date(Date.now() - 6 * 86_400_000));
  const d = zonedDate(from);
  const week_start = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  const since = from.toISOString();
  const now = new Date().toISOString();

  const [meds, doseEvents, checkIns, alerts] = await Promise.all([
    activeMeds(patient_id),
    db.from("dose_events").select("*").eq("patient_id", patient_id).gte("scheduled_at", since).lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true }),
    db.from("check_ins").select("*").eq("patient_id", patient_id).gte("created_at", since).order("created_at", { ascending: true }),
    db.from("alerts").select("*").eq("patient_id", patient_id).gte("created_at", since).order("created_at", { ascending: true }),
  ]);
  const data: WeeklyBriefData = {
    patient,
    week_start,
    meds,
    // Pending doses are still open, not a result yet.
    dose_events: (must("list dose events", doseEvents) as DoseEventRow[]).filter((e) => e.status !== "pending"),
    check_ins: (must("list check-ins", checkIns) as CheckInRow[]).filter((ci) => ci.summary !== null),
    alerts: must("list alerts", alerts) as AlertRow[],
  };
  const brief: Brief = await ai.weeklyBrief(data);
  must("insert report", await db.from("reports").insert({ patient_id, week_start, brief }));
  console.log(`[reports] brief saved (${data.dose_events.length} doses, ${data.check_ins.length} check-ins)`);
  return c.json(brief);
});
