/**
 * Devpost video script (PAL_MODE=script): the timeline in agent/video/script.json and its pre-recorded voices.
 * Pure data + file helpers; no network, no LLM.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ExpressionName } from "../avatar/rig.js";

/** agent/video (works from src/ under tsx and from dist/ after a build). */
export const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "video");
export const VOICES_DIR = join(VIDEO_DIR, "voices");

const Expr = z.enum(["neutral", "smile", "listening", "thinking", "looking", "pleased", "concerned", "serious", "surprised", "goodbye"]);

export const Step = z.object({
  /** Seconds after the anchor (patient Accept, or caregiver join when on = caregiver_join). */
  at: z.number().min(0),
  on: z.enum(["patient_join", "caregiver_join"]).default("patient_join"),
  id: z.string().regex(/^[a-z0-9-]+$/).optional(),
  say: z.string().min(1).optional(),
  expr: Expr.optional(),
  then: z.object({ after: z.number().min(0), expr: Expr }).optional(),
  nod: z.boolean().optional(),
  action: z.enum(["log_dose", "escalate", "end_call"]).optional(),
  args: z.record(z.string(), z.string()).optional(),
});
export type Step = z.infer<typeof Step>;

export const VideoScript = z.object({
  voice: z.string().default("Kore"),
  language: z.string().default("en"),
  scenes: z.record(z.string(), z.object({ steps: z.array(Step) })),
});
export type VideoScript = z.infer<typeof VideoScript>;

export const SCENE_KINDS = ["video_morning", "video_fall"] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];
export const isSceneKind = (k: unknown): k is SceneKind => SCENE_KINDS.includes(k as SceneKind);

export function loadScript(file = join(VIDEO_DIR, "script.json")): VideoScript {
  const s = VideoScript.parse(JSON.parse(readFileSync(file, "utf8")));
  for (const [name, scene] of Object.entries(s.scenes)) {
    for (const st of scene.steps) {
      if (st.say && !st.id) throw new Error(`script.json: a "say" step in ${name} has no id`);
    }
  }
  return s;
}

/** Every spoken line: id → text. */
export function spokenLines(s: VideoScript): { id: string; text: string }[] {
  return Object.values(s.scenes).flatMap((sc) => sc.steps.filter((st) => st.say && st.id).map((st) => ({ id: st.id!, text: st.say! })));
}

/** Changes whenever the text, voice or language of a line changes (voices/manifest.json). */
export const lineHash = (s: VideoScript, text: string) =>
  createHash("sha256").update(`${s.voice}\u0000${s.language}\u0000${text}`).digest("hex").slice(0, 16);

export type Pcm = { samples: Int16Array; sampleRate: number; channels: number };

/** Minimal RIFF/WAVE reader: 16-bit PCM only. */
export function parseWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt || fmt.bits !== 16) throw new Error("WAV must be 16-bit PCM");
      const len = Math.min(size, buf.length - body);
      const copy = Buffer.from(buf.subarray(body, body + len - (len % 2)));
      return { samples: new Int16Array(copy.buffer, copy.byteOffset, copy.length / 2), sampleRate: fmt.sampleRate, channels: fmt.channels };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

export type { ExpressionName };
