"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, HeartHandshake, Stethoscope } from "lucide-react";
import { Mark } from "@/components/brand";
import { Button, Field, Input, cn } from "@/components/ui";

type Role = "caregiver" | "doctor";

const ROLES: { key: Role; title: string; text: string; Icon: typeof Stethoscope; email: string; to: string }[] = [
  {
    key: "caregiver",
    title: "Caregiver",
    text: "See your person's pill box for the week, the live FaceTime check-in, and alerts.",
    Icon: HeartHandshake,
    email: "ana@family.example",
    to: "/caregiver",
  },
  {
    key: "doctor",
    title: "Doctor",
    text: "Pick a patient, read the weekly brief, and change a dose.",
    Icon: Stethoscope,
    email: "dr.patel@clinic.example",
    to: "/doctor",
  },
];

export default function SignIn() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("caregiver");
  const chosen = ROLES.find((r) => r.key === role)!;
  const [emails, setEmails] = useState<Record<Role, string>>({ caregiver: ROLES[0].email, doctor: ROLES[1].email });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <section className="relative hidden overflow-hidden bg-char p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2">
          <Mark className="size-10" />
          <span className="font-display text-[28px] font-bold tracking-[-0.03em]">pillpal</span>
        </div>
        <MiniBox />
        <div>
          <h1 className="max-w-[16ch] font-display text-[clamp(2.6rem,4.4vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
            Every lid opens when the dose is really taken.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[19px] leading-relaxed text-white/75">
            Pal checks in over FaceTime and iMessage, looks at the pill on camera, and fills in the pill box for the family and the doctor.
          </p>
        </div>
      </section>

      <section className="flex flex-col justify-center bg-paper px-6 py-10 sm:px-12">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <Mark className="size-9" />
          <span className="font-display text-[26px] font-bold tracking-[-0.03em]">pillpal</span>
        </div>
        <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight">Sign in</h2>
        <p className="mt-1 text-ink-soft">Who&apos;s signing in today?</p>

        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(chosen.to);
          }}
        >
          <fieldset>
            <legend className="sr-only">I am a</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLES.map((r) => {
                const on = r.key === role;
                return (
                  <label
                    key={r.key}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-2 rounded-[22px] border-2 p-5 transition-colors",
                      on ? "border-ink bg-mint-soft" : "border-line hover:border-ink-faint",
                    )}
                  >
                    <input type="radio" name="role" value={r.key} checked={on} onChange={() => setRole(r.key)} className="sr-only" />
                    <span className={cn("grid size-12 place-items-center rounded-full", on ? "bg-lime text-ink" : "bg-mist text-ink-soft")}>
                      <r.Icon className="size-6" aria-hidden />
                    </span>
                    <span className="font-display text-2xl font-semibold">I&apos;m a {r.title.toLowerCase()}</span>
                    <span className="text-[15px] leading-snug text-ink-soft">{r.text}</span>
                    {on ? <span className="absolute right-4 top-4 size-3 rounded-full bg-ok ring-4 ring-ok-wash" aria-hidden /> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={emails[role]}
              onChange={(e) => setEmails((m) => ({ ...m, [role]: e.target.value }))}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full">
            Continue as {chosen.title.toLowerCase()} <ArrowRight className="size-5" aria-hidden />
          </Button>
          <p className="text-sm text-ink-faint">Demo sign-in: no password needed. You can switch roles any time from the menu.</p>
        </form>

        <p className="mt-8 text-[15px] text-ink-soft">
          New here?{" "}
          <a href="/onboard" className="font-bold text-teal underline-offset-2 hover:underline">
            Set up a new patient
          </a>
        </p>
      </section>
    </div>
  );
}

/** Decorative pill-box strip for the sign-in panel. */
function MiniBox() {
  const cells = ["t", "t", "t", "c", "t", "t", "d"];
  return (
    <div className="my-10 grid max-w-[460px] grid-cols-7 gap-2 rounded-[22px] bg-char-2 p-3" aria-hidden>
      {cells.map((c, i) => (
        <div key={i} className="relative h-20 pt-3">
          {c === "d" ? null : (
            <span className={cn("absolute inset-x-1 top-0 h-3 rounded-t-[8px] [transform:perspective(160px)_rotateX(48deg)] [transform-origin:bottom]", c === "c" ? "bg-[#F59E0B]" : "bg-lime")} />
          )}
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 top-3 rounded-[10px]",
              c === "d" ? "bg-[#4B5448]" : c === "c" ? "bg-[#F59E0B]/25" : "bg-lime/20",
            )}
          />
        </div>
      ))}
    </div>
  );
}
