"use client";
import { ArrowLeft, ArrowRight, ChevronRight, Coffee, Languages, PhoneCall, Pill, Utensils, Video } from "lucide-react";
import type { DoseEvent, Medication, Patient } from "@/lib/types";
import { languageName, languageNative } from "@/lib/languages";
import { cn } from "../ui";

const ftHref = (p: string) => `facetime:${p.replace(/[^\d+]/g, "")}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The dark right-hand column: who the patient is, this week, and what's next. */
export function SidePanel({
  patient,
  meds,
  doses,
  weekPct,
  history,
  live,
  calling,
  onCall,
  now,
}: {
  patient: Patient;
  meds: Medication[];
  doses: DoseEvent[];
  weekPct: number;
  history: { day: string; taken: number; total: number }[];
  live: boolean;
  calling: boolean;
  onCall: () => void;
  now: number;
}) {
  const initials = patient.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const native = languageNative(patient.language);
  const upcoming = [...doses]
    .filter((d) => d.status === "pending" || d.status === "wrong_pill_caught")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const nextUp = upcoming.find((d) => new Date(d.scheduled_at).getTime() > now - 60 * 60 * 1000) ?? upcoming[0];

  // Week strip: the last 7 days, today last, coloured by how many doses were confirmed.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const h = history[i];
    return { label: d.toLocaleDateString("en-US", { weekday: "short" }), date: d.getDate(), full: h ? h.total > 0 && h.taken >= h.total : false, today: i === 6 };
  });
  const monthLabel = new Date(now).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <aside className="flex flex-col overflow-hidden rounded-[var(--radius-panel)] bg-char text-white" aria-label={`${patient.preferred_name}'s profile`}>
      {/* Profile */}
      <div className="flex items-center gap-4 border-b border-char-line px-6 py-6">
        <div className="grid size-[72px] shrink-0 place-items-center rounded-full bg-lime font-display text-2xl text-ink ring-4 ring-char-2" aria-hidden>
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-[24px] leading-tight">{patient.name}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2.5 py-1 text-[13px] font-bold text-lime">
              <Pill className="size-3.5" aria-hidden /> {weekPct}% this week
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[13px] font-bold text-white">
              <Languages className="size-3.5" aria-hidden /> {languageName(patient.language)}
              {native && native !== languageName(patient.language) ? <span className="font-medium text-white/60">· {native}</span> : null}
            </span>
          </div>
        </div>
      </div>

      {/* Week strip */}
      <div className="border-b border-char-line px-6 py-5">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg">{monthLabel}</p>
          <span className="flex gap-2 text-white/40" aria-hidden>
            <ArrowLeft className="size-5" />
            <ArrowRight className="size-5" />
          </span>
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1 text-center" aria-label="Doses confirmed this week">
          {days.map((d) => (
            <li
              key={`${d.label}-${d.date}`}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-[16px] py-2",
                d.today ? "bg-lime text-ink ring-4 ring-lime/25" : "text-white/80",
              )}
            >
              <span className={cn("text-[13px]", d.today ? "font-bold" : "text-white/60")}>{d.label}</span>
              <span className="font-display text-lg tabular">{d.date}</span>
              <span
                className={cn("size-1.5 rounded-full", d.today ? "bg-ink" : d.full ? "bg-lime" : "bg-white/25")}
                title={d.full ? "All doses confirmed" : "Some doses missed or pending"}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* Coming up */}
      <div className="flex-1 px-6 py-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg">Coming up today</h2>
          <span className="text-sm font-semibold text-lime">{upcoming.length} left</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-white/70">Every dose is done for today.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {upcoming.map((d) => {
              const med = meds.find((m) => m.id === d.medication_id);
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-[20px] bg-char-2 p-3.5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-char text-lime ring-1 ring-char-line">
                    {med?.food_rule === "with_food" ? <Utensils className="size-5" /> : med?.food_rule === "empty_stomach" ? <Coffee className="size-5" /> : <Pill className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {med?.drug} {med?.strength}
                    </p>
                    <p className="text-sm text-white/65 tabular">
                      {fmtTime(d.scheduled_at)} ·{" "}
                      {med?.food_rule === "with_food" ? "with food" : med?.food_rule === "empty_stomach" ? "empty stomach" : "any time"}
                      {d.status === "wrong_pill_caught" ? " · wrong pill caught" : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-white/40" aria-hidden />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Call card */}
      <div className="relative m-3 mt-0 overflow-hidden rounded-[24px] bg-char-2 p-5">
        <PhoneDoodle />
        <p className="relative text-sm font-bold text-lime">{live ? "On FaceTime now" : "Next check-in call"}</p>
        <p className="relative mt-1 font-display text-[26px] leading-tight">
          {live ? `Pal is with ${patient.preferred_name}` : nextUp ? fmtTime(nextUp.scheduled_at) : "Tomorrow morning"}
        </p>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <button
            onClick={onCall}
            disabled={calling || live}
            className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-[16px] bg-lime px-5 font-bold text-ink hover:bg-lime-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PhoneCall className="size-5" aria-hidden /> {live ? "Calling…" : "Call now"}
          </button>
          <a href={ftHref(patient.phone)} className="inline-flex h-12 items-center gap-2 rounded-[16px] bg-white/10 px-4 font-bold text-white hover:bg-white/15">
            <Video className="size-5" aria-hidden /> FaceTime yourself
          </a>
        </div>
        <p className="relative mt-3 text-sm text-white/60">
          Cared for by {patient.caregiver_name} · {patient.doctor_name}
        </p>
      </div>
    </aside>
  );
}

function PhoneDoodle() {
  return (
    <svg viewBox="0 0 120 140" className="pointer-events-none absolute -right-4 -top-2 h-36 w-32 opacity-15" aria-hidden>
      <rect x="30" y="10" width="70" height="120" rx="16" fill="none" stroke="#A3E635" strokeWidth="5" />
      <circle cx="65" cy="58" r="16" fill="#A3E635" />
      <rect x="45" y="84" width="40" height="22" rx="11" fill="#A3E635" />
    </svg>
  );
}
