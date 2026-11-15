"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Eye, Phone, PhoneCall, Smile, Frown, Meh, Laugh, Annoyed, Languages, Pencil, Video } from "lucide-react";
import type { Alert, CheckIn, Patient } from "@/lib/types";
import { languageName, languageNative } from "@/lib/languages";
import { AlertLevelChip, alertTone } from "../status";
import { Button, Panel, cn } from "../ui";

const ftHref = (p: string) => `facetime:${p.replace(/[^\d+]/g, "")}`;
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
};

export function PatientHeader({ patient, onCall, calling, live, onEdit }: { patient: Patient; onCall: () => void; calling: boolean; live: boolean; onEdit?: () => void }) {
  const initials = patient.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <div className="flex flex-wrap items-center justify-between gap-5">
      <div className="flex items-center gap-4">
        <div className="grid size-16 place-items-center rounded-full bg-mint font-display text-2xl font-semibold text-teal-deep" aria-hidden>
          {initials}
        </div>
        <div>
          <h1 className="font-display text-[34px] font-semibold leading-none tracking-tight">{patient.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-ink-soft">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-2.5 py-0.5 text-[15px] font-semibold text-teal-deep ring-1 ring-line">
              <Languages className="size-4" aria-hidden />
              Speaks {languageName(patient.language)}
              {languageNative(patient.language) && languageNative(patient.language) !== languageName(patient.language) ? (
                <span className="font-normal text-ink-faint">· {languageNative(patient.language)}</span>
              ) : null}
            </span>
            <span>Cared for by {patient.caregiver_name}</span>
            <span>Doctor: {patient.doctor_name}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {onEdit ? (
          <Button variant="quiet" onClick={onEdit}>
            <Pencil className="size-4.5" aria-hidden /> Edit details
          </Button>
        ) : null}
        <a
          href={ftHref(patient.phone)}
          className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line bg-paper px-4 font-semibold hover:border-teal hover:text-teal-deep"
        >
          <Video className="size-4.5" aria-hidden /> FaceTime<span className="hidden sm:inline"> {patient.preferred_name} yourself</span>
        </a>
        <Button onClick={onCall} disabled={calling || live}>
          <PhoneCall className="size-4.5" aria-hidden /> {live ? "Pal is calling" : "Have Pal check in"}
        </Button>
      </div>
    </div>
  );
}

export function UrgentBanner({ alert, patient, onAck }: { alert: Alert; patient: Patient; onAck: (id: string) => void }) {
  return (
    <div role="alert" className="arrive rounded-[var(--radius-panel)] border-2 border-missed bg-missed-wash p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[640px]">
          <div className="flex items-center gap-3">
            <AlertLevelChip level={alert.level} />
            <span className="text-sm text-ink-soft">{ago(alert.created_at)}</span>
          </div>
          <p className="mt-2 font-display text-2xl font-semibold text-missed">{alert.reason}</p>
          {alert.summary ? <p className="mt-1 text-[17px]">{alert.summary}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a href={ftHref(patient.phone)} className="inline-flex h-12 items-center gap-2 rounded-[12px] bg-ink px-5 font-semibold text-white hover:bg-teal-deep">
            <Video className="size-5" /> FaceTime {patient.preferred_name}
          </a>
          <a href="tel:911" className="inline-flex h-12 items-center gap-2 rounded-[12px] bg-missed px-5 font-semibold text-white hover:brightness-95">
            <Phone className="size-5" /> Call 911
          </a>
          <Button variant="quiet" size="md" className="h-12" onClick={() => onAck(alert.id)}>
            <Check className="size-5" /> I&apos;m handling it
          </Button>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-soft">PillPal never calls emergency services by itself. You decide.</p>
    </div>
  );
}

export function AlertsPanel({ alerts, patient, onAck }: { alerts: Alert[]; patient: Patient; onAck: (id: string) => void }) {
  return (
    <Panel className="p-6">
      <h2 className="font-display text-xl font-semibold">Alerts</h2>
      {alerts.length === 0 ? (
        <p className="mt-2 text-ink-soft">Nothing needs you right now. Pal will text you if that changes.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {alerts.slice(0, 4).map((a) => {
            const tone = alertTone(a.level);
            return (
              <li key={a.id} className={cn("rounded-[14px] border p-4", a.acknowledged_at ? "border-line bg-paper opacity-70" : tone.ring)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AlertLevelChip level={a.level} />
                  <span className="text-sm text-ink-faint">{ago(a.created_at)}</span>
                </div>
                <p className="mt-2 font-semibold">{a.reason}</p>
                {a.summary ? <p className="text-[15px] text-ink-soft">{a.summary}</p> : null}
                {a.acknowledged_at ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-ok">
                    <Check className="size-4" /> Handled
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={ftHref(patient.phone)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-ink px-3 text-sm font-semibold text-white">
                      <Video className="size-4" /> FaceTime
                    </a>
                    <Button size="sm" variant="quiet" onClick={() => onAck(a.id)}>
                      Mark handled
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const MOOD = [
  { Icon: Frown, label: "Low" },
  { Icon: Annoyed, label: "Not great" },
  { Icon: Meh, label: "Okay" },
  { Icon: Smile, label: "Good" },
  { Icon: Laugh, label: "Great" },
];

export function CheckInPanel({ checkin }: { checkin?: CheckIn }) {
  if (!checkin)
    return (
      <Panel className="p-6">
        <h2 className="font-display text-xl font-semibold">How she&apos;s doing</h2>
        <p className="mt-2 text-ink-soft">After each call, Pal writes a short note here.</p>
      </Panel>
    );
  const m = MOOD[Math.min(4, Math.max(0, checkin.mood - 1))];
  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">How she&apos;s doing</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 font-semibold text-teal-deep">
          <m.Icon className="size-4.5" aria-hidden /> Mood: {m.label}
        </span>
      </div>
      <p className="mt-3 text-[17px] leading-relaxed">{checkin.summary}</p>
      {checkin.quotes.length ? (
        <ul className="mt-4 flex flex-col gap-3">
          {checkin.quotes.slice(0, 2).map((q, i) => (
            <li key={i} className="border-l-[3px] border-mint pl-3">
              <p className="font-display text-lg italic leading-snug">“{q.original}”</p>
              {q.english !== q.original ? <p className="text-[15px] text-ink-soft">{q.english}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {checkin.symptoms.length ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink-faint">Mentioned</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {checkin.symptoms.map((s) => (
              <li key={s.name} className="rounded-full bg-wait-wash px-3 py-1 text-sm">
                {s.name}{s.severity ? <span className="text-ink-faint"> · {s.severity}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {checkin.visual_notes.length ? (
        <div className="mt-4 rounded-[12px] bg-mist p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
            <Eye className="size-4" aria-hidden /> What Pal noticed on camera
          </p>
          <ul className="mt-1 list-disc pl-5 text-[15px] text-ink-soft">
            {checkin.visual_notes.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-ink-faint">Observations, not a diagnosis.</p>
        </div>
      ) : null}
    </Panel>
  );
}

export function WeekPanel({ history }: { history: { day: string; taken: number; total: number }[] }) {
  const data = history.map((h, i) => ({ ...h, pct: h.total ? Math.round((h.taken / h.total) * 100) : 0, today: i === history.length - 1 }));
  const avg = data.length ? Math.round(data.reduce((s, d) => s + d.pct, 0) / data.length) : 0;
  return (
    <Panel className="p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-display text-[34px] leading-none tabular">
          {avg}% <span className="text-[20px] text-ink-faint">doses confirmed this week</span>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-ink-soft" aria-label="Legend">
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-lime-deep" />Every dose</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-mint" />Some missed</li>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-char" />Today so far</li>
        </ul>
      </div>
      <div className="mt-5 h-[210px]" role="img" aria-label={`Doses confirmed per day this week, average ${avg}%`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -28 }} barCategoryGap="28%">
            <CartesianGrid vertical stroke="#EBE1CF" horizontal={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#5B6B76", fontSize: 14 }} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickLine={false} axisLine={false} tick={{ fill: "#5B6B76", fontSize: 12 }} unit="%" />
            <Tooltip
              cursor={{ fill: "#F3E8CF", radius: 16 }}
              formatter={(_v, _n, item) => [`${item.payload.taken} of ${item.payload.total} doses`, "Confirmed"]}
              contentStyle={{ borderRadius: 14, border: "1px solid #DED0BC", fontFamily: "var(--font-sans)" }}
            />
            <Bar isAnimationActive={false} dataKey="pct" radius={[999, 999, 999, 999]} maxBarSize={34} minPointSize={6}>
              {data.map((d) => (
                <Cell key={d.day} fill={d.today ? "#102F46" : d.pct >= 100 ? "#305873" : "#B8CBD8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
