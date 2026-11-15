/** Voice memo → 16 kHz mono WAV via the system ffmpeg (CAF/AAC/Opus in, PCM WAV out). */
import { spawn, spawnSync } from "node:child_process";

let available: boolean | undefined;

export function hasFfmpeg(): boolean {
  if (available === undefined) {
    try {
      available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

export function toWav16kMono(input: Buffer, timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"]);
    const out: Buffer[] = [];
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.resume(); // ffmpeg errors are not logged: they can echo metadata
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    p.stdin.on("error", () => undefined);
    p.stdin.end(input);
  });
}
