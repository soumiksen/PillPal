/**
 * Mouth level from Pal's real voice. MouthTapOutput sits at the head of the session's audio output chain and
 * forwards every call unchanged; it only reads sample values. Frames are pushed faster than real time, so each
 * 10 ms chunk's loudness is scheduled on a playout clock and read back when it is actually heard.
 * Visual only: nothing here can delay, drop or alter audio.
 */
import { voice } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";

const CHUNK_MS = 10;
const ATTACK_MS = 18;
const RELEASE_MS = 110;
const QUIET_DB = -48; // at or below: mouth closed
const LOUD_DB = -16; // at or above: mouth fully open
const MAX_QUEUE = 3000; // 30 s of chunks; older entries are dropped

export class MouthLevel {
  private q: { t: number; v: number }[] = [];
  private head = 0;
  private cursor = 0; // ms (performance.now) where the next pushed chunk will start playing
  private target = 0;
  private env = 0;
  private lastRead = 0;
  private lastHeard = Number.NEGATIVE_INFINITY;

  constructor(private readonly now: () => number = () => performance.now()) {}

  push(frame: AudioFrame): void {
    const { data, channels, sampleRate } = frame;
    const step = Math.max(1, Math.round((sampleRate * CHUNK_MS) / 1000)) * channels;
    const t0 = this.now();
    if (this.cursor < t0) this.cursor = t0;
    for (let i = 0; i < data.length; i += step) {
      const end = Math.min(data.length, i + step);
      let sum = 0;
      for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
      const rms = Math.sqrt(sum / Math.max(1, end - i)) / 32768;
      const db = 20 * Math.log10(rms + 1e-9);
      const open = Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)));
      this.q.push({ t: this.cursor, v: open ** 0.8 });
      this.cursor += ((end - i) / channels / sampleRate) * 1000;
    }
    if (this.q.length - this.head > MAX_QUEUE) this.head = this.q.length - MAX_QUEUE;
    if (this.head > 4096) {
      this.q = this.q.slice(this.head);
      this.head = 0;
    }
  }

  /** Playback was cut (interruption) or paused: nothing queued will be heard. */
  clear(): void {
    this.q = [];
    this.head = 0;
    this.cursor = 0;
    this.target = 0;
  }

  /** Smoothed openness 0..1 at the current playout time, or null when Pal's audio is not playing. */
  read(): number | null {
    const now = this.now();
    while (this.head < this.q.length && this.q[this.head]!.t <= now) {
      this.target = this.q[this.head++]!.v;
      this.lastHeard = now;
    }
    if (this.head >= this.q.length && now > this.cursor) this.target = 0; // queue played out
    const dt = this.lastRead ? Math.max(0, now - this.lastRead) : 0;
    this.lastRead = now;
    const tau = this.target > this.env ? ATTACK_MS : RELEASE_MS;
    this.env += (this.target - this.env) * (1 - Math.exp(-dt / tau));
    return now - this.lastHeard < 250 ? this.env : null;
  }
}

/**
 * Pass-through AudioOutput. Segment bookkeeping (playout waits, finished counts) is delegated to the next
 * output so wrapping it cannot change when the session thinks speech has finished.
 */
export class MouthTapOutput extends voice.AudioOutput {
  constructor(
    private readonly next: voice.AudioOutput,
    private readonly level: MouthLevel,
  ) {
    super(next.sampleRate, next, { pause: true });
  }

  override async captureFrame(frame: AudioFrame): Promise<void> {
    try {
      this.level.push(frame);
    } catch {
      /* the tap must never affect audio */
    }
    return this.next.captureFrame(frame);
  }

  override flush(): void {
    this.next.flush();
  }

  override clearBuffer(): void {
    this.level.clear();
    this.next.clearBuffer();
  }

  override waitForPlayout(): Promise<voice.PlaybackFinishedEvent> {
    return this.next.waitForPlayout();
  }

  override get pendingPlayoutSegments(): number {
    return this.next.pendingPlayoutSegments;
  }

  override get capturedPlayoutSegments(): number {
    return this.next.capturedPlayoutSegments;
  }

  override abandonOpenSegment(): void {
    this.next.abandonOpenSegment();
  }

  // Finishes come from the next output (wired by the base constructor); re-emit without our own counting.
  override onPlaybackFinished(ev: voice.PlaybackFinishedEvent): void {
    this.emit(voice.AudioOutput.EVENT_PLAYBACK_FINISHED, ev);
  }

  override pause(): void {
    this.level.clear();
    super.pause();
  }
}

/** Wrap the session's current audio output with the tap. Returns false (and changes nothing) if there is none. */
export function installMouthTap(session: voice.AgentSession, level: MouthLevel): boolean {
  const out = session.output.audio;
  if (!out || out instanceof MouthTapOutput) return false;
  session.output.audio = new MouthTapOutput(out, level);
  return true;
}
