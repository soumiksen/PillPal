"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardPlus, LogOut, PillBottle, Users } from "lucide-react";
import { Wordmark } from "./brand";
import { cn } from "./ui";
import { USE_MOCKS } from "@/lib/api";

type NavItem = { href: string; label: string; short?: string; Icon: typeof Users };

const CAREGIVER_NAV: NavItem[] = [
  { href: "/caregiver", label: "Pill box", short: "Pill box", Icon: PillBottle },
  { href: "/onboard", label: "Set up a patient", short: "Set up", Icon: ClipboardPlus },
];
const DOCTOR_NAV: NavItem[] = [
  { href: "/doctor", label: "My patients", short: "Patients", Icon: Users },
  { href: "/onboard", label: "Set up a patient", short: "Set up", Icon: ClipboardPlus },
];

/** Reads the URL, so it sits inside <Suspense>: pages with an unknown dynamic param (like /doctor/[patientId]) resolve it at request time. */
function useNav() {
  const path = usePathname() ?? "/";
  const doctor = path.startsWith("/doctor");
  return { nav: doctor ? DOCTOR_NAV : CAREGIVER_NAV, role: doctor ? "Doctor" : "Caregiver", isActive: (n: NavItem) => path.startsWith(n.href) };
}

function SideNav() {
  const { nav, role, isActive } = useNav();
  return (
    <nav aria-label="Main" className="flex flex-col py-4">
      <p className="px-6 pb-2 text-[15px] font-bold text-ink">{role} menu</p>
      {nav.map((n) => {
        const active = isActive(n);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 px-6 py-3.5 text-[16px] font-semibold transition-colors",
              active ? "bg-mist/70 text-ink" : "text-ink-faint hover:bg-mist/50 hover:text-ink",
            )}
          >
            <n.Icon className={cn("size-5", active ? "text-ink" : "text-ink-faint")} aria-hidden />
            {n.label}
            {active ? <span className="absolute right-0 top-1/2 h-9 w-[5px] -translate-y-1/2 rounded-l-full bg-lime-deep" aria-hidden /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function TopNav() {
  const { nav, isActive } = useNav();
  return (
    <>
      {nav.map((n) => {
        const active = isActive(n);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full px-3 py-2 text-[15px] font-semibold", active ? "bg-char text-white" : "text-ink-soft hover:bg-paper")}
          >
            {n.short ?? n.label}
          </Link>
        );
      })}
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh p-0 lg:p-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-[1520px] flex-col gap-4 lg:flex-row">
        <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-[248px] shrink-0 flex-col rounded-[var(--radius-panel)] bg-paper lg:flex">
          <div className="border-b border-line px-6 py-6">
            <Wordmark />
          </div>
          <Suspense fallback={<div className="h-[150px]" />}>
            <SideNav />
          </Suspense>
          <Link href="/" className="mx-6 mt-2 inline-flex items-center gap-2 text-[15px] font-semibold text-ink-faint hover:text-ink">
            <LogOut className="size-4" aria-hidden /> Switch role
          </Link>
          <div className="mt-auto p-4">
            <div className="relative overflow-hidden rounded-[22px] bg-mist p-5">
              <PillDoodles />
              <p className="relative font-display text-xl leading-tight">Pal checks in on FaceTime</p>
              <p className="relative mt-1 text-[15px] text-ink-soft">No app for the patient. Ever.</p>
              {USE_MOCKS ? (
                <p className="relative mt-3 inline-flex rounded-full bg-paper px-3 py-1 text-sm font-semibold text-ink-soft" title="Set NEXT_PUBLIC_USE_MOCKS=false to use the live API">
                  Showing demo data
                </p>
              ) : null}
            </div>
          </div>
        </aside>

        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-mist/90 px-4 py-3 backdrop-blur-md lg:hidden">
          <Wordmark />
          <nav aria-label="Main" className="flex items-center gap-1">
            <Suspense fallback={null}>
              <TopNav />
            </Suspense>
            <Link href="/" aria-label="Switch role" className="rounded-full p-2 text-ink-soft hover:bg-paper">
              <LogOut className="size-4" aria-hidden />
            </Link>
          </nav>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-4 lg:px-0 lg:pb-8 lg:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function PillDoodles() {
  return (
    <svg viewBox="0 0 200 120" className="pointer-events-none absolute -bottom-6 -right-8 h-32 w-56 opacity-70" aria-hidden>
      <rect x="110" y="20" width="70" height="28" rx="14" fill="#E2E6DF" transform="rotate(-30 145 34)" />
      <rect x="70" y="70" width="60" height="24" rx="12" fill="#E2E6DF" transform="rotate(20 100 82)" />
      <circle cx="170" cy="95" r="16" fill="#E2E6DF" />
    </svg>
  );
}
