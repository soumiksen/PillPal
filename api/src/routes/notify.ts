import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as ai from "@pillpal/ai";
import { DoseChangeBody, type DoseChangeResponse, type PatientRow } from "@pillpal/shared";
import { messaging } from "../chert/messaging.js";
import { db } from "../db.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";
import { getMedication, getPatient, must } from "../lib/data.js";
import { jsonBody } from "../lib/http.js";
import { caregiverPhone, displayName, patientPhone, textCaregiver } from "../lib/notices.js";

export const notify = new Hono();

type Sent = { kind: "text" | "voice_note" | "care_chat_post" | "care_chat_text" | "caregiver_summary"; id: string };

/** Care Circle chat: created once (first message is text-only, no URLs) and its id stored on the patient. */
async function careChatPost(patient: PatientRow, text: string): Promise<Sent | undefined> {
  const p = patientPhone(patient);
  const cg = caregiverPhone(patient);
  if (!p || !cg) return undefined;
  if (!messaging.supports.groupChats) {
    // Shared lines have no group chats: the Care Circle post goes to the caregiver as a 1:1 text.
    const id = await messaging.sendText(cg, `👥 Care Circle — ${text}`);
    return { kind: "care_chat_text", id };
  }
  if (!patient.care_chat_id) {
    const chatId = await messaging.createCareChat([p, cg], text.replace(/https?:\/\/\S+/g, "").trim());
    must("store care_chat_id", await db.from("patients").update({ care_chat_id: chatId }).eq("id", patient.id));
    return { kind: "care_chat_post", id: chatId };
  }
  return { kind: "care_chat_post", id: await messaging.postToChat(patient.care_chat_id, text) };
}

/**
 * Web: the doctor changed a dose →
 *   1. ai.doseChangeMessage  2. patient text (their language)  3. ai.tts voice note (text fallback on Shared)
 *   4. Care Circle post (chat created once; text fallback on Shared)  5. English summary to the caregiver.
 * The API relays the doctor's change; it never invents one and does not edit the medication row.
 * Response: the contract fields plus `messages` (kinds + ids only).
 */
notify.post("/dose-change", requireUser, async (c) => {
  const body = await jsonBody(c, DoseChangeBody);
  await assertCareTeam(c, body.patient_id);
  const [patient, med] = await Promise.all([getPatient(body.patient_id), getMedication(body.medication_id)]);
  if (med.patient_id !== patient.id) throw new HTTPException(409, { message: "medication_not_for_patient" });
  const phone = patientPhone(patient);
  if (!phone) throw new HTTPException(409, { message: "patient_has_no_phone" });

  const msg = await ai.doseChangeMessage(patient, {
    drug: med.drug ?? "medication",
    old_dose: body.old_dose,
    new_dose: body.new_dose,
    doctor_note: body.doctor_note,
  });
  const messages: Sent[] = [];
  const sent = { text: false, voice_note: false, group_chat: false };

  messages.push({ kind: "text", id: await messaging.sendText(phone, msg.patient_text) });
  sent.text = true;

  try {
    const wav = await ai.tts(msg.patient_text, patient.language ?? "en");
    const id = await messaging.sendVoiceNote(phone, wav, msg.patient_text);
    messages.push({ kind: "voice_note", id });
    sent.voice_note = messaging.supports.voiceNotes;
  } catch (err) {
    console.error(`[notify] voice note failed: ${(err as Error).message}`);
  }

  try {
    const post = await careChatPost(patient, `${displayName(patient)}'s ${med.drug ?? "medication"} changed. ${msg.english_text}`);
    if (post) {
      messages.push(post);
      sent.group_chat = post.kind === "care_chat_post";
    }
  } catch (err) {
    console.error(`[notify] care chat failed: ${(err as Error).message}`);
  }

  const summaryId = await textCaregiver(
    patient,
    `💊 Dose change for ${displayName(patient)} (${med.drug ?? "medication"}): ${body.old_dose} → ${body.new_dose}.\n\n${msg.english_text}`,
    "dose change summary",
  );
  if (summaryId) messages.push({ kind: "caregiver_summary", id: summaryId });

  console.log(`[notify] dose change sent: ${messages.map((m) => m.kind).join(", ")}`);
  return c.json({ ...msg, sent, messages } satisfies DoseChangeResponse & { messages: Sent[] });
});
