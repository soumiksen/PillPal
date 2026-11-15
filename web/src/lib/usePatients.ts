"use client";
// The doctor's patient list. Mock mode reads every patient in the in-browser store;
// real mode reads all patients plus this week's doses and open alerts from Supabase.
// (There is no doctors table in the contract yet, so a doctor sees every patient.)
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { AlertRow, CheckInRow, DoseEventRow, MedicationRow, PatientRow } from "@pillpal/shared";
import * as mock from "./mock";
import { USE_MOCKS } from "./api";
import { supabase } from "./supabase";
import { toAlert, toCheckIn, toDose, toMedication, toPatient } from "./normalize";
import type { Alert, CheckIn, DoseEvent, Medication, Patient } from "./types";

export interface RosterEntry {
  patient: Patient;
  meds: Medication[];
  /** Dose events from 6 days ago through today. */
  week: DoseEvent[];
  openAlerts: Alert[];
  lastCheckIn?: CheckIn;
}

export interface Roster {
  patients: RosterEntry[];
  loading: boolean;
  error: string | null;
  /** Re-read the list (after joining a patient with a code). */
  reload: () => void;
}
const noop = () => {};

const toEntry = (s: ReturnType<typeof mock.getAll>[number]): RosterEntry => ({
  patient: s.patient,
  meds: s.meds,
  week: [...s.pastWeek, ...s.doses],
  openAlerts: s.alerts.filter((a) => !a.acknowledged_at),
  lastCheckIn: s.checkins[0],
});

const noStates: ReturnType<typeof mock.getAll> = [];
function useMockRoster(): Roster {
  const states = useSyncExternalStore(mock.subscribe, mock.getAll, () => noStates);
  const isClient = useSyncExternalStore(mock.subscribe, () => true, () => false);
  return { patients: states.map(toEntry), loading: !isClient, error: null, reload: noop };
}

function useSupabaseRoster(): Roster {
  const [data, setData] = useState<Omit<Roster, "reload">>({ patients: [], loading: true, error: null });

  const load = useCallback(async () => {
    if (!supabase) {
      setData({ patients: [], loading: false, error: "Supabase keys are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or use mocks." });
      return;
    }
    const weekAgo = new Date();
    weekAgo.setHours(0, 0, 0, 0);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const [p, m, d, a, c] = await Promise.all([
      supabase.from("patients").select("*").order("name"),
      supabase.from("medications").select("*").eq("active", true),
      supabase.from("dose_events").select("*").gte("scheduled_at", weekAgo.toISOString()).order("scheduled_at"),
      supabase.from("alerts").select("*").is("acknowledged_at", null).order("created_at", { ascending: false }),
      supabase.from("check_ins").select("*").gte("created_at", weekAgo.toISOString()).order("created_at", { ascending: false }),
    ]);
    const err = [p, m, d, a, c].find((r) => r.error)?.error?.message ?? null;
    const meds = ((m.data ?? []) as MedicationRow[]).map(toMedication);
    const doses = ((d.data ?? []) as DoseEventRow[]).map(toDose);
    const alerts = ((a.data ?? []) as AlertRow[]).map(toAlert);
    const checkins = ((c.data ?? []) as CheckInRow[]).map(toCheckIn);
    const patients = ((p.data ?? []) as PatientRow[]).map(toPatient).map((patient) => ({
      patient,
      meds: meds.filter((x) => x.patient_id === patient.id),
      week: doses.filter((x) => x.patient_id === patient.id),
      openAlerts: alerts.filter((x) => x.patient_id === patient.id),
      lastCheckIn: checkins.find((x) => x.patient_id === patient.id),
    }));
    setData({ patients, loading: false, error: err });
  }, []);

  useEffect(() => {
    // Initial fetch, then Realtime-driven refetches (external system → state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!supabase) return;
    const channel = supabase
      .channel("pillpal-roster")
      .on("postgres_changes", { event: "*", schema: "public", table: "dose_events" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => void load())
      .subscribe();
    // Row-level security: the list depends on who is signed in.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => void load(), 0);
    });
    return () => {
      sub.subscription.unsubscribe();
      void supabase?.removeChannel(channel);
    };
  }, [load]);

  return { ...data, reload: () => void load() };
}

export function usePatients(): Roster {
  // USE_MOCKS is a build-time constant, so the hook order never changes at runtime.
  /* eslint-disable react-hooks/rules-of-hooks */
  return USE_MOCKS ? useMockRoster() : useSupabaseRoster();
  /* eslint-enable react-hooks/rules-of-hooks */
}
