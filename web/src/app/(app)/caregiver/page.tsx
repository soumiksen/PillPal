"use client";
import { useState, useSyncExternalStore } from "react";
import { PhoneCall, ShieldAlert, Video } from "lucide-react";
import { toast } from "sonner";
import { useLive } from "@/lib/useLive";
import { api, PATIENT_ID, USE_MOCKS } from "@/lib/api";
import { rememberPatient, useRememberedPatient, useRequireAccount } from "@/lib/account";
import { usePatients } from "@/lib/usePatients";
import { JoinByCode, ShareCode } from "@/components/care-team";
import Link from "next/link";
import { languageName } from "@/lib/languages";
import { CallRoom } from "@/components/caregiver/call-room";
import { AlertsPanel, CheckInPanel, PatientHeader, UrgentBanner } from "@/components/caregiver/panels";
import { PillBox, PillBoxLegend, weekStats } from "@/components/pillbox";
import { DemoBar } from "@/components/demo-bar";
import { Button, Panel } from "@/components/ui";

const subscribeMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function CaregiverPage() {
  const account = useRequireAccount("caregiver");
  const roster = usePatients();
  const remembered = useRememberedPatient();
  const [picked, setPicked] = useState<string | null>(null);
  const mine = roster.patients.map((e) => e.patient);
  const patientId = USE_MOCKS ? PATIENT_ID : (mine.find((p) => p.id === (picked ?? remembered))?.id ?? mine[0]?.id ?? "");
  const d = useLive(patientId);
  const [calling, setCalling] = useState(false);
  const now = useSyncExternalStore(subscribeMinute, minuteNow, () => 0);

  if (account.status !== "ready" || roster.loading || (patientId && d.loading)) return <p className="p-6 text-ink-soft">Loading this week&apos;s pill box…</p>;
  if (!d.patient)
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <div className="rounded-[var(--radius-panel)] bg-paper p-8">
          <h1 className="font-display text-3xl font-semibold">Set up the person you care for</h1>
          <p className="mt-2 max-w-[56ch] text-ink-soft">
            {roster.error ?? d.error ?? "Add their details and snap a photo of each prescription label. Pal starts checking in at their next pill time."}
          </p>
          <Link href="/onboard" className="mt-5 inline-flex h-12 items-center rounded-[14px] bg-lime px-5 font-bold text-ink hover:bg-lime-deep">
            Set up a patient
          </Link>
        </div>
        <JoinByCode title="Already set up by family?" hint="Enter the 6-character code from their PillPal page to join their care team." onJoined={(id) => setPicked(id)} />
      </div>
    );

  const patient = d.patient;
  const activeCall = [...d.calls].reverse().find((c) => !c.ended_at) ?? null;
  const pending = [...d.doses].filter((x) => x.status === "pending").sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  // The next dose still to come; if every remaining one is late, the earliest late one.
  const next = pending.find((x) => new Date(x.scheduled_at).getTime() > now - 60 * 60 * 1000) ?? pending[0];
  const overdue = next ? new Date(next.scheduled_at).getTime() < now - 60 * 60 * 1000 : false;
  const nextMed = next ? d.meds.find((m) => m.id === next.medication_id) : undefined;
  const nextCall = next
    ? {
        time: fmtTime(next.scheduled_at),
        what: `${nextMed?.drug ?? "Medicine"} ${nextMed?.strength ?? ""}${nextMed?.food_rule === "with_food" ? ", after a meal" : nextMed?.food_rule === "empty_stomach" ? ", on an empty stomach" : ""}`,
      }
    : null;
  const urgent = d.alerts.find((a) => a.level === "red" && !a.acknowledged_at);
  const stats = weekStats(d.week);
  const lastCatch = [...d.week].reverse().find((x) => x.status === "wrong_pill_caught");
  const lastCatchMed = lastCatch ? d.meds.find((m) => m.id === lastCatch.medication_id) : undefined;

  async function startCall() {
    setCalling(true);
    try {
      await api.dial(patient.id);
      toast.success(`Pal is calling ${patient.preferred_name} on FaceTime`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the call.");
    } finally {
      setCalling(false);
    }
  }

  async function ack(id: string) {
    await api.acknowledgeAlert(id);
    toast.success("Marked as handled");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {d.error ? <p className="rounded-[14px] bg-caught-wash px-4 py-2 text-caught">{d.error}</p> : null}
        <Panel className="p-6">
          <PatientHeader patient={patient} onCall={startCall} calling={calling} live={Boolean(activeCall)} />
          {mine.length > 1 ? (
            <label className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-ink-soft">
              Caring for
              <select
                className="h-10 cursor-pointer rounded-[12px] border border-line bg-paper px-3 font-semibold text-ink"
                value={patient.id}
                onChange={(e) => {
                  setPicked(e.target.value);
                  rememberPatient(e.target.value);
                }}
              >
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Panel>
        {urgent ? <UrgentBanner alert={urgent} patient={patient} onAck={ack} /> : null}

        <Panel className="p-6 lg:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">{patient.preferred_name}&apos;s pill box · this week</h1>
              <p className="mt-1 text-ink-soft">Each lid opens when Pal sees the dose taken on FaceTime or {patient.preferred_name} taps ❤ on the reminder.</p>
            </div>
            {activeCall ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 font-bold">
                <span className="live-dot size-2.5 rounded-full bg-ok" aria-hidden /> Pal is on FaceTime with {patient.preferred_name}
              </span>
            ) : null}
          </div>
          <div className="mt-4 rounded-[24px] bg-mist p-2 shadow-[inset_0_2px_0_#fff]">
            <PillBox week={d.week} meds={d.meds} />
          </div>
          {lastCatch ? (
            <div className="mt-4 flex items-center gap-4 rounded-[18px] bg-caught-wash p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#D97706] text-white">
                <ShieldAlert className="size-5" aria-hidden />
              </span>
              <p className="text-[16px]">
                <b>
                  {new Date(lastCatch.scheduled_at).toLocaleDateString("en-US", { weekday: "short" })} {fmtTime(lastCatch.scheduled_at)} · wrong pill caught.
                </b>{" "}
                {patient.preferred_name} held up the wrong pill before {lastCatchMed?.drug ?? "a dose"}. Pal spotted it on camera and showed {patient.preferred_name} the right one.
              </p>
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-4 2xl:grid-cols-2">
          <div className="min-w-0">
            <CallRoom
              call={activeCall}
              feed={activeCall ? d.callFeed : []}
              lastCheckIn={d.checkins[0]}
              patientName={patient.preferred_name}
              caregiverName={patient.caregiver_name}
              onStart={startCall}
              starting={calling}
              nextCall={nextCall}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <CheckInPanel checkin={d.checkins[0]} />
            <AlertsPanel alerts={d.alerts.filter((a) => a.id !== urgent?.id)} patient={patient} onAck={ack} />
          </div>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
        <section className="rounded-[var(--radius-panel)] bg-char p-6 text-white">
          <p className={overdue ? "font-semibold text-lime" : "text-white/70"}>{overdue ? "Still due: not confirmed yet" : "Next compartment"}</p>
          {next ? (
            <>
              <p className="mt-1 font-display text-[38px] font-bold leading-tight tracking-tight tabular">
                {new Date(next.scheduled_at).toLocaleDateString("en-US", { weekday: "short" })} · {fmtTime(next.scheduled_at)}
              </p>
              <p className="text-white/75">
                {nextMed?.drug} {nextMed?.strength} · Pal will FaceTime {patient.preferred_name} in {languageName(patient.language)}
              </p>
            </>
          ) : (
            <p className="mt-1 font-display text-2xl font-semibold">All of today&apos;s lids are open</p>
          )}
          <Button size="lg" className="mt-5 w-full" onClick={startCall} disabled={calling || Boolean(activeCall)}>
            {activeCall ? <Video className="size-5" aria-hidden /> : <PhoneCall className="size-5" aria-hidden />}
            {activeCall ? "Pal is on the call" : "Start check-in call now"}
          </Button>
        </section>

        <Panel className="p-6">
          <div className="flex items-baseline justify-between">
            <span className="font-bold">Lids opened</span>
            <span className="font-display text-[38px] font-bold tabular">
              {stats.opened}/{stats.due}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-ok" style={{ width: `${stats.due ? (stats.opened / stats.due) * 100 : 0}%` }} />
          </div>
          <p className="mt-3 text-ink-soft">
            {stats.missed} missed · {stats.caught} wrong pill{stats.caught === 1 ? "" : "s"} caught
          </p>
        </Panel>

        {USE_MOCKS ? null : <ShareCode code={patient.share_code ?? null} patientName={patient.preferred_name} />}

        <Panel className="p-6">
          <h2 className="mb-3 font-display text-xl font-semibold">Reading the box</h2>
          <PillBoxLegend />
        </Panel>
      </aside>
      <DemoBar meds={d.meds} patientId={patient.id} patientName={patient.preferred_name} />
    </div>
  );
}
