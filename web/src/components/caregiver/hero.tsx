"use client";
import { BlisterArt } from "../brand";

export function Hero({ caregiver, patient, taken, total }: { caregiver: string; patient: string; taken: number; total: number }) {
  const pct = total ? Math.round((taken / total) * 100) : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const left = total - taken;
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-panel)] bg-lime px-7 py-7 sm:px-9" aria-label="Today at a glance">
      <BlisterArt className="pointer-events-none absolute -right-24 -top-8 hidden h-[230px] w-[400px] lg:block" />
      <div className="relative max-w-[430px]">
        <h1 className="font-display text-[34px] leading-tight text-ink sm:text-[40px]">
          {greet}, {caregiver}
        </h1>
        <p className="mt-2 text-[18px] text-ink">
          {patient} has taken <b className="font-bold">{taken} of {total}</b> doses today.{" "}
          {left > 0 ? `${left} still to go; Pal will call for each one.` : "All done for today."}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div
            className="h-3.5 w-full max-w-[300px] overflow-hidden rounded-full bg-white/70 ring-2 ring-white"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Doses taken today"
          >
            <div className="h-full rounded-full bg-char transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-display text-lg tabular">{pct}%</span>
        </div>
      </div>
    </section>
  );
}
