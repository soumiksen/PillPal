import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeLogger, voice } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { MouthLevel, MouthTapOutput } from "./avatar/audio-tap.js";

initializeLogger({ pretty: false, level: "warn" });

/** A downstream sink that records what it gets and finishes a segment on flush, like the room output. */
class Sink extends voice.AudioOutput {
  frames: AudioFrame[] = [];
  flushes = 0;
  clears = 0;
  constructor() {
    super(24000);
  }
  override async captureFrame(f: AudioFrame) {
    await super.captureFrame(f);
    this.frames.push(f);
  }
  override flush() {
    super.flush();
    this.flushes++;
    this.onPlaybackFinished({ playbackPosition: 0.1, interrupted: false });
  }
  clearBuffer() {
    this.clears++;
  }
}

const tone = (amp: number, ms = 20, sr = 24000) => {
  const n = (sr * ms) / 1000;
  const d = new Int16Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.round(amp * 32767 * Math.sin((2 * Math.PI * 220 * i) / sr));
  return new AudioFrame(d, sr, 1, n);
};

test("tap forwards frames unchanged and leaves playback bookkeeping to the sink", async () => {
  const sink = new Sink();
  const tap = new MouthTapOutput(sink, new MouthLevel());
  const f = tone(0.5);
  const before = Int16Array.from(f.data);
  let finished = 0;
  tap.on(voice.AudioOutput.EVENT_PLAYBACK_FINISHED, () => finished++);

  await tap.captureFrame(f);
  await tap.captureFrame(tone(0.2));
  assert.equal(sink.frames[0], f, "same frame object reaches the sink");
  assert.deepEqual(Int16Array.from(sink.frames[0]!.data), before, "samples untouched");
  assert.equal(tap.capturedPlayoutSegments, sink.capturedPlayoutSegments);
  assert.equal(tap.pendingPlayoutSegments, 1);

  tap.flush();
  assert.equal(sink.flushes, 1);
  assert.equal(finished, 1, "one finish event per segment");
  const ev = await tap.waitForPlayout();
  assert.equal(ev.interrupted, false);
  assert.equal(tap.pendingPlayoutSegments, 0);

  tap.clearBuffer();
  assert.equal(sink.clears, 1);
});

test("mouth level follows the audio as it is heard, then goes quiet", () => {
  let now = 1000;
  const lvl = new MouthLevel(() => now);
  assert.equal(lvl.read(), null, "nothing playing");
  for (let i = 0; i < 10; i++) lvl.push(tone(0.6)); // 200 ms queued at once (faster than real time)
  now += 5;
  const early = lvl.read() ?? 0;
  now += 100;
  const mid = lvl.read() ?? 0;
  assert.ok(mid > 0.6, `open while loud audio plays (${mid.toFixed(2)})`);
  assert.ok(mid > early, "envelope rises over time, not all at capture");
  now += 400;
  const after = lvl.read();
  assert.ok(after === null || after < 0.1, "closes once the queued audio has played");

  for (let i = 0; i < 10; i++) lvl.push(tone(0.6));
  lvl.clear(); // interruption
  now += 50;
  assert.ok((lvl.read() ?? 0) < 0.1, "interrupted audio does not move the mouth");
});
