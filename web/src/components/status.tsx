import { Check, CircleAlert, Clock3, ShieldAlert, Video, Heart, Camera, Mic, X } from "lucide-react";
import type { ConfirmedVia, DoseStatus, AlertLevel } from "@/lib/types";
import { cn } from "./ui";

const DOSE: Record<DoseStatus, { label: string; cls: string; Icon: typeof Check }> = {
  pending: { label: "Due", cls: "bg-wait-wash text-wait", Icon: Clock3 },
  taken: { label: "Taken", cls: "bg-ok-wash text-ok", Icon: Check },
  missed: { label: "Missed", cls: "bg-missed-wash text-missed", Icon: X },
  skipped: { label: "Skipped", cls: "bg-wait-wash text-wait", Icon: X },
  wrong_pill_caught: { label: "Wrong pill caught", cls: "bg-caught-wash text-caught", Icon: ShieldAlert },
};

export function DoseStatusChip({ status, className }: { status: DoseStatus; className?: string }) {
  const s = DOSE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold", s.cls, className)}>
      <s.Icon className="size-4" aria-hidden />
      {s.label}
    </span>
  );
}

export const doseTone = (status: DoseStatus) => DOSE[status];

const VIA: Record<ConfirmedVia, { label: string; Icon: typeof Video }> = {
  facetime: { label: "Seen on FaceTime", Icon: Video },
  tapback: { label: "Confirmed with ❤️", Icon: Heart },
  photo: { label: "Photo checked", Icon: Camera },
  voice: { label: "Voice memo", Icon: Mic },
};

export function ViaTag({ via }: { via?: ConfirmedVia | null }) {
  if (!via) return null;
  const v = VIA[via];
  return (
    <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
      <v.Icon className="size-3.5" aria-hidden />
      {v.label}
    </span>
  );
}

const LEVEL: Record<AlertLevel, { label: string; cls: string; ring: string }> = {
  red: { label: "Urgent", cls: "bg-missed text-white", ring: "border-missed/40 bg-missed-wash" },
  orange: { label: "Needs attention", cls: "bg-caught text-white", ring: "border-caught/30 bg-caught-wash" },
  yellow: { label: "Heads up", cls: "bg-wait text-white", ring: "border-line bg-wait-wash" },
};

export function AlertLevelChip({ level }: { level: AlertLevel }) {
  const l = LEVEL[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold", l.cls)}>
      <CircleAlert className="size-4" aria-hidden />
      {l.label}
    </span>
  );
}

export const alertTone = (level: AlertLevel) => LEVEL[level];
