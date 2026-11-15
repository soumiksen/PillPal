"use client";
import Link from "next/link";
import { ClipboardPlus, HeartHandshake, Stethoscope } from "lucide-react";
import { useLive } from "@/lib/useLive";
import { languageName } from "@/lib/languages";

export default function Home() {
  const d = useLive();
  const taken = d.doses.filter((x) => x.status === "taken").length;
  const name = d.patient?.preferred_name ?? "Rose";

  return (
    <div className="grid min-h-[calc(100dvh-2rem)] gap-10 rounded-[var(--radius-panel)] bg-paper p-8 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:p-14">
      <div>
        <p className="text-lg text-ink-soft">PillPal checks in over FaceTime and iMessage, so {name} never has to open an app.</p>
        <h1 className="mt-4 font-display text-[clamp(2.6rem,5.4vw,4.6rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
          {d.loading ? "Loading today…" : `${name} has taken ${taken} of ${d.doses.length} doses today.`}
        </h1>
        <p className="mt-5 max-w-[52ch] text-[19px] leading-relaxed text-ink-soft">
          Pal calls at pill time, looks at the pill and the plate on camera, and talks in{" "}
          {languageName(d.patient?.language)}. You see every dose here, and you only hear from us when something needs you.
        </p>
      </div>

      <nav aria-label="Choose your view" className="flex flex-col gap-4">
        <Choice
          href="/caregiver"
          icon={<HeartHandshake className="size-7" />}
          title="I'm a caregiver"
          text={`Today's doses, the live call, and alerts for ${name}.`}
          primary
        />
        <Choice href="/doctor" icon={<Stethoscope className="size-7" />} title="I'm the doctor" text="The weekly brief, trends, and dose changes." />
        <Choice href="/onboard" icon={<ClipboardPlus className="size-7" />} title="Set up a new patient" text="Add their details and snap a photo of each prescription label." />
      </nav>
    </div>
  );
}

function Choice({ href, icon, title, text, primary }: { href: string; icon: React.ReactNode; title: string; text: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "group flex items-center gap-5 rounded-[28px] bg-char p-6 text-white transition-colors hover:bg-char-2"
          : "group flex items-center gap-5 rounded-[28px] bg-mist p-6 transition-colors hover:ring-2 hover:ring-lime"
      }
    >
      <span className={primary ? "grid size-14 shrink-0 place-items-center rounded-full bg-lime text-ink" : "grid size-14 shrink-0 place-items-center rounded-full bg-lime text-ink"}>
        {icon}
      </span>
      <span>
        <span className="block font-display text-2xl font-semibold">{title}</span>
        <span className={primary ? "mt-0.5 block text-white/75" : "mt-0.5 block text-ink-soft"}>{text}</span>
      </span>
    </Link>
  );
}
