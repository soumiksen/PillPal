"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileText, Pencil, Sparkles, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import { useLive } from "@/lib/useLive";
import { api, PATIENT_ID } from "@/lib/api";
import { languageName } from "@/lib/languages";
import type { Brief, Medication } from "@/lib/types";
import { Button, Dialog, Field, Input, Panel, Textarea } from "@/components/ui";

/** mood_trend is one value per day starting at week_start. */
function moodSeries(b: Brief) {
  const start = new Date(`${b.week_start}T12:00:00`);
  return b.mood_trend.map((mood, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { day: Number.isNaN(d.getTime()) ? `Day ${i + 1}` : d.toLocaleDateString("en-US", { weekday: "short" }), mood };
  });
}

const FOOD = { empty_stomach: "Empty stomach", with_food: "With food", none: "No food rule" } as const;

export default function DoctorPage() {
  const d = useLive();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);

  async function generate() {
    setLoading(true);
    try {
      setBrief(await api.generateBrief(PATIENT_ID));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the brief.");
    } finally {
      setLoading(false);
    }
  }

  if (!d.patient) return <p className="text-ink-soft">{d.loading ? "Loading…" : d.error ?? "No patient yet."}</p>;
  const p = d.patient;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-soft">
            Weekly review for {p.doctor_name} · patient speaks {languageName(p.language)}; quotes shown with English
          </p>
          <h1 className="mt-1 font-display text-[38px] font-semibold leading-tight tracking-tight">{p.name}, last 7 days</h1>
        </div>
        <Button size="lg" onClick={generate} disabled={loading}>
          <Sparkles className="size-5" aria-hidden />
          {loading ? "Writing the brief…" : brief ? "Write it again" : "Write this week's brief"}
        </Button>
      </div>

      {brief ? (
        <>
          <Panel className="bg-[linear-gradient(180deg,#F0FBDC_0%,#FFFFFF_75%)] p-7">
            <p className="flex items-center gap-2 text-sm font-semibold text-teal-deep">
              <FileText className="size-4" aria-hidden /> Summary written by PillPal from this week&apos;s calls and doses
            </p>
            <p className="mt-2 max-w-[62ch] font-display text-[28px] font-medium leading-snug tracking-tight">{brief.summary}</p>
            <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "Doses taken", value: `${Math.round(brief.adherence_pct)}%`, strong: true },
                { label: "Taken", value: brief.doses_taken },
                { label: "Missed", value: brief.doses_missed },
                { label: "Wrong pill caught", value: brief.wrong_pills_caught },
              ].map((t) => (
                <div key={t.label} className={t.strong ? "rounded-[20px] bg-lime p-4" : "rounded-[20px] bg-mist p-4"}>
                  <dt className="text-sm font-semibold text-ink-soft">{t.label}</dt>
                  <dd className="font-display text-[32px] leading-tight tabular">{t.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel className="p-6">
              <h2 className="font-display text-xl font-semibold">Mood on calls (1–5)</h2>
              <div className="mt-3 h-[220px]" role="img" aria-label={`Mood on each day's calls: ${brief.mood_trend.join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={moodSeries(brief)} margin={{ top: 10, right: 12, left: -26 }}>
                    <CartesianGrid vertical={false} stroke="#E4E8E1" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#737D70", fontSize: 13 }} />
                    <YAxis domain={[1, 5]} ticks={[1, 3, 5]} tickLine={false} axisLine={false} tick={{ fill: "#737D70", fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E8E1" }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="mood" stroke="#84CC16" strokeWidth={3} dot={{ r: 4, fill: "#84CC16" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="p-6">
              <h2 className="font-display text-xl font-semibold">What she mentioned</h2>
              {brief.symptoms.length === 0 ? (
                <p className="mt-2 text-ink-soft">No symptoms mentioned on calls this week.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {brief.symptoms.map((sy) => (
                    <li key={sy.name} className="rounded-[18px] bg-mist p-4">
                      <p className="font-semibold">
                        {sy.name}
                        {sy.severity ? <span className="font-normal text-ink-faint"> · {sy.severity}</span> : null}
                      </p>
                      {sy.quote ? <p className="mt-0.5 font-display italic text-ink-soft">“{sy.quote}”</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-5 [&>*]:min-w-0">
            <Panel className="p-6 lg:col-span-3">
              <h2 className="font-display text-xl font-semibold">In her words</h2>
              <ul className="mt-4 flex flex-col gap-4">
                {brief.quotes.map((q, i) => (
                  <li key={i} className="border-l-[3px] border-lime-deep pl-4">
                    <p className="font-display text-lg italic leading-snug">“{q.original}”</p>
                    {q.english !== q.original ? <p className="text-[15px] text-ink-soft">{q.english}</p> : null}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel className="p-6 lg:col-span-2">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
                <MessageCircleQuestion className="size-5 text-teal" aria-hidden /> Worth your attention
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {brief.concerns.map((c) => (
                  <li key={c} className="rounded-[16px] bg-mist p-3 text-[15px] leading-snug">
                    {c}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      ) : (
        <Panel className="grid place-items-start gap-2 p-7">
          <p className="font-display text-2xl font-semibold">No brief yet this week</p>
          <p className="max-w-[60ch] text-ink-soft">
            PillPal reads this week&apos;s calls, doses and alerts and writes a one-page summary with the moments that need your judgment.
          </p>
        </Panel>
      )}

      <Panel className="p-6">
        <h2 className="font-display text-xl font-semibold">Current medicines</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line text-sm text-ink-faint">
                <th className="py-2 pr-4 font-semibold">Medicine</th>
                <th className="py-2 pr-4 font-semibold">Dose</th>
                <th className="py-2 pr-4 font-semibold">Times</th>
                <th className="py-2 pr-4 font-semibold">Food</th>
                <th className="py-2 pr-4 font-semibold">Left</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {d.meds.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4 font-semibold">{m.drug}</td>
                  <td className="py-3 pr-4 tabular">
                    {m.strength} <span className="text-ink-soft">· {m.dose}</span>
                  </td>
                  <td className="py-3 pr-4 tabular text-ink-soft">{m.times.join(", ")}</td>
                  <td className="py-3 pr-4 text-ink-soft">{FOOD[m.food_rule]}</td>
                  <td className={m.pills_left != null && m.pills_left <= 5 ? "py-3 pr-4 font-semibold text-caught tabular" : "py-3 pr-4 tabular"}>
                    {m.pills_left ?? "—"}
                  </td>
                  <td className="py-3 text-right">
                    <Button size="sm" variant="quiet" onClick={() => setEditing(m)}>
                      <Pencil className="size-4" aria-hidden /> Change dose
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <ChangeDoseDialog med={editing} patientName={p.preferred_name} caregiver={p.caregiver_name} onClose={() => setEditing(null)} language={languageName(p.language)} />
    </div>
  );
}

function ChangeDoseDialog({
  med,
  onClose,
  patientName,
  caregiver,
  language,
}: {
  med: Medication | null;
  onClose: () => void;
  patientName: string;
  caregiver: string;
  language: string;
}) {
  const [dose, setDose] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const open = Boolean(med);

  async function save() {
    if (!med || !dose.trim()) return;
    setSaving(true);
    try {
      await api.updateMedication(med.id, { strength: dose.trim() });
      await api.notifyDoseChange({ patient_id: PATIENT_ID, medication_id: med.id, old_dose: med.strength, new_dose: dose.trim(), doctor_note: note.trim() });
      toast.success(`Dose changed. ${patientName} gets a text and a voice note in ${language}; ${caregiver} gets a summary.`);
      setDose("");
      setNote("");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the dose.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={med ? `Change ${med.drug} dose` : ""}
      description={med ? `Now ${med.strength}, ${med.dose}, at ${med.times.join(" and ")}.` : undefined}
    >
      <div className="flex flex-col gap-4">
        <Field label="New dose" htmlFor="new-dose">
          <Input id="new-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 5 mg" autoFocus />
        </Field>
        <Field label="Note for the family" htmlFor="note" hint={`Pal explains it to ${patientName} in plain ${language}.`}>
          <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lowering the dose because of the dizziness this week." />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !dose.trim()}>
            <Send className="size-4" aria-hidden /> {saving ? "Sending…" : "Change dose and notify"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
