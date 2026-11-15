"use client";
import { Utensils, Ban, Coffee } from "lucide-react";
import type { ConfirmedVia, DoseEvent, Medication } from "@/lib/types";
import { DoseStatusChip, ViaTag, doseTone } from "../status";
import { Panel, cn } from "../ui";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function FoodRule({ rule }: { rule: Medication["food_rule"] }) {
  if (rule === "with_food")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
        <Utensils className="size-3.5" aria-hidden /> With food
      </span>
    );
  if (rule === "empty_stomach")
    return (
      <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
        <Coffee className="size-3.5" aria-hidden /> Empty stomach
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink-faint">
      <Ban className="size-3.5" aria-hidden /> No food rule
    </span>
  );
}

/** A 6 am–10 pm ruler: where today's doses sit, at a glance. */
function DayRuler({ doses }: { doses: DoseEvent[] }) {
  const startH = 6;
  const endH = 22;
  const pos = (iso: string) => {
    const d = new Date(iso);
    const h = d.getHours() + d.getMinutes() / 60;
    return Math.min(100, Math.max(0, ((h - startH) / (endH - startH)) * 100));
  };
  const now = new Date();
  const nowPos = pos(now.toISOString());
  const ticks = [6, 9, 12, 15, 18, 21];
  return (
    <div className="relative mx-1 mb-7 mt-2 h-12" aria-hidden>
      <div className="absolute inset-x-0 top-5 h-[3px] rounded-full bg-line" />
      <div className="absolute top-5 h-[3px] rounded-full bg-teal/40" style={{ width: `${nowPos}%` }} />
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-9 -translate-x-1/2 text-xs text-ink-faint tabular"
          style={{ left: `${((t - startH) / (endH - startH)) * 100}%` }}
        >
          {t === 12 ? "noon" : t < 12 ? `${t} am` : `${t - 12} pm`}
        </span>
      ))}
      <div className="absolute top-1.5 h-7 w-[2px] bg-teal" style={{ left: `${nowPos}%` }}>
        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-teal">now</span>
      </div>
      {doses.map((d) => {
        const tone = doseTone(d.status);
        return (
          <span
            key={d.id}
            className={cn("absolute top-[11px] grid size-[22px] -translate-x-1/2 place-items-center rounded-full ring-3 ring-paper", tone.cls)}
            style={{ left: `${pos(d.scheduled_at)}%` }}
          >
            <tone.Icon className="size-3" />
          </span>
        );
      })}
    </div>
  );
}

export function TodayPanel({ doses, meds, name }: { doses: DoseEvent[]; meds: Medication[]; name: string }) {
  const sorted = [...doses].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const taken = doses.filter((d) => d.status === "taken").length;
  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[26px] font-semibold leading-tight">{name}&apos;s day</h2>
        <p className="text-ink-soft tabular">
          <span className="font-semibold text-ink">{taken}</span> of {doses.length} doses confirmed
        </p>
      </div>
      <DayRuler doses={sorted} />
      <ol className="divide-y divide-line">
        {sorted.map((d) => {
          const med = meds.find((m) => m.id === d.medication_id);
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3.5">
              <time className="w-[74px] shrink-0 font-display text-lg font-semibold tabular" dateTime={d.scheduled_at}>
                {fmtTime(d.scheduled_at)}
              </time>
              <div className="min-w-[180px] flex-1">
                <p className="font-semibold">
                  {med?.drug ?? "Medicine"} <span className="font-normal text-ink-soft">{med?.strength}</span>
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {med ? <FoodRule rule={med.food_rule} /> : null}
                  {d.status === "taken" ? <ViaTag via={d.confirmed_via as ConfirmedVia | null} /> : null}
                </div>
              </div>
              <DoseStatusChip status={d.status} />
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
