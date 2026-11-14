/**
 * @pillpal/ai — every Claude + Gemini call (contracts 5.4). Signatures are frozen.
 *
 * Real implementations when ANTHROPIC_API_KEY / GOOGLE_API_KEY are set; otherwise the offline
 * stubs in ./stubs.ts so Backend/Frontend are never blocked.
 *
 * Rules (CLAUDE.md): Claude for all vision + text (one forced tool → JSON); Gemini only for
 * voice-memo transcription + TTS; never invent or change a dose; vision < 0.7 confidence → unsure;
 * cache translations and TTS; never log patient data.
 */
import { z } from "zod";
import {
  Brief,
  CheckInExtract,
  ClassifiedMessage,
  PillCheck,
  PlateCheck,
  RxFields,
  VISION_MIN_CONFIDENCE,
  type DoseChange,
  type DoseChangeMessage,
  type MedicationRow,
  type PatientRow,
  type Transcription,
  type VisionEvent,
  type WeeklyBriefData,
} from "@pillpal/shared";
import { claudeJson, fetchImageB64, hasClaude, sniffMime, type Part } from "./claude.js";
import { hasGemini, geminiTranscribe, geminiTts } from "./gemini.js";
import * as stubs from "./stubs.js";

export { hasClaude } from "./claude.js";
export { hasGemini } from "./gemini.js";

const LANG_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  hi: "Hindi",
  bn: "Bengali",
  zh: "Chinese (Simplified)",
  vi: "Vietnamese",
  ko: "Korean",
  ar: "Arabic",
  tl: "Tagalog",
  ru: "Russian",
};
export const languageName = (code: string) => LANG_NAMES[code.toLowerCase().slice(0, 2)] ?? code;

const SAFETY =
  "You never give medical advice, never invent, change or suggest a dose, and never diagnose. " +
  "Describe only what is visible or written.";

const medLine = (m: MedicationRow) =>
  `- id=${m.id} | ${m.drug ?? "?"} ${m.strength ?? ""} | looks like: ${m.pill_description ?? "(no description)"}`;

// ───────────────────────── vision (Claude Haiku) ─────────────────────────

const PillTool = PillCheck.extend({ looks_like_med_id: z.string().optional() });

/** Claude Haiku (CLAUDE_FAST): is the pill on camera the one that is due? */
export async function checkPill(
  frameB64: string,
  meds: MedicationRow[],
  dueMedId: string,
): Promise<PillCheck> {
  if (!hasClaude()) return stubs.stubCheckPill(frameB64, meds, dueMedId);
  const due = meds.find((m) => m.id === dueMedId);
  const content: Part[] = [];
  if (due?.reference_photo_url && /^https?:/.test(due.reference_photo_url)) {
    const ref = await fetchImageB64(due.reference_photo_url);
    if (ref) {
      content.push({ type: "text", text: `REFERENCE photo of the DUE medication (${due.drug}):` });
      content.push({ type: "image", b64: ref.b64, mime: ref.mime });
    }
  }
  content.push({ type: "text", text: "LIVE camera frame from a FaceTime call:" });
  content.push({ type: "image", b64: frameB64, mime: sniffMime(frameB64) });
  content.push({
    type: "text",
    text:
      `Medication due now: id=${dueMedId} ${due?.drug ?? ""} ${due?.strength ?? ""} — ${due?.pill_description ?? "no description"}.\n` +
      `All of the patient's medications:\n${meds.map(medLine).join("\n")}\n` +
      "Is the pill shown in the live frame the due medication?",
  });
  const r = await claudeJson({
    tier: "fast",
    toolName: "report_pill_check",
    toolDescription: "Report whether the pill held up to the camera is the medication that is due.",
    schema: PillTool,
    maxTokens: 300,
    system:
      "You check a pill held up to a phone camera during a FaceTime call. Compare colour, shape, size, " +
      "scoring and imprint with the due medication's description/reference photo. Ignore FaceTime UI overlays, " +
      "buttons and borders. If the pill is not clearly visible, blurry, too small to judge or several pills are " +
      "mixed together, answer verdict=unsure with low confidence. verdict=match only when it clearly matches the " +
      "due medication; verdict=mismatch when it clearly looks like something else (set looks_like_med_id to the id " +
      "of the matching listed medication if any). what_i_see: one plain sentence describing the pill, no verdict words. " +
      SAFETY,
    content,
  });
  return normalizePill(r, meds, dueMedId);
}

function normalizePill(
  r: z.infer<typeof PillTool>,
  meds: MedicationRow[],
  dueMedId: string,
): PillCheck {
  const known = r.looks_like_med_id && meds.some((m) => m.id === r.looks_like_med_id);
  const out: PillCheck = {
    verdict: r.verdict,
    confidence: r.confidence,
    what_i_see: r.what_i_see,
  };
  if (r.confidence < VISION_MIN_CONFIDENCE) out.verdict = "unsure";
  if (out.verdict === "mismatch" && known && r.looks_like_med_id !== dueMedId)
    out.looks_like_med_id = r.looks_like_med_id;
  return out;
}

/** Claude Haiku (CLAUDE_FAST): does the plate fit the medication's food rule? */
export async function checkPlate(frameB64: string, med: MedicationRow): Promise<PlateCheck> {
  if (!hasClaude()) return stubs.stubCheckPlate(frameB64, med);
  const rule =
    med.food_rule === "empty_stomach"
      ? "must be taken on an EMPTY stomach (no food yet; wait 30–60 minutes after eating)"
      : med.food_rule === "with_food"
        ? "must be taken WITH food"
        : "has no general food requirement";
  const r = await claudeJson({
    tier: "fast",
    toolName: "report_plate_check",
    toolDescription: "Report whether the food/drink in view fits the medication's food rule.",
    schema: PlateCheck,
    maxTokens: 300,
    system:
      "You look at the food or drink a patient shows to a phone camera and compare it with their medication's food rule. " +
      "verdict: ok = fine to take the medicine now; wait = they should wait (e.g. empty-stomach medicine but food is in view, " +
      "or with-food medicine and no food yet); not_allowed = contains a food/drink on the avoid list. " +
      "Ignore FaceTime UI overlays. If you cannot tell what the food is, use low confidence. " +
      "what_i_see: one plain sentence. reason: one short, kind sentence for the patient. " +
      SAFETY,
    content: [
      { type: "image", b64: frameB64, mime: sniffMime(frameB64) },
      {
        type: "text",
        text:
          `Medication: ${med.drug ?? "?"} ${med.strength ?? ""}. Rule: ${rule}.\n` +
          `Foods/drinks to avoid: ${(med.avoid_foods ?? []).join(", ") || "none listed"}.`,
      },
    ],
  });
  if (r.confidence < VISION_MIN_CONFIDENCE) {
    // PlateCheck has no "unsure": never green-light on a low-confidence read.
    return {
      verdict: "wait",
      confidence: r.confidence,
      what_i_see: r.what_i_see,
      reason: "I can't see your plate clearly — please hold it closer, in good light.",
    };
  }
  return r;
}

// ───────────────────────── Rx + descriptions ─────────────────────────

/** Claude Sonnet (CLAUDE_SMART): read a prescription label photo. */
export async function parseRx(imageB64: string, mime: string): Promise<RxFields> {
  if (!hasClaude()) return stubs.stubParseRx(imageB64, mime);
  const m = /^image\/(jpeg|png|gif|webp)$/.test(mime) ? (mime as "image/jpeg") : sniffMime(imageB64);
  return claudeJson({
    tier: "smart",
    toolName: "record_prescription",
    toolDescription: "Record the fields read from a pharmacy prescription label.",
    schema: RxFields,
    maxTokens: 800,
    system:
      "You read pharmacy prescription label photos. Copy values EXACTLY as printed — never infer, round, convert or " +
      "correct a dose. If a field is not legible or not printed use \"\" (strings), [] (lists) or null (numbers). " +
      "drug: medicine name. strength: e.g. \"500 mg\". dose: the amount per intake as written, e.g. \"1 tablet\". " +
      "times: 24h HH:MM clock times; derive them from the directions only when unambiguous (e.g. \"twice daily\" → " +
      "[\"08:00\",\"20:00\"], \"three times a day\" → [\"08:00\",\"14:00\",\"20:00\"], \"at bedtime\" → [\"21:00\"]), else []. " +
      "food_rule: empty_stomach | with_food | none from the directions/auxiliary stickers. avoid_foods: foods/drinks " +
      "the label says to avoid (e.g. alcohol, grapefruit). quantity: pills dispensed. refills: refills remaining. " +
      "warnings: auxiliary warnings printed on the label, short. A human will confirm everything you return.",
    content: [
      { type: "image", b64: imageB64, mime: m },
      { type: "text", text: "Read this prescription label." },
    ],
  });
}

/** Claude Haiku (CLAUDE_FAST): one-line visual description of a pill photo. */
export async function describePill(imageB64: string): Promise<string> {
  if (!hasClaude()) return stubs.stubDescribePill(imageB64);
  const r = await claudeJson({
    tier: "fast",
    toolName: "describe_pill",
    toolDescription: "Describe the pill's appearance for later visual matching.",
    schema: z.object({ description: z.string() }),
    maxTokens: 200,
    system:
      "Describe the pill in the photo in ONE short line for later visual matching: colour, shape, size, coating, " +
      "scoring, imprint text exactly as seen. Visual facts only — do not name the drug.",
    content: [
      { type: "image", b64: imageB64, mime: sniffMime(imageB64) },
      { type: "text", text: "Describe this pill." },
    ],
  });
  return r.description.trim();
}

// ───────────────────────── messages + translation (cached) ─────────────────────────

const cache = <V>(max = 500) => {
  const m = new Map<string, V>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: V) => {
      if (m.size >= max) m.delete(m.keys().next().value as string);
      m.set(k, v);
    },
  };
};
const classifyCache = cache<ClassifiedMessage>();
const translateCache = cache<string>(1000);

/** Claude Haiku (CLAUDE_FAST, cached): classify an inbound iMessage. */
export async function classifyMessage(text: string): Promise<ClassifiedMessage> {
  if (!hasClaude()) return stubs.stubClassifyMessage(text);
  const hit = classifyCache.get(text);
  if (hit) return hit;
  const r = await claudeJson({
    tier: "fast",
    toolName: "classify_message",
    toolDescription: "Classify a text message from an elderly patient.",
    schema: ClassifiedMessage,
    maxTokens: 300,
    system:
      "Classify a text message sent by a patient to their medication companion. language: ISO 639-1 code of the " +
      "message. english: faithful English translation (the same text if already English). intent: dose_taken | " +
      "dose_skipped | symptom | question | reschedule | greeting | other. red_flag = true for any possible emergency " +
      "or safety concern: chest pain, trouble breathing, fall, fainting, confusion, severe dizziness, stroke signs, " +
      "double dose / took too much, suicidal thoughts. When unsure, red_flag = true. " + SAFETY,
    content: [{ type: "text", text }],
  });
  classifyCache.set(text, r);
  return r;
}

/** Claude Haiku (CLAUDE_FAST, cached): translate text into `lang`. */
export async function translate(text: string, lang: string): Promise<string> {
  if (!hasClaude()) return stubs.stubTranslate(text, lang);
  if (lang.toLowerCase().startsWith("en")) return text;
  const key = `${lang}\u0000${text}`;
  const hit = translateCache.get(key);
  if (hit) return hit;
  const r = await claudeJson({
    tier: "fast",
    toolName: "translation",
    toolDescription: "Return the translated text.",
    schema: z.object({ translation: z.string() }),
    maxTokens: 800,
    system:
      `Translate the user's text into ${languageName(lang)} for an elderly patient: warm, simple everyday words. ` +
      "Keep emojis, line breaks, numbers, drug names, doses and times exactly as written. Never add, drop or alter any dose.",
    content: [{ type: "text", text }],
  });
  translateCache.set(key, r.translation);
  return r.translation;
}

// ───────────────────────── check-in, brief, dose change (Claude Sonnet) ─────────────────────────

/** Claude Sonnet (CLAUDE_SMART): structured check-in from a call transcript. */
export async function extractCheckIn(
  transcript: string,
  visionEvents: VisionEvent[],
  meds: MedicationRow[],
): Promise<z.infer<typeof CheckInExtract>> {
  if (!hasClaude()) return stubs.stubExtractCheckIn(transcript, visionEvents, meds);
  const r = await claudeJson({
    tier: "smart",
    toolName: "record_check_in",
    toolDescription: "Record the structured result of a patient check-in call.",
    schema: CheckInExtract,
    maxTokens: 1200,
    system:
      "You summarise a FaceTime medication check-in between the AI companion 'Pal' and a patient, for a caregiver and doctor. " +
      "summary: 2–3 plain sentences, English. mood: 1 (very low) – 5 (very good), from what the patient said/showed. " +
      "symptoms: only symptoms the patient reported (name, severity mild|moderate|severe, quote = their exact words). " +
      "visual_notes: neutral observations from the vision events/transcript (observations, not diagnoses). " +
      "quotes: up to 4 meaningful patient quotes, original = exact words in the original language, english = translation. " +
      "risk_level: green = fine; yellow = mild symptom or a caught wrong pill; orange = missed dose, repeated or concerning " +
      "symptoms; red = chest pain, trouble breathing, fall, confusion, fainting, severe dizziness, or a double dose. " +
      "Never invent facts that are not in the transcript or vision events. " + SAFETY,
    content: [
      {
        type: "text",
        text:
          `Medications: ${meds.map((m) => `${m.drug} ${m.strength ?? ""}`).join("; ") || "unknown"}\n\n` +
          `Vision events (JSON): ${JSON.stringify(visionEvents)}\n\nTranscript:\n${transcript}`,
      },
    ],
  });
  return r;
}

const BriefText = Brief.pick({ symptoms: true, quotes: true, concerns: true, summary: true });

/** Claude Sonnet (CLAUDE_SMART): weekly doctor brief. Numbers are computed here, never by the model. */
export async function weeklyBrief(data: WeeklyBriefData): Promise<z.infer<typeof Brief>> {
  if (!hasClaude()) return stubs.stubWeeklyBrief(data);
  const taken = data.dose_events.filter((d) => d.status === "taken").length;
  const missed = data.dose_events.filter((d) => d.status === "missed").length;
  const wrong = data.dose_events.filter((d) => d.status === "wrong_pill_caught").length;
  const denom = taken + missed;
  const stats = {
    adherence_pct: denom ? Math.round((taken / denom) * 100) : 0,
    doses_taken: taken,
    doses_missed: missed,
    wrong_pills_caught: wrong,
    mood_trend: [...data.check_ins]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => c.mood)
      .filter((m): m is number => typeof m === "number")
      .slice(-7),
  };
  const t = await claudeJson({
    tier: "smart",
    toolName: "write_weekly_brief",
    toolDescription: "Write the narrative parts of a weekly brief for the patient's doctor.",
    schema: BriefText,
    maxTokens: 1500,
    system:
      "You write a concise weekly brief for a patient's doctor from the data given. summary: 3–4 sentences, English, using " +
      "the provided statistics verbatim. symptoms: symptoms reported this week (deduplicate; keep a representative quote). " +
      "quotes: up to 4 meaningful patient quotes (original + english). concerns: 'questions for the doctor' — factual " +
      "patterns worth a clinician's attention (e.g. recurring dizziness, missed evening doses). Do not diagnose and never " +
      "recommend a dose or dose change. " + SAFETY,
    content: [
      {
        type: "text",
        text:
          `Patient: ${data.patient.preferred_name ?? data.patient.name ?? "Patient"}\nWeek starting: ${data.week_start}\n` +
          `Statistics (authoritative): ${JSON.stringify(stats)}\n` +
          `Medications: ${data.meds.map((m) => `${m.drug} ${m.strength ?? ""} ${m.dose ?? ""}`).join("; ")}\n` +
          `Check-ins: ${JSON.stringify(data.check_ins.map((c) => ({ at: c.created_at, mood: c.mood, symptoms: c.symptoms, quotes: c.quotes, risk: c.risk_level, summary: c.summary })))}\n` +
          `Alerts: ${JSON.stringify(data.alerts.map((a) => ({ at: a.created_at, level: a.level, reason: a.reason })))}`,
      },
    ],
  });
  return { patient_id: data.patient.id, week_start: data.week_start, ...stats, ...t };
}

const DoseMsgTool = z.object({ patient_text: z.string(), english_text: z.string() });

/** Claude Sonnet (CLAUDE_SMART): patient-facing dose-change message in their language. */
export async function doseChangeMessage(
  patient: PatientRow,
  change: DoseChange,
): Promise<DoseChangeMessage> {
  if (!hasClaude()) return stubs.stubDoseChangeMessage(patient, change);
  const lang = patient.language ?? "en";
  const r = await claudeJson({
    tier: "smart",
    toolName: "write_dose_change_message",
    toolDescription: "Write the warm text message telling the patient about a doctor-ordered dose change.",
    schema: DoseMsgTool,
    maxTokens: 700,
    system:
      `Write a short, warm text message to an elderly patient telling them their doctor changed a medicine's dose. ` +
      `patient_text is in ${languageName(lang)}; english_text is the same message in English for the care team. ` +
      "Address the patient by their preferred name, 2–4 short sentences, simple words, no jargon. State the drug, old dose " +
      "and new dose EXACTLY as given (copy the strings verbatim) and include the doctor's note meaning faithfully. " +
      "Add that they can reply or call if unsure. Never invent, round or alter any dose, timing or instruction. " + SAFETY,
    content: [
      {
        type: "text",
        text:
          `Patient preferred name: ${patient.preferred_name ?? patient.name ?? ""}\nDoctor: ${patient.doctor_name ?? "your doctor"}\n` +
          `Drug: ${change.drug}\nOld dose: ${change.old_dose}\nNew dose: ${change.new_dose}\nDoctor's note: ${change.doctor_note}`,
      },
    ],
  });
  // Safety net: the new dose must appear verbatim in both texts.
  const ensure = (s: string) => (s.includes(change.new_dose) ? s : `${s}\n\n${change.drug}: ${change.new_dose}`);
  return { patient_text: ensure(r.patient_text), english_text: ensure(r.english_text) };
}

// ───────────────────────── speech (Gemini, free) ─────────────────────────

/** Gemini 2.5 Flash (free): transcribe a voice memo. */
export async function transcribe(wavBuffer: Buffer): Promise<Transcription> {
  if (!hasGemini()) return stubs.stubTranscribe(wavBuffer);
  return geminiTranscribe(wavBuffer);
}

/** Gemini 2.5 Flash TTS (free, disk cache): mono 24 kHz PCM WAV for Chert voice notes. */
export async function tts(text: string, lang: string): Promise<Buffer> {
  if (!hasGemini()) return stubs.stubTts(text, lang);
  return geminiTts(text, lang);
}
