"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, HeartHandshake, MailCheck, Stethoscope } from "lucide-react";
import { Mark, Meander, Voyage } from "@/components/brand";
import { Button, Field, Input, cn } from "@/components/ui";
import { USE_MOCKS } from "@/lib/api";
import { homeFor, signIn, signUp, useAccount, type AccountRole } from "@/lib/account";

const ROLES: { key: AccountRole; title: string; text: string; Icon: typeof Stethoscope }[] = [
  { key: "caregiver", title: "Caregiver", text: "Set up your person, see their pill box, the live FaceTime check-in and alerts.", Icon: HeartHandshake },
  { key: "doctor", title: "Doctor", text: "See every patient who shared their code with you, read the brief, change a dose.", Icon: Stethoscope },
];

export default function SignIn() {
  const router = useRouter();
  const account = useAccount();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [role, setRole] = useState<AccountRole>("caregiver");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Already signed in: go straight to your home.
  useEffect(() => {
    if (!USE_MOCKS && account.status === "ready" && account.profile) router.replace(homeFor(account.profile.role));
  }, [account.status, account.profile, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (USE_MOCKS) return router.push(homeFor(role));
    setBusy(true);
    try {
      if (mode === "signin") {
        const r = await signIn(email, password);
        if (r.error) return setError(r.error);
        router.push(homeFor(r.role));
      } else {
        if (password.length < 8) return setError("Use at least 8 characters for the password.");
        const r = await signUp({ name, email, password, role });
        if (r.error) return setError(r.error);
        if (r.needsConfirm) return setSentTo(email.trim());
        router.push(role === "caregiver" ? "/onboard" : "/doctor");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,580px)]">
      <section className="relative hidden overflow-hidden bg-char p-14 pb-56 text-mist lg:flex lg:flex-col lg:justify-between">
        <Meander className="absolute inset-x-0 top-0 text-lime/70" />
        <div className="flex items-center gap-2">
          <Mark className="size-10" />
          <span className="font-display text-[26px] font-bold">pillpal</span>
        </div>
        <MiniBox />
        <div className="relative z-10">
          <p className="mb-3 font-display text-[15px] font-semibold tracking-[0.3em] text-lime">Begin the voyage home</p>
          <h1 className="max-w-[18ch] font-display text-[clamp(2.3rem,3.8vw,3.5rem)] font-semibold leading-[1.1]">
            Every lid opens when the dose is really taken.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[19px] leading-relaxed text-mist/80">
            Pal checks in over FaceTime and iMessage, looks at the pill on camera, and fills in the pill box for the family and the doctor.
          </p>
        </div>
        <Voyage className="pointer-events-none absolute inset-x-0 bottom-0 h-[200px] w-full" />
      </section>

      <section className="flex flex-col justify-center bg-paper px-6 py-10 sm:px-12">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <Mark className="size-9" />
          <span className="font-display text-[24px] font-bold">pillpal</span>
        </div>

        {sentTo ? (
          <div className="flex flex-col gap-3">
            <span className="grid size-14 place-items-center rounded-full bg-lime">
              <MailCheck className="size-7" aria-hidden />
            </span>
            <h2 className="font-display text-[32px] font-semibold leading-tight">Check your email</h2>
            <p className="text-ink-soft">We sent a confirmation link to {sentTo}. Open it, then sign in here.</p>
            <Button variant="quiet" className="mt-2 w-fit" onClick={() => { setSentTo(null); setMode("signin"); }}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <>
            <div role="tablist" aria-label="Account" className="mb-6 grid w-full grid-cols-2 rounded-[16px] bg-mist p-1">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  type="button"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(null); }}
                  className={cn("h-11 cursor-pointer rounded-[12px] font-bold", mode === m ? "bg-paper shadow-sm" : "text-ink-soft hover:text-ink")}
                >
                  {m === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <h2 className="font-display text-[34px] font-semibold leading-tight tracking-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
            <p className="mt-1 text-ink-soft">{mode === "signin" ? "Sign in to your PillPal account." : "Who are you signing up as?"}</p>

            <form className="mt-6 flex flex-col gap-5" onSubmit={submit}>
              {mode === "signup" || USE_MOCKS ? (
                <fieldset>
                  <legend className="sr-only">I am a</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ROLES.map((r) => {
                      const on = r.key === role;
                      return (
                        <label
                          key={r.key}
                          className={cn(
                            "relative flex cursor-pointer flex-col gap-2 rounded-[22px] border-2 p-5 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-teal",
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
              ) : null}

              {USE_MOCKS ? null : (
                <>
                  {mode === "signup" ? (
                    <Field label="Your name" htmlFor="name">
                      <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "doctor" ? "Dr. Priya Patel" : "Ana Martínez"} />
                    </Field>
                  ) : null}
                  <Field label="Email" htmlFor="email">
                    <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
                    <Input
                      id="password"
                      type="password"
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </>
              )}

              {error ? (
                <p role="alert" className="rounded-[14px] bg-missed-wash px-4 py-3 font-semibold text-missed">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "One moment…" : USE_MOCKS ? `Continue as ${role}` : mode === "signin" ? "Sign in" : `Create ${role} account`}
                <ArrowRight className="size-5" aria-hidden />
              </Button>
              {USE_MOCKS ? <p className="text-sm text-ink-faint">Demo data mode: no account needed.</p> : null}
            </form>
          </>
        )}
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
            <span className={cn("absolute inset-x-1 top-0 h-3 rounded-t-[8px] [transform:perspective(160px)_rotateX(48deg)] [transform-origin:bottom]", c === "c" ? "bg-[#C99A3B]" : "bg-lime")} />
          )}
          <span className={cn("absolute inset-x-0 bottom-0 top-3 rounded-[6px]", c === "d" ? "bg-[#305873]/60" : c === "c" ? "bg-[#C99A3B]/30" : "bg-sea/35")} />
        </div>
      ))}
    </div>
  );
}
