/**
 * npm run video:voices — pre-generate every line in agent/video/script.json with Gemini TTS (@pillpal/ai tts,
 * voice from the script, default "Kore" like live Pal) into agent/video/voices/<id>.wav.
 * Only missing or changed lines are generated (voices/manifest.json keeps a hash of voice + language + text);
 * WAVs of lines that no longer exist are removed. --force regenerates everything. Never prints secrets.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lineHash, loadScript, parseWav, spokenLines, VOICES_DIR } from "../src/video/script.js";

const script = loadScript();
process.env.GEMINI_TTS_VOICE = script.voice;
// @pillpal/ai keeps its own disk cache; ours is the manifest, so keep theirs out of the repo.
process.env.TTS_CACHE_DIR ??= join(tmpdir(), "pillpal-tts-cache");
if (!process.env.GOOGLE_API_KEY) {
  console.error("video:voices needs GOOGLE_API_KEY in the repo-root .env (Gemini TTS).");
  process.exit(1);
}
const { tts } = await import("@pillpal/ai");

mkdirSync(VOICES_DIR, { recursive: true });
const manifestFile = join(VOICES_DIR, "manifest.json");
const manifest: Record<string, string> = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
const force = process.argv.includes("--force");
const lines = spokenLines(script);
let made = 0;
let failed = 0;

for (const { id, text } of lines) {
  const file = join(VOICES_DIR, `${id}.wav`);
  const hash = lineHash(script, text);
  if (!force && manifest[id] === hash && existsSync(file)) {
    console.log(`  ok    ${id}`);
    continue;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const wav = await tts(text, script.language);
      const pcm = parseWav(wav);
      writeFileSync(file, wav);
      manifest[id] = hash;
      writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`  made  ${id} (${(pcm.samples.length / pcm.channels / pcm.sampleRate).toFixed(1)} s)`);
      made++;
      break;
    } catch (err) {
      const limited = err instanceof Error && /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(err.message);
      if (attempt >= (limited ? 5 : 3)) {
        console.error(`  FAIL  ${id}: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`);
        failed++;
        break;
      }
      // Free tier: a few TTS requests per minute. Back off longer when rate-limited.
      await new Promise((r) => setTimeout(r, (limited ? 20_000 : 4000) * attempt));
    }
  }
}

// Drop voices for lines that were removed from the script.
const ids = new Set(lines.map((l) => l.id));
for (const f of readdirSync(VOICES_DIR)) {
  if (f.endsWith(".wav") && !ids.has(f.slice(0, -4))) {
    rmSync(join(VOICES_DIR, f));
    delete manifest[f.slice(0, -4)];
    console.log(`  gone  ${f}`);
  }
}
for (const k of Object.keys(manifest)) if (!ids.has(k)) delete manifest[k];
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
console.log(`video:voices: ${made} generated, ${lines.length - made - failed} unchanged, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
