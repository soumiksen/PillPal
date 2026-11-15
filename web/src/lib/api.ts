"use client";
// Typed client for the PillPal REST API (contracts §5.3).
// Real API + Supabase by default. NEXT_PUBLIC_USE_MOCKS=true turns on the in-browser demo data (emergency fallback only).
import * as mock from "./mock";
import type { Brief, CreateMedicationBody, CreatePatientBody, Medication, RxFields } from "./types";
import type { UpdateMedicationBody } from "@pillpal/shared";

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Couldn't read that photo."));
    r.readAsDataURL(file);
  });

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const PATIENT_ID = process.env.NEXT_PUBLIC_PATIENT_ID ?? mock.DEMO_PATIENT_ID;

const ERRORS: Record<string, string> = {
  sign_in_required: "Your session ended. Sign in again.",
  not_on_care_team: "You're not on this patient's care team.",
  patient_has_no_phone: "Add the patient's phone number first.",
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // The API checks the Supabase session and the care team on every web route.
  const { accessToken } = await import("./account");
  const token = await accessToken();
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? { ...auth, ...init?.headers } : { "Content-Type": "application/json", ...auth, ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const code = body?.error ?? "";
    throw new Error(ERRORS[code] ?? `Something went wrong (${res.status}${code ? `: ${code}` : ""}). Try again.`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  async createPatient(body: CreatePatientBody): Promise<{ id: string }> {
    if (USE_MOCKS) {
      mock.upsertPatient({
        name: body.name,
        preferred_name: body.preferred_name ?? body.name.split(" ")[0],
        phone: body.phone,
        language: body.language,
        meal_times: body.meal_times ?? {},
        caregiver_name: body.caregiver_name ?? "Caregiver",
        caregiver_phone: body.caregiver_phone ?? "",
        doctor_name: body.doctor_name ?? "Doctor",
        consent_at: body.consent_at ?? null,
      });
      return { id: mock.DEMO_PATIENT_ID };
    }
    return req("/patients", { method: "POST", body: JSON.stringify(body) });
  },

  /** POST /rx/parse — multipart field "photo". */
  async parseRx(file: File): Promise<RxFields> {
    if (USE_MOCKS) return mock.mockParseRx();
    const fd = new FormData();
    fd.append("photo", file);
    return req("/rx/parse", { method: "POST", body: fd });
  },

  /** POST /medications — JSON CreateMedicationBody, pill photo as pill_photo_b64. */
  async createMedication(body: Omit<CreateMedicationBody, "pill_photo_b64">, pillPhoto?: File | null): Promise<{ id: string }> {
    if (USE_MOCKS) {
      const description = pillPhoto ? await mock.mockDescribePill() : null;
      const med: Medication = {
        ...body,
        id: `med-${Date.now()}`,
        avoid_foods: body.avoid_foods ?? [],
        pills_left: body.pills_left ?? null,
        refill_info: body.refill_info ?? null,
        pill_description: description,
        reference_photo_url: null,
        active: true,
        created_at: new Date().toISOString(),
      };
      mock.addMedication(med);
      return { id: med.id };
    }
    const pill_photo_b64 = pillPhoto ? await toBase64(pillPhoto) : undefined;
    return req("/medications", { method: "POST", body: JSON.stringify({ ...body, pill_photo_b64 }) });
  },

  async updateMedication(id: string, patch: UpdateMedicationBody): Promise<void> {
    if (USE_MOCKS) return mock.updateMedication(id, patch);
    await req(`/medications/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },

  async notifyDoseChange(body: { patient_id: string; medication_id: string; old_dose: string; new_dose: string; doctor_note: string }) {
    if (USE_MOCKS) return mock.mockDoseChange(body.medication_id, body.new_dose);
    await req("/notify/dose-change", { method: "POST", body: JSON.stringify(body) });
  },

  async generateBrief(patient_id: string): Promise<Brief> {
    if (USE_MOCKS) return mock.mockBrief(patient_id);
    return req("/reports/generate", { method: "POST", body: JSON.stringify({ patient_id }) });
  },

  async dial(patient_id: string): Promise<{ chert_call_id: string; room_name: string } | void> {
    if (USE_MOCKS) {
      void mock.runCheckInCall();
      return;
    }
    return req("/dial", { method: "POST", body: JSON.stringify({ patient_id, kind: "check_in" }) });
  },

  async remind(patient_id: string, medication_id: string) {
    if (USE_MOCKS) {
      void mock.runReminder(medication_id);
      return;
    }
    await req("/demo/remind", { method: "POST", body: JSON.stringify({ patient_id, medication_id }) });
  },

  /** Demo-only: plays the red-flag escalation. With the real backend, the patient triggers it by speaking. */
  async simulateEscalation() {
    if (USE_MOCKS) void mock.runEscalation();
  },

  async acknowledgeAlert(id: string) {
    if (USE_MOCKS) return mock.acknowledgeAlert(id);
    const { supabase } = await import("./supabase");
    await supabase?.from("alerts").update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
  },
};
