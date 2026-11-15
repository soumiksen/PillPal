import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import { GenerateReportBody, type AlertRow, type Brief, type CheckInRow, type DoseEventRow, type WeeklyBriefData } from "@pillpal/shared";
import { db } from "../db.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";
import { activeMeds, getPatient, must } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";

export const reports = new Hono();

const DAY_MS = 86_400_000;

/** Web: gather the patient's last 7 days → ai.weeklyBrief → save in reports → Brief. */
reports.post("/generate", requireUser, async (c) => {
  const { patient_id } = await jsonBody(c, GenerateReportBody);
  await assertCareTeam(c, patient_id);
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const weekStart = new Date(Date.now() - 6 * DAY_MS).toISOString().slice(0, 10);

  const [patient, meds, doseEvents, checkIns, alerts] = await Promise.all([
    getPatient(patient_id),
    activeMeds(patient_id),
    db.from("dose_events").select("*").eq("patient_id", patient_id).gte("scheduled_at", since).order("scheduled_at"),
    db.from("check_ins").select("*").eq("patient_id", patient_id).gte("created_at", since).order("created_at"),
    db.from("alerts").select("*").eq("patient_id", patient_id).gte("created_at", since).order("created_at"),
  ]);

  const data: WeeklyBriefData = {
    patient,
    week_start: weekStart,
    meds,
    dose_events: must("list dose events", doseEvents) as DoseEventRow[],
    check_ins: must("list check-ins", checkIns) as CheckInRow[],
    alerts: must("list alerts", alerts) as AlertRow[],
  };
  const brief: Brief = await ai.weeklyBrief(data);
  must("save report", await db.from("reports").insert({ patient_id, week_start: weekStart, brief }));
  return c.json(brief);
});
