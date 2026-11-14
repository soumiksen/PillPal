"use client";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useLive } from "@/lib/useLive";
import { api, PATIENT_ID } from "@/lib/api";
import { TodayPanel } from "@/components/caregiver/today";
import { CallRoom } from "@/components/caregiver/call-room";
import { AlertsPanel, CheckInPanel, UrgentBanner, WeekPanel } from "@/components/caregiver/panels";
import { Hero } from "@/components/caregiver/hero";
import { SidePanel } from "@/components/caregiver/side-panel";
import { DemoBar } from "@/components/demo-bar";

const subscribeMinute = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

export default function CaregiverPage() {
  const d = useLive();
  const [calling, setCalling] = useState(false);
  const now = useSyncExternalStore(subscribeMinute, minuteNow, () => 0);

  if (d.loading) return <p className="p-6 text-ink-soft">Loading today&apos;s care…</p>;
  if (!d.patient)
    return (
      <div className="max-w-xl rounded-[var(--radius-panel)] bg-paper p-8">
        <h1 className="font-display text-3xl">No patient yet</h1>
        <p className="mt-2 text-ink-soft">{d.error ?? "Set up a patient to start their daily check-ins."}</p>
        <a href="/onboard" className="mt-4 inline-flex h-12 items-center rounded-[14px] bg-teal px-5 font-bold text-white">
          Set up a patient
        </a>
      </div>
    );

  const patient = d.patient;
  const activeCall = [...d.calls].reverse().find((c) => !c.ended_at) ?? null;
  const upcoming = [...d.doses]
    .filter((x) => x.status === "pending" && new Date(x.scheduled_at).getTime() > now - 60 * 60 * 1000)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const upcomingMed = upcoming ? d.meds.find((m) => m.id === upcoming.medication_id) : undefined;
  const nextCall = upcoming
    ? {
        time: new Date(upcoming.scheduled_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        what: `${upcomingMed?.drug ?? "Medicine"} ${upcomingMed?.strength ?? ""}${upcomingMed?.food_rule === "with_food" ? ", after a meal" : upcomingMed?.food_rule === "empty_stomach" ? ", on an empty stomach" : ""}`,
      }
    : null;
  const urgent = d.alerts.find((a) => a.level === "red" && !a.acknowledged_at);
  const taken = d.doses.filter((x) => x.status === "taken").length;
  const weekPct = d.history.length
    ? Math.round((d.history.reduce((s, h) => s + (h.total ? h.taken / h.total : 0), 0) / d.history.length) * 100)
    : 0;

  async function startCall() {
    setCalling(true);
    try {
      await api.dial(PATIENT_ID);
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        {d.error ? <p className="rounded-[14px] bg-caught-wash px-4 py-2 text-caught">{d.error}</p> : null}
        <Hero caregiver={patient.caregiver_name} patient={patient.preferred_name} taken={taken} total={d.doses.length} />
        {urgent ? <UrgentBanner alert={urgent} patient={patient} onAck={ack} /> : null}

        <div className="grid gap-4 2xl:grid-cols-12">
          <div className="min-w-0 2xl:col-span-7">
            <TodayPanel doses={d.doses} meds={d.meds} name={patient.preferred_name} />
          </div>
          <div className="min-w-0 2xl:col-span-5">
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
        </div>

        <WeekPanel history={d.history} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <CheckInPanel checkin={d.checkins[0]} />
          </div>
          <div className="min-w-0">
            <AlertsPanel alerts={d.alerts.filter((a) => a.id !== urgent?.id)} patient={patient} onAck={ack} />
          </div>
        </div>
      </div>

      <div className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <SidePanel
          patient={patient}
          meds={d.meds}
          doses={d.doses}
          weekPct={weekPct}
          history={d.history}
          live={Boolean(activeCall)}
          calling={calling}
          onCall={startCall}
          now={now}
        />
      </div>
      <DemoBar meds={d.meds} patientName={patient.preferred_name} />
    </div>
  );
}
