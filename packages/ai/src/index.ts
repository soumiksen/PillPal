/**
 * @pillpal/ai — every Claude + Gemini call (contracts 5.4).
 *
 * STUBS: each function returns realistic fake data so Backend and Frontend are never blocked.
 * Real versions (Claude via @anthropic-ai/sdk, Gemini via @google/genai) replace these
 * without changing signatures.
 */
import {
  VISION_MIN_CONFIDENCE,
  type Brief,
  type CheckInExtract,
  type ClassifiedMessage,
  type DoseChange,
  type DoseChangeMessage,
  type MedicationRow,
  type PatientRow,
  type PillCheck,
  type PlateCheck,
  type RxFields,
  type Transcription,
  type VisionEvent,
  type WeeklyBriefData,
} from "@pillpal/shared";

const STUB_DELAY_MS = 150;
const delay = () => new Promise<void>((r) => setTimeout(r, STUB_DELAY_MS));

/**
 * Deterministic stub trick so demos can exercise every branch: a frame whose base64 contains
 * "WRONG" is treated as the wrong pill, "UNSURE"/"BLUR" as unclear, otherwise a match.
 */
function stubFlag(b64: string, ...flags: string[]): boolean {
  const head = b64.slice(0, 4096).toUpperCase();
  return flags.some((f) => head.includes(f));
}

/** Claude Haiku (CLAUDE_FAST): is the pill on camera the one that is due? */
export async function checkPill(
  frameB64: string,
  meds: MedicationRow[],
  dueMedId: string,
): Promise<PillCheck> {
  await delay();
  const due = meds.find((m) => m.id === dueMedId);
  const other = meds.find((m) => m.id !== dueMedId);

  if (stubFlag(frameB64, "UNSURE", "BLUR")) {
    return {
      verdict: "unsure",
      confidence: 0.45,
      what_i_see: "A small light-coloured object in the palm, too blurry to read any imprint.",
    };
  }
  if (stubFlag(frameB64, "WRONG") && other) {
    return {
      verdict: "mismatch",
      confidence: 0.91,
      what_i_see: `A ${other.pill_description ?? "white oblong tablet"} — this looks like ${other.drug ?? "a different medication"}, not ${due?.drug ?? "the one that is due"}.`,
      looks_like_med_id: other.id,
    };
  }
  const confidence = 0.93;
  return {
    verdict: confidence >= VISION_MIN_CONFIDENCE ? "match" : "unsure",
    confidence,
    what_i_see: `A ${due?.pill_description ?? "small round white tablet"} held in the right hand, matching the reference photo for ${due?.drug ?? "the due medication"}.`,
  };
}

/** Claude Haiku (CLAUDE_FAST): does the plate fit the medication's food rule? */
export async function checkPlate(frameB64: string, med: MedicationRow): Promise<PlateCheck> {
  await delay();
  const avoid = med.avoid_foods?.[0];
  if (stubFlag(frameB64, "WRONG") && avoid) {
    return {
      verdict: "not_allowed",
      confidence: 0.88,
      what_i_see: `A breakfast plate with toast and a glass of ${avoid}.`,
      reason: `${med.drug ?? "This medicine"} should not be taken with ${avoid}.`,
    };
  }
  if (med.food_rule === "empty_stomach") {
    return {
      verdict: "wait",
      confidence: 0.86,
      what_i_see: "A bowl of oatmeal with banana slices and a cup of coffee.",
      reason: `${med.drug ?? "This medicine"} works best on an empty stomach — take it now and eat in 30–60 minutes.`,
    };
  }
  return {
    verdict: "ok",
    confidence: 0.9,
    what_i_see: "A plate of rice, chicken and steamed vegetables with a glass of water.",
    reason:
      med.food_rule === "with_food"
        ? "This medicine should be taken with food, and this meal is fine."
        : "No food restrictions for this medicine.",
  };
}

/** Claude Sonnet (CLAUDE_SMART): read a prescription label photo. */
export async function parseRx(imageB64: string, mime: string): Promise<RxFields> {
  void imageB64;
  void mime;
  await delay();
  return {
    drug: "Metformin",
    strength: "500 mg",
    dose: "1 tablet",
    times: ["08:00", "19:00"],
    food_rule: "with_food",
    avoid_foods: ["alcohol"],
    quantity: 60,
    refills: 2,
    warnings: ["Take with meals to reduce stomach upset.", "Avoid excessive alcohol."],
  };
}

/** Claude Haiku (CLAUDE_FAST): one-line visual description of a pill photo. */
export async function describePill(imageB64: string): Promise<string> {
  void imageB64;
  await delay();
  return "white oblong film-coated tablet, imprint \"500\" on one side, scored on the other";
}

/** Claude Haiku (CLAUDE_FAST, cached): classify an inbound iMessage. */
export async function classifyMessage(text: string): Promise<ClassifiedMessage> {
  await delay();
  const t = text.toLowerCase();
  const spanish = /\b(ya|tomé|pastilla|dolor|mareada|mareado|hola|gracias|sí)\b/.test(t);
  const redFlag = /(chest|pecho|can't breathe|no puedo respirar|fell|me caí|faint|desmay)/.test(t);
  const symptom = redFlag || /(dizzy|mareada|mareado|pain|dolor|nause|náusea)/.test(t);
  const taken = /(took|taken|done|ya la tomé|tomé|listo)/.test(t);
  return {
    language: spanish ? "es" : "en",
    english: spanish ? "(stub translation) " + text : text,
    intent: symptom ? "symptom" : taken ? "dose_taken" : "other",
    red_flag: redFlag,
  };
}

/** Claude Haiku (CLAUDE_FAST, cached): translate text into `lang`. */
export async function translate(text: string, lang: string): Promise<string> {
  await delay();
  if (lang === "en") return text;
  return `[${lang}] ${text}`;
}

/** Claude Sonnet (CLAUDE_SMART): structured check-in from a call transcript. */
export async function extractCheckIn(
  transcript: string,
  visionEvents: VisionEvent[],
  meds: MedicationRow[],
): Promise<CheckInExtract> {
  void transcript;
  await delay();
  const wrongPill = visionEvents.some((e) => e.kind === "pill" && e.verdict === "mismatch");
  const drug = meds[0]?.drug ?? "her morning pill";
  return {
    summary: wrongPill
      ? `Patient first picked up the wrong pill; Pal caught it and she then took ${drug} correctly. Mild dizziness this morning.`
      : `Patient took ${drug} on camera with breakfast. In good spirits; mentions mild dizziness after standing up.`,
    mood: 4,
    symptoms: [{ name: "dizziness", severity: "mild", quote: "Me mareé un poco al levantarme." }],
    visual_notes: [
      "Alert and well-groomed",
      wrongPill ? "Initially held the wrong tablet" : "Took correct tablet with water",
    ],
    quotes: [
      { original: "Me mareé un poco al levantarme.", english: "I got a little dizzy when I stood up." },
      { original: "Mi nieta viene el domingo.", english: "My granddaughter is coming on Sunday." },
    ],
    risk_level: "yellow",
  };
}

/** Claude Sonnet (CLAUDE_SMART): weekly doctor brief. */
export async function weeklyBrief(data: WeeklyBriefData): Promise<Brief> {
  await delay();
  const taken = data.dose_events.filter((d) => d.status === "taken").length || 12;
  const missed = data.dose_events.filter((d) => d.status === "missed").length || 1;
  const caught = data.dose_events.filter((d) => d.status === "wrong_pill_caught").length || 1;
  const total = taken + missed;
  return {
    patient_id: data.patient.id,
    week_start: data.week_start,
    adherence_pct: Math.round((taken / total) * 100),
    doses_taken: taken,
    doses_missed: missed,
    wrong_pills_caught: caught,
    mood_trend: [4, 4, 3, 4, 5, 4, 4],
    symptoms: [{ name: "dizziness", severity: "mild", quote: "Me mareé un poco al levantarme." }],
    quotes: [{ original: "Me siento bien hoy.", english: "I feel good today." }],
    concerns: ["Mild morning dizziness reported on 3 of 7 days — consider orthostatic BP check."],
    summary: `${data.patient.preferred_name ?? data.patient.name ?? "Patient"} took ${taken} of ${total} scheduled doses this week. One wrong-pill attempt was caught on camera. Mood stable; recurring mild dizziness on standing.`,
  };
}

/** Claude Sonnet (CLAUDE_SMART): patient-facing dose-change message in their language. */
export async function doseChangeMessage(
  patient: PatientRow,
  change: DoseChange,
): Promise<DoseChangeMessage> {
  await delay();
  const name = patient.preferred_name ?? patient.name ?? "";
  const english = `Hi ${name}, Dr. ${patient.doctor_name ?? "your doctor"} changed your ${change.drug} from ${change.old_dose} to ${change.new_dose}. ${change.doctor_note}`;
  const patientText =
    patient.language === "es"
      ? `Hola ${name}, el Dr. ${patient.doctor_name ?? "su médico"} cambió su ${change.drug} de ${change.old_dose} a ${change.new_dose}. ${change.doctor_note}`
      : english;
  return { patient_text: patientText, english_text: english };
}

/** Gemini 2.5 Flash (free): transcribe a voice memo. */
export async function transcribe(wavBuffer: Buffer): Promise<Transcription> {
  void wavBuffer;
  await delay();
  return {
    language: "es",
    transcript: "Ya me tomé la pastilla de la mañana, gracias.",
    english: "I already took my morning pill, thank you.",
  };
}

/** Gemini 2.5 Flash TTS (free, disk cache): mono PCM WAV for Chert voice notes. Stub = 1 s of silence. */
export async function tts(text: string, lang: string): Promise<Buffer> {
  void text;
  void lang;
  await delay();
  return silentWav(1, 24000);
}

function silentWav(seconds: number, sampleRate: number): Buffer {
  const numSamples = Math.round(seconds * sampleRate);
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}
