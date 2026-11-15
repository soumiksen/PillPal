"use client";
import { useState } from "react";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { joinPatient, rememberPatient } from "@/lib/account";
import { Button, Input, Panel } from "./ui";

/** Add a patient to your account with the code their caregiver shared. */
export function JoinByCode({ onJoined, title = "Add a patient with a code", hint }: { onJoined?: (patientId: string) => void; title?: string; hint?: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const r = await joinPatient(code);
    setBusy(false);
    if (r.error || !r.patientId) return setError(r.error ?? "Couldn't add that patient.");
    rememberPatient(r.patientId);
    toast.success("Patient added to your account");
    setCode("");
    onJoined?.(r.patientId);
  }

  return (
    <Panel className="p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
        <UserPlus className="size-5 text-teal" aria-hidden /> {title}
      </h2>
      <p className="mt-1 text-ink-soft">{hint ?? "Ask the patient's caregiver for the 6-character code on their PillPal page."}</p>
      <form onSubmit={submit} className="mt-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="join-code">
          Patient code
        </label>
        <Input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. 7F3A2C"
          maxLength={12}
          autoComplete="off"
          className="max-w-[220px] font-display text-lg tracking-[0.2em] uppercase"
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          <KeyRound className="size-4" aria-hidden /> {busy ? "Adding…" : "Add patient"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 font-semibold text-missed">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}

/** The caregiver's share code, so a doctor or family member can join this patient's care team. */
export function ShareCode({ code, patientName }: { code: string | null; patientName: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <Panel className="p-6">
      <h2 className="font-display text-xl font-semibold">Share with {patientName}&apos;s doctor</h2>
      <p className="mt-1 text-ink-soft">They sign up as a doctor on PillPal and enter this code to see {patientName}&apos;s week.</p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] bg-mist px-4 py-3">
        <span className="font-display text-[30px] font-bold tracking-[0.25em] tabular" aria-label={`Code ${code.split("").join(" ")}`}>
          {code}
        </span>
        <Button
          size="sm"
          variant="quiet"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Couldn't copy. Select the code instead.");
            }
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Panel>
  );
}
