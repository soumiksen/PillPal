"use client";
// The week as a 7-day pill organizer: one compartment per day and time of day.
// A lid opens when every dose in it is confirmed; colour always comes with an icon and a word.
import { Check, Clock3, Heart, ShieldAlert, Video, X } from "lucide-react";
import type { DoseEvent, Medication } from "@/lib/types";
import { cn } from "./ui";

export type Slot = "morning" | "midday" | "evening";
export const SLOTS: { key: Slot; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "midday", label: "Midday" },
  { key: "evening", label: "Evening" },
];

export const slotOf = (hours: number): Slot => (hours < 11 ? "morning" : hours < 16 ? "midday" : "evening");
const slotOfTime = (hhmm: string) => slotOf(Number(hhmm.split(":")[0]));

export type CompartmentState = "taken" | "caught" | "missed" | "due" | "empty";

/** Worst status wins: missed, then wrong pill caught, then due; all taken opens the lid. */
export function compartmentState(doses: DoseEvent[]): CompartmentState {
  if (doses.length === 0) return "empty";
  if (doses.some((d) => d.status === "missed")) return "missed";
  if (doses.some((d) => d.status === "wrong_pill_caught")) return "caught";
  if (doses.some((d) => d.status === "pending" || d.status === "skipped")) return "due";
  return "taken";
}

export interface Day {
  date: Date;
  key: string;
  isToday: boolean;
}

/** The 7 days ending today, oldest first. */
export function lastSevenDays(): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return { date: d, key: d.toDateString(), isToday: i === 6 };
  });
}

export function groupWeek(week: DoseEvent[]) {
  const map = new Map<string, DoseEvent[]>();
  for (const d of week) {
    const t = new Date(d.scheduled_at);
    const k = `${t.toDateString()}|${slotOf(t.getHours())}`;
    map.set(k, [...(map.get(k) ?? []), d]);
  }
  return (day: Day, slot: Slot) => (map.get(`${day.key}|${slot}`) ?? []).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

/** Lids opened so far this week: compartments that are fully taken / compartments that are already due. */
export function weekStats(week: DoseEvent[]) {
  const days = lastSevenDays();
  const get = groupWeek(week);
  let opened = 0;
  let due = 0;
  let missed = 0;
  let caught = 0;
  for (const day of days)
    for (const s of SLOTS) {
      const st = compartmentState(get(day, s.key));
      if (st === "empty" || st === "due") continue;
      due++;
      if (st === "taken") opened++;
      if (st === "missed") missed++;
      if (st === "caught") caught++;
    }
  return { opened, due, missed, caught };
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const LOOK: Record<Exclude<CompartmentState, "empty">, { word: string; Icon: typeof Check; lid: string; tub: string; text: string; badge: string }> = {
  taken: { word: "Taken", Icon: Check, lid: "bg-ok", tub: "bg-ok-wash border-ok/30", text: "text-ok", badge: "bg-ok text-white" },
  caught: { word: "Wrong pill caught", Icon: ShieldAlert, lid: "bg-[#F59E0B]", tub: "bg-caught-wash border-[#FCD34D]", text: "text-caught", badge: "bg-[#D97706] text-white" },
  missed: {
    word: "Missed",
    Icon: X,
    lid: "",
    tub: "border-missed border-2 bg-[repeating-linear-gradient(135deg,#FCA5A5_0_8px,#FECACA_8px_16px)]",
    text: "text-missed",
    badge: "bg-missed text-white",
  },
  due: { word: "Due", Icon: Clock3, lid: "", tub: "bg-[linear-gradient(#E6EAE3,#D5DBD1)] border-transparent", text: "text-ink", badge: "bg-ink text-white" },
};

function Via({ doses }: { doses: DoseEvent[] }) {
  const ways = [...new Set(doses.filter((d) => d.status === "taken").map((d) => d.confirmed_via))];
  const ft = ways.includes("facetime");
  const heart = ways.includes("tapback");
  if (!ft && !heart) return null;
  // One way: icon + word. Both: icons only, so narrow compartments don't overflow.
  const both = ft && heart;
  return (
    <span className="flex w-full items-center justify-center gap-1.5 text-[12px] font-semibold text-ink-soft" title={[ft && "Seen on FaceTime", heart && "Confirmed with ❤ on iMessage"].filter(Boolean).join(" · ")}>
      {ft ? (
        <span className="inline-flex items-center gap-0.5">
          <Video className="size-3.5" aria-hidden />
          <span className={both ? "sr-only" : "sr-only @[5.5rem]:not-sr-only"}>FaceTime</span>
        </span>
      ) : null}
      {heart ? (
        <span className="inline-flex items-center gap-0.5">
          <Heart className="size-3.5" aria-hidden />
          <span className={both ? "sr-only" : "sr-only @[5.5rem]:not-sr-only"}>iMessage</span>
        </span>
      ) : null}
    </span>
  );
}

function Compartment({
  doses,
  meds,
  day,
  slotLabel,
  isNext,
  compact,
}: {
  doses: DoseEvent[];
  meds: Medication[];
  day: Day;
  slotLabel: string;
  isNext: boolean;
  compact: boolean;
}) {
  const state = compartmentState(doses);
  const names = doses.map((d) => meds.find((m) => m.id === d.medication_id)?.drug ?? "Medicine");
  const dayName = day.isToday ? "Today" : day.date.toLocaleDateString("en-US", { weekday: "long" });

  if (state === "empty")
    return (
      <div className={cn("rounded-[14px] border-2 border-dashed border-line", compact ? "h-9" : "h-[112px]")} aria-label={`${dayName} ${slotLabel}: nothing scheduled`} />
    );

  const look = LOOK[state];
  const closed = state === "due" || state === "missed";
  const word = state === "due" && isNext ? `Due ${fmtTime(doses.find((d) => d.status === "pending")?.scheduled_at ?? doses[0].scheduled_at)}` : look.word;
  const label = `${dayName} ${slotLabel}: ${look.word}. ${names.join(", ")}.`;

  if (compact)
    return (
      <div
        title={`${look.word} · ${names.join(", ")}`}
        aria-label={label}
        className={cn("grid h-9 place-items-center rounded-[9px] border", look.tub, state === "taken" && "bg-ok border-ok", state === "caught" && "bg-[#F59E0B] border-[#F59E0B]")}
      >
        <look.Icon className={cn("size-4", state === "taken" || state === "caught" ? "text-white" : look.text)} strokeWidth={3} aria-hidden />
      </div>
    );

  return (
    <div className={cn("relative h-[112px] pt-[22px]", isNext && "rounded-[16px] outline-3 outline-dashed outline-offset-3 outline-teal")} aria-label={label}>
      {/* The lid: tipped open above the compartment, or lying shut over it. */}
      {closed ? null : (
        <span className={cn("absolute inset-x-1 top-0 h-[20px] rounded-t-[10px] rounded-b-[4px] [transform:perspective(220px)_rotateX(48deg)] [transform-origin:bottom]", look.lid)} aria-hidden />
      )}
      <div className={cn("@container absolute inset-x-0 bottom-0 top-[22px] flex flex-col items-center justify-center gap-1 overflow-hidden rounded-[14px] border-2 px-1 text-center", look.tub)}>
        <span className={cn("grid size-6 place-items-center rounded-full", look.badge)} aria-hidden>
          <look.Icon className="size-3.5" strokeWidth={3} />
        </span>
        <span className={cn("text-[13px] font-bold leading-tight", look.text)}>{word}</span>
        {state === "taken" ? <Via doses={doses} /> : null}
        {state === "caught" ? <span className="text-[12px] font-semibold text-ink-soft">on camera</span> : null}
        {closed ? (
          <span className="mt-0.5 flex gap-1" aria-hidden>
            {doses.map((d) => (
              <span key={d.id} className="h-2.5 w-5 rounded-full border border-ink/10 bg-[linear-gradient(90deg,#fff_50%,#F9A8D4_50%)]" />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function PillBox({ week, meds, compact = false, className }: { week: DoseEvent[]; meds: Medication[]; compact?: boolean; className?: string }) {
  const days = lastSevenDays();
  const get = groupWeek(week);
  const today = days[6];
  const nextSlot = SLOTS.find((s) => compartmentState(get(today, s.key)) === "due")?.key;

  const medsIn = (slot: Slot) => [...new Set(meds.filter((m) => m.times.some((t) => slotOfTime(t) === slot)).map((m) => m.drug))];

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className={cn("w-full border-separate", compact ? "min-w-[480px] border-spacing-[5px]" : "min-w-[640px] border-spacing-[10px]")}>
        <caption className="sr-only">This week&apos;s pill box: one compartment per day and time of day</caption>
        <thead>
          <tr>
            <td className={compact ? "w-[70px]" : "w-[118px]"} />
            {days.map((d) => (
              <th key={d.key} scope="col" className={cn("text-center", d.isToday && "text-teal")}>
                <span className={cn("block font-display font-bold", compact ? "text-[14px]" : "text-[20px]")}>
                  {d.date.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                {compact ? null : (
                  <span className={cn("block text-[13px] font-semibold", d.isToday ? "text-teal" : "text-ink-faint")}>
                    {d.isToday ? "Today" : d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((s) => {
            const names = medsIn(s.key);
            if (names.length === 0 && !days.some((d) => get(d, s.key).length)) return null;
            return (
              <tr key={s.key}>
                <th scope="row" className="pr-1 text-left align-middle">
                  <span className={cn("block font-bold", compact ? "text-[14px]" : "text-[16px]")}>{s.label}</span>
                  {compact ? null : <span className="block text-[13px] font-medium leading-snug text-ink-faint">{names.join(", ")}</span>}
                </th>
                {days.map((d) => (
                  <td key={d.key} className="p-0">
                    <Compartment doses={get(d, s.key)} meds={meds} day={d} slotLabel={s.label.toLowerCase()} isNext={d.isToday && s.key === nextSlot} compact={compact} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PillBoxLegend() {
  const items: { cls: string; text: string; Icon: typeof Check }[] = [
    { cls: "bg-ok", text: "Taken: lid open, empty", Icon: Check },
    { cls: "bg-[#F59E0B]", text: "Wrong pill caught on camera", Icon: ShieldAlert },
    { cls: "border-2 border-missed bg-[repeating-linear-gradient(135deg,#FCA5A5_0_6px,#FECACA_6px_12px)]", text: "Missed: pills still inside", Icon: X },
    { cls: "bg-[#D5DBD1]", text: "Due: lid closed", Icon: Clock3 },
  ];
  return (
    <ul className="grid gap-2.5 text-[15px]">
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-3">
          <span className={cn("grid h-5 w-8 shrink-0 place-items-center rounded-[6px]", i.cls)} aria-hidden />
          <i.Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
          {i.text}
        </li>
      ))}
    </ul>
  );
}
