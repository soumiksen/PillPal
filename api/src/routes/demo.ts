import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as ai from "@pillpal/ai";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import {
  DemoCallAtBody,
  DemoRemindBody,
  type DemoCallAtResponse,
  type DemoRemindResponse,
  type DoseEventRow,
} from "@pillpal/shared";
import { callLine } from "../calls/index.js";
import { LineBusyError } from "../chert/facetime.js";
import { env } from "../env.js";
import { messaging } from "../chert/messaging.js";
import { findDoseEvent, getMedication, getPatient, insertDoseEvent, updateDoseEvent } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { patientPhone, reminderTemplate } from "../lib/notices.js";
import { TZ, nearestSlot, zonedDate, zonedTime } from "../lib/time.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";

export const demo = new Hono();

/**
 * Web: send a reminder (works in CHERT_MODE mock, live and shared; on Shared the patient replies
 * "taken" instead of tapping ❤, see lib/notices.ts) for a medication right now.
 * Uses the pending dose_event for the med's nearest scheduled time (creating it if needed); if that
 * slot is already resolved, a fresh pending event is created at "now" so the demo can be re-run.
 */
demo.post("/remind", requireUser, async (c) => {
  const body = await jsonBody(c, DemoRemindBody);
  await assertCareTeam(c, body.patient_id);
  const [patient, med] = await Promise.all([getPatient(body.patient_id), getMedication(body.medication_id)]);
  if (med.patient_id !== patient.id) throw new HTTPException(409, { message: "medication_not_for_patient" });
  const phone = patientPhone(patient);
  if (!phone) throw new HTTPException(409, { message: "patient_has_no_phone" });

  const slot = nearestSlot(med.times) ?? new Date();
  const existing = await findDoseEvent(med.id, slot);
  let dose: DoseEventRow;
  if (existing?.status === "pending") dose = existing;
  else {
    dose = await insertDoseEvent({
      patient_id: patient.id,
      medication_id: med.id,
      scheduled_at: (existing ? new Date() : slot).toISOString(),
      status: "pending",
    });
  }

  const text = await ai.translate(reminderTemplate(med.drug ?? "medicine"), patient.language ?? "en");
  const messageId = await messaging.sendText(phone, text);
  await updateDoseEvent(dose.id, { chert_message_id: messageId });

  return c.json({ dose_event_id: dose.id, chert_message_id: messageId } satisfies DemoRemindResponse);
});

// ---------------------------------------------------------------- POST /demo/call-at

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** Demo apps / scripts: `x-demo-code: <DEMO_ACCESS_CODE>`; otherwise a signed-in care-team user. */
const demoOrUser: MiddlewareHandler = async (c, next) => {
  const code = c.req.header("x-demo-code");
  if (code && env.DEMO_ACCESS_CODE && sameSecret(code, env.DEMO_ACCESS_CODE)) {
    c.set("demo_code" as never, true as never);
    return next();
  }
  return requireUser(c, next);
};
const viaDemoCode = (c: Context) => c.get("demo_code" as never) === true;

const scheduled = new Map<string, NodeJS.Timeout>();

/** Next instant of HH:MM in America/Chicago (today, or tomorrow if it already passed). */
export function nextZoned(hhmm: string, now = new Date()): Date | undefined {
  const today = zonedDate(now);
  const at = zonedTime(today, hhmm);
  if (!at) return undefined;
  if (at.getTime() > now.getTime() - 30_000) return at;
  const tomorrow = new Date(Date.UTC(today.y, today.m - 1, today.d + 1));
  return zonedTime({ y: tomorrow.getUTCFullYear(), m: tomorrow.getUTCMonth() + 1, d: tomorrow.getUTCDate() }, hhmm);
}

/**
 * Ring the patient's app at HH:MM America/Chicago (in-memory timer; lost on restart). A second request for the
 * same patient replaces the first. If the line is busy at that moment, it retries every 15 s for 2 minutes.
 */
demo.post("/call-at", demoOrUser, async (c) => {
  const body = await jsonBody(c, DemoCallAtBody);
  if (!viaDemoCode(c)) await assertCareTeam(c, body.patient_id);
  await getPatient(body.patient_id); // 404 early for an unknown patient
  const at = nextZoned(body.at);
  if (!at) throw new HTTPException(400, { message: "invalid_time" });
  const delay = Math.max(0, at.getTime() - Date.now());

  clearTimeout(scheduled.get(body.patient_id));
  const fire = async (tries: number): Promise<void> => {
    scheduled.delete(body.patient_id);
    try {
      await callLine.dial(body.patient_id, body.kind);
    } catch (err) {
      if (err instanceof LineBusyError && tries < 8) {
        scheduled.set(body.patient_id, setTimeout(() => void fire(tries + 1), 15_000));
        return;
      }
      console.error(`[demo] call-at failed: ${(err as Error).message}`);
    }
  };
  scheduled.set(body.patient_id, setTimeout(() => void fire(0), delay));
  console.log(`[demo] call scheduled for ${body.at} ${TZ} (in ${Math.round(delay / 1000)} s, kind=${body.kind})`);
  return c.json({ scheduled_for: at.toISOString(), in_seconds: Math.round(delay / 1000) } satisfies DemoCallAtResponse, 202);
});
