"use client";
// One hook for every live view. Mock mode reads the in-browser store;
// real mode reads Supabase (anon key) and re-reads on Realtime changes to
// dose_events, alerts, check_ins and calls (published in schema.sql).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import * as mock from "./mock";
import { PATIENT_ID, USE_MOCKS } from "./api";
import { supabase } from "./supabase";
import type { AlertRow, CallRow, CheckInRow, DoseEventRow, MedicationRow, PatientRow } from "@pillpal/shared";
import type { Alert, Call, CallEvent, CheckIn, DayHistory, DoseEvent, Medication, Patient } from "./types";
import { toAlert, toCall, toCheckIn, toDose, toMedication, toPatient } from "./normalize";

export interface LiveData {
  patient: Patient | null;
  meds: Medication[];
  doses: DoseEvent[];
  alerts: Alert[];
  checkins: CheckIn[];
  calls: Call[];
  callFeed: CallEvent[];
  history: DayHistory[];
  /** Every dose event from 6 days ago through today (today's are the same rows as `doses`). */
  week: DoseEvent[];
  loading: boolean;
  error: string | null;
  /** Re-read everything (after editing the patient: the patients table is not on Realtime). */
  reload: () => void;
}

const empty: LiveData = {
  patient: null, meds: [], doses: [], alerts: [], checkins: [], calls: [], callFeed: [], history: [], week: [], loading: true, error: null, reload: () => {},
};

const serverSnapshot = null;
function useMockLive(patientId: string): LiveData {
  // The mock store is seeded from the clock, so it only exists in the browser.
  const getSnapshot = useCallback(() => mock.getStateFor(patientId) ?? null, [patientId]);
  const s = useSyncExternalStore(mock.subscribe, getSnapshot, () => serverSnapshot);
  const isClient = useSyncExternalStore(mock.subscribe, () => true, () => false);
  if (!isClient) return empty;
  if (!s) return { ...empty, loading: false, error: "We couldn't find that patient." };
  return { ...s, week: [...s.pastWeek, ...s.doses], loading: false, error: null, reload: () => {} };
}

function useSupabaseLive(patientId: string): LiveData {
  const [data, setData] = useState<LiveData>(empty);

  const load = useCallback(async () => {
    if (!patientId) {
      setData({ ...empty, loading: false });
      return;
    }
    if (!supabase) {
      setData({ ...empty, loading: false, error: "Supabase keys are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or use mocks." });
      return;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const weekAgo = new Date(start);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const [p, m, d, a, c, k, w] = await Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).single(),
      supabase.from("medications").select("*").eq("patient_id", patientId).eq("active", true),
      supabase.from("dose_events").select("*").eq("patient_id", patientId).gte("scheduled_at", start.toISOString()).order("scheduled_at"),
      supabase.from("alerts").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(10),
      supabase.from("check_ins").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(5),
      supabase.from("calls").select("*").eq("patient_id", patientId).order("started_at", { ascending: false }).limit(5),
      supabase.from("dose_events").select("*").eq("patient_id", patientId).gte("scheduled_at", weekAgo.toISOString()).order("scheduled_at"),
    ]);
    const err = [p, m, d, a, c, k, w].find((r) => r.error)?.error?.message ?? null;
    const byDay = new Map<string, { taken: number; total: number }>();
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekAgo);
      day.setDate(day.getDate() + i);
      byDay.set(day.toDateString(), { taken: 0, total: 0 });
    }
    const week = ((w.data ?? []) as DoseEventRow[]).map(toDose);
    for (const row of week) {
      if (!row.scheduled_at) continue;
      const key = new Date(row.scheduled_at).toDateString();
      const bucket = byDay.get(key);
      if (!bucket) continue;
      bucket.total++;
      if (row.status === "taken") bucket.taken++;
    }
    const checkins = ((c.data ?? []) as CheckInRow[]).map(toCheckIn);
    const history = [...byDay.entries()].map(([k2, v]) => ({
      day: new Date(k2).toLocaleDateString("en-US", { weekday: "short" }),
      taken: v.taken,
      total: v.total,
      mood: checkins.find((ci) => new Date(ci.created_at).toDateString() === k2)?.mood ?? 0,
    }));
    setData({
      patient: p.data ? toPatient(p.data as PatientRow) : null,
      meds: ((m.data ?? []) as MedicationRow[]).map(toMedication),
      doses: ((d.data ?? []) as DoseEventRow[]).map(toDose),
      alerts: ((a.data ?? []) as AlertRow[]).map(toAlert),
      checkins,
      calls: ((k.data ?? []) as CallRow[]).map(toCall).reverse(),
      callFeed: [],
      history,
      week,
      loading: false,
      error: err,
      reload: () => {},
    });
  }, [patientId]);

  useEffect(() => {
    // Initial fetch, then Realtime-driven refetches (external system → state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!supabase || !patientId) return;
    const channel = supabase
      .channel(`pillpal-${patientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dose_events", filter: `patient_id=eq.${patientId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter: `patient_id=eq.${patientId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "check_ins", filter: `patient_id=eq.${patientId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `patient_id=eq.${patientId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "medications", filter: `patient_id=eq.${patientId}` }, () => void load())
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [load, patientId]);

  return { ...data, reload: () => void load() };
}

export function useLive(patientId: string = PATIENT_ID): LiveData {
  // USE_MOCKS is a build-time constant, so the hook order never changes at runtime.
  /* eslint-disable react-hooks/rules-of-hooks */
  return USE_MOCKS ? useMockLive(patientId) : useSupabaseLive(patientId);
  /* eslint-enable react-hooks/rules-of-hooks */
}
