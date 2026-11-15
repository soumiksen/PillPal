/**
 * Decides Helen's expression over time: agent state + tool events + idle life (blinks, breathing, gaze drift).
 * Pure logic, no I/O (the optional mouth level is read through a callback). Visual only: it must never affect what Pal says or does.
 */
import { NEUTRAL, PRESETS, type ExpressionName, type Rig } from "./rig.js";

export type AgentState = "initializing" | "idle" | "listening" | "thinking" | "speaking";

const KEYS = Object.keys(NEUTRAL) as (keyof Rig)[];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class AvatarController {
  private cur: Rig = { ...NEUTRAL };
  private state: AgentState = "initializing";
  private hold: { name: ExpressionName; until: number } | null = null; // tool-driven override
  private t = 0;
  private nextBlink = rnd(2, 5);
  private blinkLeft = 0;
  private nextGaze = rnd(1.5, 3);
  private gazeDrift = { x: 0, y: 0 };
  private nextNod = rnd(4, 7);
  private nodLeft = 0;
  private syl = { open: 0, wide: 0, next: 0 };
  private greeted = false;
  private expr: ExpressionName = "smile";
  private mouthLevel: (() => number | null) | null = null;
  private wideHold = { v: 0, next: 0 };

  /** The preset currently showing (portrait mode draws its frame). */
  get expression(): ExpressionName {
    return this.expr;
  }

  /** Drive the mouth from Pal's real audio (0..1, or null when nothing is playing). */
  setMouthLevel(fn: (() => number | null) | null) {
    this.mouthLevel = fn;
  }

  setState(s: AgentState) {
    this.state = s;
  }

  /** Show an expression for ms (undefined = until clear()). */
  show(name: ExpressionName, ms?: number) {
    this.hold = { name, until: ms === undefined ? Number.POSITIVE_INFINITY : this.t + ms / 1000 };
  }

  clear() {
    this.hold = null;
  }

  /** One small head nod now (scripted video mode). */
  nod() {
    this.nodLeft = 0.5;
  }

  /** Called when the call becomes live. */
  hello() {
    this.greeted = true;
    this.show("smile", 2500);
  }

  private baseName(): ExpressionName {
    if (this.hold && this.t < this.hold.until) return this.hold.name;
    this.hold = null;
    switch (this.state) {
      case "listening":
        return "listening";
      case "thinking":
        return "thinking";
      case "speaking":
        return "neutral";
      default:
        return this.greeted ? "neutral" : "smile";
    }
  }

  /** Advance dt seconds and return the rig to draw. */
  tick(dt: number): Rig {
    this.t += dt;
    this.expr = this.baseName();
    const target: Rig = { ...PRESETS[this.expr] };

    // idle life
    target.breath = 0.5 + 0.5 * Math.sin(this.t * 1.6);
    this.nextGaze -= dt;
    if (this.nextGaze <= 0) {
      this.nextGaze = rnd(1.5, 3.5);
      this.gazeDrift = { x: rnd(-0.15, 0.15), y: rnd(-0.1, 0.1) };
    }
    target.gazeX += this.gazeDrift.x;
    target.gazeY += this.gazeDrift.y;
    target.tilt += 0.08 * Math.sin(this.t * 0.7);

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.nextBlink = rnd(2.2, 5.5);
      this.blinkLeft = 0.14;
    }
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      target.eyeOpen = 0;
    }

    // listening nods
    if (this.state === "listening") {
      this.nextNod -= dt;
      if (this.nextNod <= 0) {
        this.nextNod = rnd(4, 8);
        this.nodLeft = 0.5;
      }
    }
    if (this.nodLeft > 0) {
      this.nodLeft -= dt;
      target.nod += 0.6 * Math.sin(((0.5 - this.nodLeft) / 0.5) * Math.PI);
    }

    // speaking: mouth follows Pal's real audio when it is playing; procedural syllables otherwise
    let level: number | null = null;
    try {
      level = this.mouthLevel?.() ?? null;
    } catch {
      level = null;
    }
    if (level !== null) {
      this.wideHold.next -= dt;
      if (this.wideHold.next <= 0) {
        this.wideHold.next = rnd(0.12, 0.26);
        this.wideHold.v = rnd(-0.6, 0.7);
      }
      target.mouthWide = this.wideHold.v * Math.min(1, level * 1.5);
    } else if (this.state === "speaking") {
      this.syl.next -= dt;
      if (this.syl.next <= 0) {
        this.syl.next = rnd(0.07, 0.17);
        const pause = Math.random() < 0.12;
        this.syl.open = pause ? 0.05 : rnd(0.25, 0.85);
        this.syl.wide = rnd(-0.5, 0.6);
      }
      target.mouthOpen = this.syl.open;
      target.mouthWide = this.syl.wide;
    }

    // ease toward the target (mouth and blinks fast, face slower)
    for (const k of KEYS) {
      const fast = k === "mouthOpen" || k === "mouthWide" || k === "eyeOpen";
      const rate = fast ? 28 : 7;
      this.cur[k] += (target[k] - this.cur[k]) * (1 - Math.exp(-rate * dt));
    }
    // the audio envelope is already smoothed (fast attack, slow release): use it as is
    if (level !== null) this.cur.mouthOpen = Math.max(target.mouthOpen, level);
    return this.cur;
  }
}
