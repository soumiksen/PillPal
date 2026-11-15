"use client";
// Typed client for the PillPal REST API (contracts §5.3).
// NEXT_PUBLIC_USE_MOCKS defaults to true so the portal works before the backend is merged.
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

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const PATIENT_ID = process.env.NEXT_PUBLIC_PATIENT_ID ?? mock.DEMO_PATIENT_ID;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}). ${text.slice(0, 160)}`);
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
    if (USE_MOCKS) return mock.mockBrief();
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
