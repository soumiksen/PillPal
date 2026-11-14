"use client";
import { useEffect, useRef } from "react";
import { BadgeCheck, Languages, PhoneCall, ScanEye, ShieldAlert, Video } from "lucide-react";
import type { Call, CallEvent, CheckIn } from "@/lib/types";
import { languageName } from "@/lib/languages";
import { Button, Panel, cn } from "../ui";

function Line({ e, patientName, caregiverName }: { e: CallEvent; patientName: string; caregiverName: string }) {
  if (e.kind === "said") {
    const isPal = e.who === "pal";
    const who = isPal ? "Pal" : e.who === "patient" ? patientName : caregiverName;
    return (
      <li className={cn("arrive flex flex-col gap-1", isPal ? "items-start" : "items-end")}>
        <span className="px-1 text-xs font-semibold text-ink-faint">{who}</span>
        <div
          className={cn(
            "max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-[15px] leading-snug",
            isPal ? "rounded-tl-[6px] bg-mint-soft text-ink" : "rounded-tr-[6px] bg-char text-white",
          )}
        >
          <p>{e.text}</p>
          {e.english ? <p className={cn("mt-1 text-[13px]", isPal ? "text-ink-soft" : "text-white/70")}>{e.english}</p> : null}
        </div>
      </li>
    );
  }
  if (e.kind === "check") {
    return (
      <li className="arrive">
        <div
          className={cn(
            "flex items-start gap-3 rounded-[14px] border px-3.5 py-3",
            e.ok ? "border-ok/25 bg-ok-wash" : "border-caught/30 bg-caught-wash",
          )}
        >
          <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", e.ok ? "bg-ok text-white" : "bg-caught text-white")}>
            {e.ok ? <BadgeCheck className="size-4.5" /> : <ShieldAlert className="size-4.5" />}
          </span>
          <div>
            <p className={cn("font-semibold", e.ok ? "text-ok" : "text-caught")}>
              {e.check === "pill" ? "Pill check" : "Plate check"}: {e.verdict}
            </p>
            <p className="text-sm text-ink-soft">
              <ScanEye className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              Pal sees: {e.what_i_see}
            </p>
          </div>
        </div>
      </li>
    );
  }
  if (e.kind === "dose") {
    return (
      <li className="arrive text-center text-sm font-semibold text-ok">
        Dose logged as taken · dashboard updated
      </li>
    );
  }
  return (
    <li className="arrive text-center text-sm text-ink-soft">
      <Languages className="mr-1 inline size-3.5" /> Switched to {languageName(e.language)}
    </li>
  );
}

export function CallRoom({
  call,
  feed,
  lastCheckIn,
  patientName,
  caregiverName,
  onStart,
  starting,
  nextCall,
}: {
  nextCall?: { time: string; what: string } | null;
  call: Call | null;
  feed: CallEvent[];
  lastCheckIn?: CheckIn;
  patientName: string;
  caregiverName: string;
  onStart: () => void;
  starting: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [feed.length]);

  const live = Boolean(call && !call.ended_at);
  return (
    <Panel className={cn("flex flex-col overflow-hidden", live ? "ring-4 ring-lime/40" : "")}>
      <div className={cn("flex items-center justify-between gap-3 px-5 py-4", live ? "bg-char text-white" : "border-b border-line")}>
        <div className="flex items-center gap-3">
          <span className={cn("grid size-10 place-items-center rounded-full", live ? "bg-lime text-ink" : "bg-mint text-ink")}>
            <Video className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display text-lg font-semibold leading-tight">
              {live ? (call?.kind === "escalation" ? `Group FaceTime: ${patientName} + ${caregiverName}` : `Pal is on FaceTime with ${patientName}`) : "Call room"}
            </p>
            <p className={cn("text-sm", live ? "text-white/70" : "text-ink-faint")}>
              {live ? `Speaking ${languageName(call?.language)} · live transcript with English` : "Live checks appear here during every call"}
            </p>
          </div>
        </div>
        {live ? (
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="live-dot size-2.5 rounded-full bg-lime" aria-hidden />
            Live
          </span>
        ) : null}
      </div>

      {feed.length ? (
        <ol ref={listRef} aria-live="polite" className="flex max-h-[440px] min-h-[300px] flex-col gap-3 overflow-y-auto px-5 py-4">
          {feed.map((e, i) => (
            <Line key={i} e={e} patientName={patientName} caregiverName={caregiverName} />
          ))}
        </ol>
      ) : (
        <div className="flex min-h-[300px] flex-col justify-between gap-6 px-5 py-5">
          <div>
            {nextCall ? (
              <>
                <p className="text-sm font-semibold text-ink-faint">Next call</p>
                <p className="mt-1 font-display text-[34px] leading-tight tabular">{nextCall.time}</p>
                <p className="mt-1 text-ink-soft">{nextCall.what}</p>
              </>
            ) : (
              <p className="text-ink-soft">No more calls today. Pal calls automatically at each dose time.</p>
            )}
            <ul className="mt-5 flex flex-col gap-2 text-[15px] text-ink-soft">
              <li className="flex items-center gap-2"><ScanEye className="size-4 text-lime-deep" aria-hidden /> Pal checks the pill and the plate on camera</li>
              <li className="flex items-center gap-2"><Languages className="size-4 text-lime-deep" aria-hidden /> Transcript shown in {patientName}&apos;s words, with English</li>
              {lastCheckIn ? (
                <li className="flex items-center gap-2"><BadgeCheck className="size-4 text-lime-deep" aria-hidden /> Last call at {new Date(lastCheckIn.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}, nothing flagged</li>
              ) : null}
            </ul>
          </div>
          <Button onClick={onStart} disabled={starting || live} size="lg" className="self-start">
            <PhoneCall className="size-5" aria-hidden />
            {starting ? "Calling…" : `Call ${patientName} now`}
          </Button>
        </div>
      )}
    </Panel>
  );
}
