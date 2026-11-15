/** Medication times ("HH:MM") are wall-clock times in the patient's zone (demo: America/Chicago). */

export const TZ = "America/Chicago";

type Ymd = { y: number; m: number; d: number };

function parts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Offset of `tz` from UTC at instant `at`, in ms (Chicago: -5h or -6h). */
function offsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Calendar date in `tz` for instant `at`. */
export function zonedDate(at: Date, tz = TZ): Ymd {
  const p = parts(at, tz);
  return { y: p.y, m: p.m, d: p.d };
}

/** Wall-clock `hhmm` on calendar date `day` in `tz` → UTC instant. */
export function zonedTime(day: Ymd, hhmm: string, tz = TZ): Date | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return undefined;
  const guess = Date.UTC(day.y, day.m - 1, day.d, Number(m[1]), Number(m[2]));
  // Two passes handle DST transitions.
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Every scheduled instant for `times` on yesterday/today/tomorrow (zone-local), sorted. */
export function slotsAround(times: string[], now = new Date(), tz = TZ): Date[] {
  const today = zonedDate(now, tz);
  const out: Date[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = addDays(today, offset);
    for (const t of times) {
      const at = zonedTime(day, t, tz);
      if (at) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The scheduled instant closest to `now` (today ± 1 day), or undefined when there are no valid times. */
export function nearestSlot(times: string[] | null | undefined, now = new Date(), tz = TZ): Date | undefined {
  let best: Date | undefined;
  for (const s of slotsAround(times ?? [], now, tz)) {
    if (!best || Math.abs(s.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = s;
  }
  return best;
}

/** Start of the current zone-local day as a UTC instant. */
export function startOfZonedDay(now = new Date(), tz = TZ): Date {
  return zonedTime(zonedDate(now, tz), "00:00", tz)!;
}
