"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleAlert, Languages, Search, UserRound } from "lucide-react";
import { usePatients, type RosterEntry } from "@/lib/usePatients";
import { languageName } from "@/lib/languages";
import { compartmentState, lastSevenDays, weekStats, type CompartmentState } from "@/components/pillbox";
import { Input, Panel, cn } from "@/components/ui";

const DAY_CLS: Record<CompartmentState, string> = {
  taken: "bg-ok",
  caught: "bg-[#F59E0B]",
  missed: "border-2 border-missed bg-[repeating-linear-gradient(135deg,#FCA5A5_0_5px,#FECACA_5px_10px)]",
  due: "bg-[#D5DBD1]",
  empty: "border-2 border-dashed border-line",
};
const DAY_WORD: Record<CompartmentState, string> = { taken: "all taken", caught: "wrong pill caught", missed: "missed a dose", due: "doses still due", empty: "nothing scheduled" };

function summarize(e: RosterEntry) {
  const s = weekStats(e.week);
  const pct = s.due ? Math.round((s.opened / s.due) * 100) : 100;
  const days = lastSevenDays().map((day) => ({
    day,
    state: compartmentState(e.week.filter((x) => new Date(x.scheduled_at).toDateString() === day.key)),
  }));
  const needs = e.openAlerts.length > 0 || pct < 80;
  return { ...s, pct, days, needs };
}

export default function DoctorPatientsPage() {
  const { patients, loading, error } = usePatients();
  const [q, setQ] = useState("");

  const rows = patients
    .map((e) => ({ e, s: summarize(e) }))
    .filter(({ e }) => e.patient.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(b.s.needs) - Number(a.s.needs) || a.s.pct - b.s.pct);
  const doctor = patients[0]?.patient.doctor_name;
  const needCount = rows.filter((r) => r.s.needs).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-soft">{doctor ? `Signed in as ${doctor}` : "Doctor review"}</p>
          <h1 className="mt-1 font-display text-[38px] font-semibold leading-tight tracking-tight">Your patients</h1>
          {!loading ? (
            <p className="mt-1 text-ink-soft">
              {patients.length} patient{patients.length === 1 ? "" : "s"} · {needCount} need{needCount === 1 ? "s" : ""} a look this week
            </p>
          ) : null}
        </div>
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Find a patient</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a patient" className="pl-10" />
        </label>
      </div>

      {error ? <p className="rounded-[14px] bg-caught-wash px-4 py-2 text-caught">{error}</p> : null}
      {loading ? <p className="text-ink-soft">Loading your patients…</p> : null}
      {!loading && rows.length === 0 ? (
        <Panel className="p-7">
          <p className="font-display text-2xl font-semibold">{q ? "No patient by that name" : "No patients yet"}</p>
          <p className="mt-1 text-ink-soft">Patients appear here once a caregiver sets them up.</p>
        </Panel>
      ) : null}

      <ul className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ e, s }) => {
          const p = e.patient;
          const initials = p.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
          return (
            <li key={p.id}>
              <Link
                href={`/doctor/${p.id}`}
                className={cn(
                  "group flex h-full flex-col gap-4 rounded-[var(--radius-panel)] bg-paper p-6 transition-shadow hover:shadow-[var(--shadow-lift)] hover:ring-2 hover:ring-lime",
                  s.needs && "ring-2 ring-caught/30",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <span className="grid size-14 shrink-0 place-items-center rounded-full bg-mint font-display text-xl font-semibold text-teal-deep" aria-hidden>
                      {initials || <UserRound className="size-6" />}
                    </span>
                    <div>
                      <p className="font-display text-[24px] font-semibold leading-tight">{p.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[15px] text-ink-soft">
                        <span className="inline-flex items-center gap-1">
                          <Languages className="size-3.5" aria-hidden /> {languageName(p.language)}
                        </span>
                        <span>Caregiver: {p.caregiver_name}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn("font-display text-[32px] font-bold leading-none tabular", s.pct < 80 && "text-missed")}>{s.pct}%</p>
                    <p className="text-sm text-ink-faint">doses taken</p>
                  </div>
                </div>

                <div>
                  <ol className="grid grid-cols-7 gap-1.5" aria-label="Last 7 days">
                    {s.days.map(({ day, state }) => (
                      <li key={day.key} className="flex flex-col items-center gap-1">
                        <span className={cn("h-6 w-full rounded-[7px]", DAY_CLS[state])} aria-hidden />
                        <span className={cn("text-xs font-semibold", day.isToday ? "text-teal" : "text-ink-faint")}>
                          {day.isToday ? "Today" : day.date.toLocaleDateString("en-US", { weekday: "short" })}
                          <span className="sr-only">: {DAY_WORD[state]}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="flex flex-wrap gap-2 text-sm font-semibold">
                  {e.openAlerts.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-caught-wash px-2.5 py-1 text-caught">
                      <CircleAlert className="size-4" aria-hidden /> {a.reason}
                    </span>
                  ))}
                  {s.missed ? <span className="rounded-full bg-missed-wash px-2.5 py-1 text-missed">{s.missed} missed</span> : null}
                  {s.caught ? <span className="rounded-full bg-caught-wash px-2.5 py-1 text-caught">{s.caught} wrong pill caught</span> : null}
                  {!s.needs && !s.missed && !s.caught ? <span className="rounded-full bg-ok-wash px-2.5 py-1 text-ok">On track</span> : null}
                </div>

                {e.lastCheckIn ? <p className="line-clamp-2 text-[15px] text-ink-soft">{e.lastCheckIn.summary}</p> : null}

                <span className="mt-auto inline-flex items-center gap-1 font-bold text-teal group-hover:gap-2">
                  Open {p.preferred_name}&apos;s week <ChevronRight className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
