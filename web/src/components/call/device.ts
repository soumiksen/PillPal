"use client";
/** Small browser helpers for the phone apps. Every storage/API call is guarded: iOS private mode and old WebKit throw. */

export type CallPrefs = { code: string; patientId: string };

const key = (role: string) => `pillpal-call:${role}`;

export function loadPrefs(role: string): CallPrefs | null {
  try {
    const raw = localStorage.getItem(key(role));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<CallPrefs>;
    return p.code && p.patientId ? { code: p.code, patientId: p.patientId } : null;
  } catch {
    return null;
  }
}

export function savePrefs(role: string, prefs: CallPrefs | null): void {
  try {
    if (prefs) localStorage.setItem(key(role), JSON.stringify(prefs));
    else localStorage.removeItem(key(role));
  } catch {
    /* not persisted: asked again next launch */
  }
}

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

/** Keep the screen on while the app is open; re-acquired whenever the app becomes visible again. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinelLike | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
      if (!wl || stopped) return;
      if (lock && !lock.released) return;
      lock = await wl.request("screen");
    } catch {
      /* not supported or denied: the screen may sleep */
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };
  void acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => undefined);
  };
}

/**
 * Looping ringtone on one <audio> element. iOS only plays media after a tap, so `arm()` must run inside a tap (Start,
 * Decline, End). Before a call joins, `release()` fully stops and unloads it so the ringtone's audio session cannot
 * interfere with the call's echo cancellation; the next tap re-arms it.
 * The only AudioContext ever created is a one-shot unlock that is closed right away (call audio never uses Web Audio).
 */
export class Ringer {
  private el: HTMLAudioElement | null = null;
  private buzz: ReturnType<typeof setInterval> | null = null;
  armed = false;

  /** Call from a tap. → true when the ringtone can play later without a tap. */
  async arm(): Promise<boolean> {
    // play() must start synchronously inside the tap (iOS); the AudioContext unlock runs alongside it.
    const ctxUnlock = unlockAudioOnce();
    if (!this.el) {
      this.el = new Audio("/call/ringtone.wav");
      this.el.loop = true;
      this.el.preload = "auto";
      this.el.setAttribute("playsinline", "true");
    }
    try {
      this.el.muted = true;
      const playing = this.el.play();
      await Promise.all([playing, ctxUnlock]);
      this.el.pause();
      this.el.currentTime = 0;
      this.armed = true;
    } catch {
      this.armed = false;
    } finally {
      if (this.el) this.el.muted = false;
    }
    return this.armed;
  }

  start(): void {
    if (this.el && this.armed) {
      this.el.currentTime = 0;
      void this.el.play().catch(() => undefined);
    }
    const vibrate = () => {
      try {
        navigator.vibrate?.([700, 300, 700]);
      } catch {
        /* unsupported (iPhone) */
      }
    };
    vibrate();
    this.buzz = setInterval(vibrate, 2400);
  }

  stop(): void {
    this.el?.pause();
    if (this.buzz) clearInterval(this.buzz);
    this.buzz = null;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* unsupported */
    }
  }

  /** Stop and unload completely (before joining a call). Needs `arm()` from a tap to ring again. */
  release(): void {
    this.stop();
    const el = this.el;
    this.el = null;
    this.armed = false;
    if (el) {
      el.removeAttribute("src");
      el.load();
    }
  }
}

let unlocked = false;
/** One AudioContext, used once to unlock audio on iOS (a silent buffer), then closed. */
async function unlockAudioOnce(): Promise<void> {
  if (unlocked) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    await ctx.resume().catch(() => undefined);
    await ctx.close().catch(() => undefined);
    unlocked = true;
  } catch {
    /* the <audio> element unlock still applies */
  }
}

/** Mic constraints for calls: the phone's echo canceller on, mono 48 kHz. */
export const CALL_AUDIO = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
} as const;

/** Ask for camera + mic once at Start so Accept connects without a permission prompt. */
export async function primeMedia(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO, video: { facingMode: "user" } });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
