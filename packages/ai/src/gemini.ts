/** Gemini (free tier) — voice-memo transcription and TTS only (CLAUDE.md). Never logs content. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { Transcription } from "@pillpal/shared";
import { pcmToWav } from "./stubs.js";

export const hasGemini = () => Boolean(process.env.GOOGLE_API_KEY);

let _ai: GoogleGenAI | undefined;
const ai = () => (_ai ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY }));

const STT_MODEL = () => process.env.GEMINI_STT_MODEL ?? "gemini-2.5-flash";
const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-tts";
const TTS_VOICE = () => process.env.GEMINI_TTS_VOICE ?? "Kore";

export async function geminiTranscribe(wav: Buffer): Promise<Transcription> {
  const res = await ai().models.generateContent({
    model: STT_MODEL(),
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
          {
            text:
              "Transcribe this voice memo from a patient exactly as spoken. Return JSON: language = ISO 639-1 code of the " +
              "spoken language, transcript = verbatim text in the original language, english = faithful English translation " +
              "(same as transcript if already English). If there is no intelligible speech, use empty strings and language \"en\".",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          language: { type: Type.STRING },
          transcript: { type: Type.STRING },
          english: { type: Type.STRING },
        },
        required: ["language", "transcript", "english"],
      },
    },
  });
  return Transcription.parse(JSON.parse(res.text ?? "{}"));
}

const cacheDir = () => path.resolve(process.env.TTS_CACHE_DIR ?? "tts-cache");
const inflight = new Map<string, Promise<Buffer>>();

export function geminiTts(text: string, lang: string): Promise<Buffer> {
  const key = createHash("sha256").update(`${TTS_VOICE()}\u0000${lang}\u0000${text}`).digest("hex");
  let p = inflight.get(key);
  if (!p) {
    p = ttsCached(key, text, lang).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function ttsCached(key: string, text: string, lang: string): Promise<Buffer> {
  const file = path.join(cacheDir(), `${key}.wav`);
  try {
    return await readFile(file);
  } catch {
    /* cache miss */
  }
  const wav = await synthesize(text, lang);
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(file, wav);
  return wav;
}

/** Newer TTS models use the Interactions API (returns a complete WAV); older ones return raw PCM via generateContent. */
async function synthesize(text: string, lang: string): Promise<Buffer> {
  const client = ai();
  try {
    const it = await (client as unknown as {
      interactions: { create: (p: unknown) => Promise<{ output_audio?: { data?: string } }> };
    }).interactions.create({
      model: TTS_MODEL(),
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: TTS_VOICE() }] },
    });
    const data = it.output_audio?.data;
    if (data) {
      const buf = Buffer.from(data, "base64");
      return buf.subarray(0, 4).toString() === "RIFF" ? buf : pcmToWav(buf, 24000);
    }
  } catch {
    /* fall through to the legacy path */
  }
  const res = await client.models.generateContent({
    model: process.env.GEMINI_TTS_FALLBACK_MODEL ?? "gemini-2.5-flash-preview-tts",
    contents: [{ role: "user", parts: [{ text: `Say warmly and slowly (language: ${lang}): ${text}` }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE() } } },
    },
  });
  const pcm = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!pcm) throw new Error("Gemini TTS returned no audio");
  return pcmToWav(Buffer.from(pcm, "base64"), 24000);
}
