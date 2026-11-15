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

/** Looping ringtone on one <audio> element, unlocked by a tap (iOS plays it later without a gesture). */
export class Ringer {
  private el: HTMLAudioElement | null = null;
  private buzz: ReturnType<typeof setInterval> | null = null;

  async unlock(): Promise<void> {
    if (!this.el) {
      this.el = new Audio("/call/ringtone.wav");
      this.el.loop = true;
      this.el.preload = "auto";
    }
    try {
      this.el.muted = true;
      await this.el.play();
      this.el.pause();
      this.el.currentTime = 0;
    } catch {
      /* will retry on the next tap */
    } finally {
      this.el.muted = false;
    }
  }

  start(): void {
    if (this.el) {
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
}

/** Ask for camera + mic once at Start so Accept connects without a permission prompt. */
export async function primeMedia(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
