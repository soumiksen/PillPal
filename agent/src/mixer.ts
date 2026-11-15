/**
 * Group web calls: the agent session normally hears ONE linked participant. When the caregiver joins the patient's
 * call, Pal must hear both, so this AudioInput mixes every human's microphone into one 24 kHz mono stream.
 * Timer-driven (20 ms frames) with a small per-person jitter buffer; a person who is silent or muted adds zeros.
 * Never logs audio or speech.
 */
import { voice } from "@livekit/agents";
import { AudioFrame, AudioStream, type RemoteTrack } from "@livekit/rtc-node";

export const MIX_RATE = 24_000;
const FRAME_MS = 20;
const FRAME_SAMPLES = (MIX_RATE * FRAME_MS) / 1000; // 480
const PRIME_SAMPLES = (MIX_RATE * 60) / 1000; // 60 ms before a source is mixed in
const MAX_SAMPLES = (MIX_RATE * 300) / 1000; // drop the oldest audio beyond 300 ms of backlog

/** FIFO of PCM16 samples. */
export class SampleQueue {
  private chunks: Int16Array[] = [];
  private head = 0;
  size = 0;
  primed = false;

  push(data: Int16Array): void {
    this.chunks.push(data);
    this.size += data.length;
    while (this.size > MAX_SAMPLES && this.chunks.length > 1) this.dropChunk();
    if (this.size >= PRIME_SAMPLES) this.primed = true;
  }

  private dropChunk(): void {
    const c = this.chunks.shift()!;
    this.size -= c.length - this.head;
    this.head = 0;
  }

  /** Add up to `out.length` samples into `out`. Unprimes when it runs dry. */
  mixInto(out: Int32Array): void {
    if (!this.primed) return;
    let i = 0;
    while (i < out.length && this.chunks.length) {
      const c = this.chunks[0]!;
      const n = Math.min(out.length - i, c.length - this.head);
      for (let k = 0; k < n; k++) out[i + k]! += c[this.head + k]!;
      i += n;
      this.head += n;
      this.size -= n;
      if (this.head >= c.length) {
        this.chunks.shift();
        this.head = 0;
      }
    }
    if (i < out.length) this.primed = false;
  }
}

/** Sum of sources, clipped to PCM16. */
export function mixFrame(sources: Iterable<SampleQueue>, samples = FRAME_SAMPLES): Int16Array {
  const acc = new Int32Array(samples);
  for (const q of sources) q.mixInto(acc);
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.max(-32768, Math.min(32767, acc[i]!));
  return out;
}

export class MixedAudioInput extends voice.AudioInput {
  private sources = new Map<string, { queue: SampleQueue; stream: AudioStream; trackSid: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor() {
    super();
    let produced = 0;
    let t0 = 0;
    const readable = new ReadableStream<AudioFrame>({
      start: (controller) => {
        t0 = performance.now();
        this.timer = setInterval(() => {
          if (this.stopped) return;
          const due = Math.floor((performance.now() - t0) / FRAME_MS);
          // After a long stall (GC, laptop sleep) skip ahead instead of bursting.
          if (due - produced > 25) produced = due - 1;
          while (produced < due) {
            produced++;
            const pcm = mixFrame([...this.sources.values()].map((s) => s.queue));
            try {
              controller.enqueue(new AudioFrame(pcm, MIX_RATE, 1, FRAME_SAMPLES));
            } catch {
              return; // stream closed
            }
          }
        }, 10);
      },
      cancel: () => this.stop(),
    });
    this.multiStream.addInputStream(readable);
  }

  /** Add (or replace) one person's microphone. */
  addTrack(identity: string, track: RemoteTrack, trackSid: string): void {
    const prev = this.sources.get(identity);
    if (prev?.trackSid === trackSid) return;
    if (prev) this.removeTrack(identity);
    const stream = new AudioStream(track, { sampleRate: MIX_RATE, numChannels: 1 });
    const queue = new SampleQueue();
    this.sources.set(identity, { queue, stream, trackSid });
    void (async () => {
      try {
        for await (const frame of stream) {
          if (this.sources.get(identity)?.stream !== stream) break;
          queue.push(frame.data);
        }
      } catch {
        /* track ended */
      }
    })();
  }

  removeTrack(identity: string): void {
    const s = this.sources.get(identity);
    if (!s) return;
    this.sources.delete(identity);
    void s.stream.cancel().catch(() => undefined);
  }

  has(identity: string): boolean {
    return this.sources.has(identity);
  }

  private stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.sources.keys()]) this.removeTrack(id);
  }

  override async close(): Promise<void> {
    this.stop();
    await super.close();
  }
}
