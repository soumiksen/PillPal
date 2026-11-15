"use client";
// Real accounts: Supabase Auth (email + password) plus the profile row the sign-up trigger creates
// (supabase/002_accounts.sql). In mock mode there are no accounts; every hook reports "ready".
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import type { AccountRole, ProfileRow } from "@pillpal/shared";
import { supabase } from "./supabase";
import { USE_MOCKS } from "./api";

export type { AccountRole };

interface AccountState {
  status: "loading" | "signed-out" | "ready";
  session: Session | null;
  profile: ProfileRow | null;
}

// One shared store so every component sees the same session without refetching.
let state: AccountState = { status: "loading", session: null, profile: null };
const listeners = new Set<() => void>();
let started = false;

function set(next: AccountState) {
  state = next;
  listeners.forEach((l) => l());
}

async function loadProfile(session: Session | null) {
  if (!session || !supabase) return set({ status: "signed-out", session: null, profile: null });
  const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  set({ status: "ready", session, profile: (data as ProfileRow | null) ?? null });
}

function start() {
  if (started) return;
  started = true;
  if (!supabase) return set({ status: "signed-out", session: null, profile: null });
  void supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;
    // Defer: Supabase warns against awaiting its own calls inside this callback.
    setTimeout(() => void loadProfile(session), 0);
  });
}

function subscribe(fn: () => void) {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const mockState: AccountState = { status: "ready", session: null, profile: null };
const serverState: AccountState = { status: "loading", session: null, profile: null };

export function useAccount(): AccountState {
  const s = useSyncExternalStore(subscribe, () => state, () => serverState);
  return USE_MOCKS ? mockState : s;
}

/** Where each role lands after signing in. */
export const homeFor = (role: AccountRole | undefined) => (role === "doctor" ? "/doctor" : "/caregiver");

/**
 * Pages call this to require a signed-in user (and optionally a role). Signed-out users go to the
 * sign-in page; a doctor opening a caregiver page (or the reverse) goes to their own home.
 */
export function useRequireAccount(role?: AccountRole): AccountState {
  const account = useAccount();
  const router = useRouter();
  useEffect(() => {
    if (USE_MOCKS) return;
    if (account.status === "signed-out") router.replace("/");
    else if (account.status === "ready" && role && account.profile && account.profile.role !== role) router.replace(homeFor(account.profile.role));
  }, [account.status, account.profile, role, router]);
  return account;
}

/** The access token for API calls (the API checks it and the care team). */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function friendly(message: string) {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match an account.";
  if (m.includes("already registered")) return "There's already an account with that email. Sign in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first: we sent you a link.";
  if (m.includes("password")) return message;
  return "Something went wrong. Try again in a moment.";
}

export async function signIn(email: string, password: string): Promise<{ role?: AccountRole; error?: string }> {
  if (!supabase) return { error: "Sign-in isn't set up: Supabase keys are missing." };
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.session) return { error: friendly(error?.message ?? "") };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.session.user.id).maybeSingle();
  return { role: (profile?.role as AccountRole | undefined) ?? "caregiver" };
}

export async function signUp(input: { name: string; email: string; password: string; role: AccountRole }): Promise<{ needsConfirm?: boolean; error?: string }> {
  if (!supabase) return { error: "Sign-up isn't set up: Supabase keys are missing." };
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { full_name: input.name.trim(), role: input.role } },
  });
  if (error) return { error: friendly(error.message) };
  return { needsConfirm: !data.session };
}

export async function signOut() {
  await supabase?.auth.signOut();
}

/** Join a patient's care team with the code their caregiver shared. Returns the patient id. */
export async function joinPatient(code: string): Promise<{ patientId?: string; error?: string }> {
  if (!supabase) return { error: "Supabase keys are missing." };
  const { data, error } = await supabase.rpc("join_patient", { code: code.trim() });
  if (error) return { error: error.message.includes("no_patient") ? "No patient has that code. Check it with the caregiver." : "Couldn't add that patient. Try again." };
  return { patientId: data as string };
}

/** Which of my patients is selected on the caregiver page (remembered per browser). */
const PICK_KEY = "pillpal.patient";
export function rememberPatient(id: string) {
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    /* private mode: fine to forget */
  }
}
export function useRememberedPatient(): string | null {
  const [id] = useState(() => {
    try {
      return typeof window === "undefined" ? null : localStorage.getItem(PICK_KEY);
    } catch {
      return null;
    }
  });
  return id;
}
