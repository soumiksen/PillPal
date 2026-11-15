import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import { GenerateReportBody, type Brief, type WeeklyBriefData } from "@pillpal/shared";
import { jsonBody } from "../lib/http.js";
import { stubCheckIns, stubMeds, stubPatient } from "../lib/stubs.js";

export const reports = new Hono();

/** Web: gather the last 7 days → ai.weeklyBrief → Brief. */
reports.post("/generate", async (c) => {
  const { patient_id } = await jsonBody(c, GenerateReportBody);
  const weekStart = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const data: WeeklyBriefData = {
    patient: stubPatient(patient_id),
    week_start: weekStart,
    meds: stubMeds(patient_id),
    dose_events: [],
    check_ins: stubCheckIns(patient_id),
    alerts: [],
  };
  const brief: Brief = await ai.weeklyBrief(data);
  return c.json(brief);
});
