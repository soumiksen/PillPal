/** Sliding one-hour window counter (shared-line plan: 100 messages/hour per project; we stop at 90). */
import { HTTPException } from "hono/http-exception";

export class RateLimitedError extends HTTPException {
  constructor(what: string, max: number) {
    super(429, { message: `${what}_rate_limited` });
    this.name = "RateLimitedError";
    console.warn(`[rate-guard] ${what}: hourly limit of ${max} reached, message NOT sent`);
  }
}

export class HourlyRateGuard {
  private readonly stamps: number[] = [];

  constructor(
    private readonly what: string,
    readonly max: number,
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.stamps.length && this.stamps[0]! <= cutoff) this.stamps.shift();
  }

  /** Records one use, or throws RateLimitedError (→ 429) when the window is full. */
  take(): void {
    this.prune();
    if (this.stamps.length >= this.max) throw new RateLimitedError(this.what, this.max);
    this.stamps.push(this.now());
  }

  get used(): number {
    this.prune();
    return this.stamps.length;
  }
}
