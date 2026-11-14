"use client";
import { useState } from "react";
import { BellRing, PhoneCall, Siren, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { api, PATIENT_ID, USE_MOCKS } from "@/lib/api";
import type { Medication } from "@/lib/types";
import { cn } from "./ui";

/** Presenter controls for the live demo. Collapsed by default so judges see the product, not the controls. */
export function DemoBar({ meds, patientName }: { meds: Medication[]; patientName: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const next = meds.find((m) => m.id === "med-metf") ?? meds[0];

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work. Check that the API is running on :8787.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-30 lg:left-[288px]">
      {open ? (
        <div className="arrive flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-paper/95 p-2 shadow-[var(--shadow-lift)] backdrop-blur">
          <span className="px-2 text-sm font-semibold text-ink-faint">Demo</span>
          <DemoButton
            icon={<PhoneCall className="size-4" />}
            label="Start check-in call"
            busy={busy === "dial"}
            onClick={() => run("dial", () => api.dial(PATIENT_ID), `Calling ${patientName} on FaceTime`)}
          />
          {next ? (
            <DemoButton
              icon={<BellRing className="size-4" />}
              label="Send reminder"
              busy={busy === "remind"}
              onClick={() => run("remind", () => api.remind(PATIENT_ID, next.id), `Reminder sent to ${patientName} by iMessage`)}
            />
          ) : null}
          {USE_MOCKS ? (
            <DemoButton
              icon={<Siren className="size-4" />}
              label="Play red flag"
              busy={busy === "esc"}
              onClick={() => run("esc", () => api.simulateEscalation(), "Escalation started")}
            />
          ) : null}
          <button onClick={() => setOpen(false)} className="grid size-9 cursor-pointer place-items-center rounded-full text-ink-faint hover:bg-mist" aria-label="Hide demo controls">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-paper text-ink-faint shadow-[var(--shadow-lift)] hover:text-teal"
          aria-label="Show demo controls"
        >
          <SlidersHorizontal className="size-5" />
        </button>
      )}
    </div>
  );
}

function DemoButton({ icon, label, onClick, busy }: { icon: React.ReactNode; label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={cn("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] bg-mist px-3 text-sm font-semibold hover:bg-mint-soft disabled:opacity-50")}
    >
      {icon}
      {busy ? "Working…" : label}
    </button>
  );
}
