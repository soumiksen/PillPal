"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, MessageCircleQuestion, Pencil, Plus, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useLive } from "@/lib/useLive";
import { useRequireAccount } from "@/lib/account";
import { api } from "@/lib/api";
import { languageName } from "@/lib/languages";
import type { Brief, DoseEvent, Medication } from "@/lib/types";
import { PillBox, weekStats } from "@/components/pillbox";
import { Button, Panel, cn } from "@/components/ui";
import { AddMedicineDialog, ChangePrescriptionDialog } from "@/components/change-prescription";

const FOOD = { empty_stomach: "Empty stomach", with_food: "With food", none: "No food rule" } as const;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function DoctorPatientPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const account = useRequireAccount("doctor");
  const d = useLive(patientId);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [adding, setAdding] = useState(false);

  async function generate() {
    setWriting(true);
    try {
      setBrief(await api.generateBrief(patientId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't write the brief.");
    } finally {
      setWriting(false);
    }
  }

  if (!d.patient)
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="text-ink-soft">{d.loading ? "Loading…" : d.error ?? "We couldn't find that patient."}</p>
      </div>
    );
  const p = d.patient;
  const stats = weekStats(d.week);
  const adherence = d.meds.map((m) => {
    const due = d.week.filter((x) => x.medication_id === m.id && x.status !== "pending");
    return { med: m, taken: due.filter((x) => x.status === "taken").length, due: due.length };
  });
  const flagged = d.week.filter((x) => x.status === "missed" || x.status === "wrong_pill_caught").reverse();
  const moods = d.history.map((h) => ({ day: h.day, mood: h.mood || null }));
  const quotes = brief?.quotes.length ? brief.quotes : (d.checkins[0]?.quotes ?? []);

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      <section className="grid gap-5 rounded-[var(--radius-panel)] bg-char p-7 text-white lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-lime">
            Weekly brief · {p.name} · speaks {languageName(p.language)} · caregiver {p.caregiver_name}
          </p>
          <h1 className="mt-2 max-w-[48ch] font-display text-[30px] font-semibold leading-tight tracking-tight">
            {brief ? brief.summary : `${stats.opened} of ${stats.due} compartments opened this week.`}
          </h1>
          <p className="mt-2 text-white/70">
            {brief
              ? `Written by PillPal from this week's doses, calls and messages. Quotes are translated from ${languageName(p.language)}.`
              : "Ask PillPal to read this week's calls, doses and messages and write a one-page summary."}
          </p>
        </div>
        <Button size="lg" onClick={generate} disabled={writing}>
          <Sparkles className="size-5" aria-hidden />
          {writing ? "Writing the brief…" : brief ? "Write it again" : "Write this week's brief"}
        </Button>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">{p.preferred_name}&apos;s pill box this week</h2>
              <p className="text-ink-soft tabular">
                {stats.opened} of {stats.due} taken · {stats.missed} missed · {stats.caught} wrong pill caught
              </p>
            </div>
            <PillBox week={d.week} meds={d.meds} compact className="mt-2" />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Panel className="p-6">
              <h2 className="font-display text-xl font-semibold">Adherence by medicine</h2>
              <ul className="mt-4 flex flex-col gap-4">
                {adherence.map(({ med, taken, due }) => {
                  const pct = due ? taken / due : 1;
                  const low = pct < 0.8;
                  return (
                    <li key={med.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3">
                      <div>
                        <p className="font-semibold">{med.drug}</p>
                        <p className="text-sm text-ink-faint">
                          {med.times.join(", ")} · {FOOD[med.food_rule].toLowerCase()}
                        </p>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-line" aria-hidden>
                        <div className={cn("h-full rounded-full", low ? "bg-missed" : "bg-ok")} style={{ width: `${pct * 100}%` }} />
                      </div>
                      <p className={cn("font-display text-lg font-bold tabular", low && "text-missed")}>
                        {taken}/{due}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel className="p-6">
              <h2 className="font-display text-xl font-semibold">Mood on calls (1–5)</h2>
              <div className="mt-3 h-[190px]" role="img" aria-label={`Mood on each day's calls: ${moods.map((m) => m.mood ?? "no call").join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={moods} margin={{ top: 10, right: 12, left: -26 }}>
                    <CartesianGrid vertical={false} stroke="#E4E8E1" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#737D70", fontSize: 13 }} />
                    <YAxis domain={[1, 5]} ticks={[1, 3, 5]} tickLine={false} axisLine={false} tick={{ fill: "#737D70", fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E4E8E1" }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="mood" stroke="#3F6212" strokeWidth={3} dot={{ r: 4, fill: "#3F6212" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel className="p-6">
            <h2 className="font-display text-xl font-semibold">Flagged moments</h2>
            {flagged.length === 0 ? (
              <p className="mt-2 text-ink-soft">No missed doses or wrong pills this week.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2.5">
                {flagged.slice(0, 5).map((f) => (
                  <FlagRow key={f.id} dose={f} med={d.meds.find((m) => m.id === f.medication_id)} name={p.preferred_name} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel className="p-6">
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
              <MessageCircleQuestion className="size-5 text-teal" aria-hidden /> Questions for you
            </h2>
            {brief ? (
              <ol className="mt-3 flex list-decimal flex-col gap-2.5 pl-5 text-[16px] leading-snug">
                {brief.concerns.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-ink-soft">Write this week&apos;s brief and PillPal lists the moments that need your judgment.</p>
            )}
          </Panel>

          <Panel className="p-6">
            <h2 className="font-display text-xl font-semibold">In {p.preferred_name}&apos;s words</h2>
            {quotes.length === 0 ? (
              <p className="mt-2 text-ink-soft">No quotes from calls yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {quotes.map((q, i) => (
                  <li key={i} className="border-l-[3px] border-lime-deep pl-4">
                    <p className="font-display text-lg italic leading-snug">“{q.original}”</p>
                    {q.english !== q.original ? <p className="text-[15px] text-ink-soft">{q.english}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold">Medicines</h2>
              <Button size="sm" variant="quiet" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden /> Add medicine
              </Button>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {d.meds.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold">
                      {m.drug} <span className="font-normal text-ink-soft tabular">{m.strength}</span>
                    </p>
                    <p className="text-sm text-ink-faint tabular">
                      {m.times.join(", ")} · {FOOD[m.food_rule]}
                      {m.pills_left != null ? (
                        <span className={m.pills_left <= 5 ? "font-semibold text-caught" : undefined}> · {m.pills_left} left</span>
                      ) : null}
                    </p>
                  </div>
                  <Button size="sm" variant="quiet" onClick={() => setEditing(m)}>
                    <Pencil className="size-4" aria-hidden /> Change prescription
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <ChangePrescriptionDialog
        med={editing}
        patientId={p.id}
        patientName={p.preferred_name}
        caregiver={p.caregiver_name}
        language={languageName(p.language)}
        onClose={() => setEditing(null)}
        onSaved={d.reload}
      />
      <AddMedicineDialog
        open={adding}
        patientId={p.id}
        patientName={p.preferred_name}
        doctorName={account.profile?.full_name?.trim() || "Doctor"}
        onClose={() => setAdding(false)}
        onSaved={d.reload}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/doctor" className="inline-flex w-fit items-center gap-1.5 rounded-full px-1 font-semibold text-ink-soft hover:text-ink">
      <ArrowLeft className="size-4" aria-hidden /> All patients
    </Link>
  );
}

function FlagRow({ dose, med, name }: { dose: DoseEvent; med?: Medication; name: string }) {
  const caught = dose.status === "wrong_pill_caught";
  return (
    <li className={cn("flex items-start gap-3 rounded-[16px] p-3.5", caught ? "bg-caught-wash" : "bg-missed-wash")}>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-white", caught ? "bg-[#D97706]" : "bg-missed")}>
        {caught ? <ShieldAlert className="size-4.5" aria-hidden /> : <X className="size-4.5" aria-hidden />}
      </span>
      <div>
        <p className={cn("font-bold", caught ? "text-caught" : "text-missed")}>
          {fmtWhen(dose.scheduled_at)} · {caught ? "wrong pill caught on camera" : "missed"}
        </p>
        <p className="text-[15px]">
          {caught
            ? `${name} held up the wrong pill before ${med?.drug ?? "a dose"}. Pal corrected it. Observation, not a diagnosis.`
            : `${med?.drug ?? "Dose"} ${med?.strength ?? ""} was not confirmed by call or message.`}
        </p>
      </div>
    </li>
  );
}
