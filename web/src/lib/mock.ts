"use client";
// In-browser mock backend. Used when NEXT_PUBLIC_USE_MOCKS !== "false".
// It mirrors the real API's behaviour closely enough to rehearse the whole demo,
// and doubles as a backup if the backend is down on stage.
import type { Alert, Brief, Call, CallEvent, CheckIn, DayHistory, DoseEvent, Medication, Patient, RxFields } from "./types";

export const DEMO_PATIENT_ID = "rose-0001";

const today = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
};
const at = (hhmm: string, dayOffset = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = today();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const nowIso = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

type State = {
  patient: Patient;
  meds: Medication[];
  doses: DoseEvent[];
  alerts: Alert[];
  checkins: CheckIn[];
  calls: Call[];
  callFeed: CallEvent[];
  history: DayHistory[];
};

function seed(): State {
  const patient: Patient = {
    id: DEMO_PATIENT_ID,
    name: "Rose Martínez",
    preferred_name: "Rose",
    phone: "+1 (817) 555-0142",
    language: "es-US",
    meal_times: { breakfast: "08:00", lunch: "12:30", dinner: "18:30" },
    caregiver_name: "Ana",
    caregiver_phone: "+1 (469) 555-0188",
    doctor_name: "Dr. Priya Patel",
    address: "Arlington, TX",
    consent_at: at("09:00", -10),
    care_chat_id: null,
    created_at: at("09:00", -10),
  };
  const meds: Medication[] = [
    {
      id: "med-levo", patient_id: patient.id, drug: "Levothyroxine", strength: "50 mcg", dose: "1 tablet",
      times: ["07:30"], food_rule: "empty_stomach", avoid_foods: ["coffee within 30 min", "calcium"],
      pills_left: 21, pill_description: "Small round white tablet, scored, imprint “M L 5”", active: true, confirmed_by: "Ana", refill_info: "2 refills left", reference_photo_url: null, created_at: at("09:00", -10),
    },
    {
      id: "med-metf", patient_id: patient.id, drug: "Metformin", strength: "500 mg", dose: "1 tablet",
      times: ["08:30", "18:30"], food_rule: "with_food", avoid_foods: ["alcohol"],
      pills_left: 38, pill_description: "Large white oval tablet, imprint “142”", active: true, confirmed_by: "Ana", refill_info: "2 refills left", reference_photo_url: null, created_at: at("09:00", -10),
    },
    {
      id: "med-lisi", patient_id: patient.id, drug: "Lisinopril", strength: "10 mg", dose: "1 tablet",
      times: ["13:00"], food_rule: "none", avoid_foods: ["salt substitutes (potassium)"],
      pills_left: 4, pill_description: "Round pink tablet, imprint “W 904”", active: true, confirmed_by: "Dr. Patel", refill_info: "1 refill left", reference_photo_url: null, created_at: at("09:00", -10),
    },
  ];
  const doses: DoseEvent[] = [
    { id: "d1", medication_id: "med-levo", patient_id: patient.id, scheduled_at: at("07:30"), status: "taken", confirmed_via: "facetime", created_at: at("07:34"), chert_message_id: null, evidence_jpeg_url: null },
    { id: "d2", medication_id: "med-metf", patient_id: patient.id, scheduled_at: at("08:30"), status: "taken", confirmed_via: "tapback", created_at: at("08:41"), chert_message_id: null, evidence_jpeg_url: null },
    { id: "d3", medication_id: "med-lisi", patient_id: patient.id, scheduled_at: at("13:00"), status: "pending", confirmed_via: null, created_at: at("13:00"), chert_message_id: null, evidence_jpeg_url: null },
    { id: "d4", medication_id: "med-metf", patient_id: patient.id, scheduled_at: at("18:30"), status: "pending", confirmed_via: null, created_at: at("18:30"), chert_message_id: null, evidence_jpeg_url: null },
  ];
  const alerts: Alert[] = [
    {
      id: "a-old", patient_id: patient.id, level: "orange", reason: "Evening Metformin missed two days in a row",
      summary: "Rose said she forgot after dinner on Wednesday and Thursday.", sent_to: "Ana", created_at: at("20:10", -2), acknowledged_at: at("20:30", -2),
    },
  ];
  const checkins: CheckIn[] = [
    {
      id: "c-morning", call_id: "call-morning", patient_id: patient.id, mood: 4, risk_level: "green",
      summary: "Rose slept well and ate oatmeal. Morning thyroid pill taken on an empty stomach, confirmed on camera.",
      symptoms: [{ name: "Mild knee pain", severity: "2/5", quote: "Me duele un poco la rodilla, pero estoy bien." }],
      visual_notes: ["Dressed and seated at the kitchen table", "Good lighting; pill held clearly"],
      quotes: [
        { original: "Dormí muy bien, gracias.", english: "I slept very well, thank you." },
        { original: "Me duele un poco la rodilla, pero estoy bien.", english: "My knee hurts a little, but I'm fine." },
      ],
      created_at: at("07:36"),
    },
  ];
  const calls: Call[] = [
    { id: "call-morning", patient_id: patient.id, kind: "check_in", language: "es-US", started_at: at("07:30"), ended_at: at("07:36"), chert_call_id: null, room_name: null, transcript: null },
  ];
  const moods = [4, 3, 3, 4, 2, 4, 4];
  const takenPct = [1, 1, 0.75, 0.75, 1, 0.75, 1];
  const history = Array.from({ length: 7 }, (_, i) => {
    const d = today();
    d.setDate(d.getDate() - (6 - i));
    return {
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      taken: Math.round(takenPct[i] * 4),
      total: 4,
      mood: moods[i],
    };
  });
  return { patient, meds, doses, alerts, checkins, calls, callFeed: [], history };
}

let state: State | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getState(): State {
  if (!state) state = seed();
  return state;
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(mut: (s: State) => void) {
  const s = getState();
  mut(s);
  state = { ...s };
  emit();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;

/** Scripted check-in call — the same beats the real agent produces. */
export async function runCheckInCall() {
  if (running) return;
  running = true;
  const callId = uid("call");
  const push = (e: CallEvent) => set((s) => { s.callFeed = [...s.callFeed, e]; });
  set((s) => {
    s.callFeed = [];
    s.calls = [...s.calls, { id: callId, patient_id: s.patient.id, kind: "check_in", language: "es-US", started_at: nowIso(), ended_at: null, chert_call_id: null, room_name: null, transcript: null }];
  });
  const beats: [number, CallEvent][] = [
    [1400, { kind: "said", who: "pal", text: "¡Buenas tardes, Rose! ¿Cómo va su día?", english: "Good afternoon, Rose! How is your day going?", at: "" }],
    [2200, { kind: "said", who: "patient", text: "Bien, mija. Acabo de almorzar.", english: "Good, dear. I just had lunch.", at: "" }],
    [1800, { kind: "said", who: "pal", text: "¡Qué bien! Muéstreme la pastilla que va a tomar.", english: "Great! Show me the pill you're about to take.", at: "" }],
    [2600, { kind: "check", check: "pill", ok: false, verdict: "Wrong pill caught", what_i_see: "Large white oval tablet, “142” — that's the evening Metformin.", at: "" }],
    [1600, { kind: "said", who: "pal", text: "Esa parece su pastilla de la noche. La de ahora es la rosada y redonda.", english: "That looks like your evening pill. The one for now is the round pink one.", at: "" }],
    [2600, { kind: "check", check: "pill", ok: true, verdict: "Match: Lisinopril 10 mg", what_i_see: "Round pink tablet, imprint “W 904”.", at: "" }],
    [1500, { kind: "said", who: "pal", text: "¡Perfecto! Tómela con un vaso de agua.", english: "Perfect! Take it with a glass of water.", at: "" }],
    [2000, { kind: "dose", medication_id: "med-lisi", status: "taken", at: "" }],
    [1600, { kind: "said", who: "patient", text: "Listo. ¿Y la de la noche?", english: "Done. And the evening one?", at: "" }],
    [1800, { kind: "said", who: "pal", text: "La de la noche es después de cenar. Le llamo a las seis y media.", english: "The evening one is after dinner. I'll call you at six thirty.", at: "" }],
  ];
  for (const [delay, ev] of beats) {
    await wait(delay);
    const e = { ...ev, at: nowIso() } as CallEvent;
    push(e);
    if (e.kind === "check" && !e.ok) {
      set((s) => {
        s.doses = s.doses.map((d) => (d.id === "d3" ? { ...d, status: "wrong_pill_caught" } : d));
      });
    }
    if (e.kind === "dose") {
      set((s) => {
        s.doses = s.doses.map((d) => (d.id === "d3" ? { ...d, status: "taken", confirmed_via: "facetime", created_at: nowIso() } : d));
        s.meds = s.meds.map((m) => (m.id === "med-lisi" ? { ...m, pills_left: Math.max(0, (m.pills_left ?? 1) - 1) } : m));
      });
    }
  }
  await wait(1800);
  set((s) => {
    s.calls = s.calls.map((c) => (c.id === callId ? { ...c, ended_at: nowIso() } : c));
    s.checkins = [
      {
        id: uid("c"), call_id: callId, patient_id: s.patient.id, mood: 4, risk_level: "green",
        summary: "Wrong pill caught on camera (evening Metformin). Rose then took her Lisinopril correctly after lunch.",
        symptoms: [],
        visual_notes: ["Alert and smiling", "Held pills close to the camera when asked"],
        quotes: [
          { original: "Bien, mija. Acabo de almorzar.", english: "Good, dear. I just had lunch." },
          { original: "Listo. ¿Y la de la noche?", english: "Done. And the evening one?" },
        ],
        created_at: nowIso(),
      },
      ...s.checkins,
    ];
  });
  running = false;
}

/** Red-flag escalation, as /escalate would drive it. */
export async function runEscalation() {
  const push = (e: CallEvent) => set((s) => { s.callFeed = [...s.callFeed, e]; });
  const callId = uid("call");
  set((s) => {
    s.callFeed = [];
    s.calls = [...s.calls, { id: callId, patient_id: s.patient.id, kind: "check_in", language: "es-US", started_at: nowIso(), ended_at: null, chert_call_id: null, room_name: null, transcript: null }];
  });
  await wait(1200);
  push({ kind: "said", who: "patient", text: "Me siento mareada… creo que tomé dos.", english: "I feel dizzy… I think I took two.", at: nowIso() });
  await wait(1500);
  push({ kind: "said", who: "pal", text: "Rose, quédese sentada. Estoy llamando a Ana ahora mismo.", english: "Rose, stay seated. I'm calling Ana right now.", at: nowIso() });
  await wait(900);
  set((s) => {
    s.alerts = [
      {
        id: uid("a"), patient_id: s.patient.id, level: "red", reason: "Dizziness and a possible double dose",
        summary: "Rose said she feels dizzy and thinks she took two pills. Pal is starting a group FaceTime with Ana.",
        sent_to: "Ana", created_at: nowIso(), acknowledged_at: null,
      },
      ...s.alerts,
    ];
    s.calls = s.calls.map((c) => (c.id === callId ? { ...c, ended_at: nowIso() } : c));
  });
  await wait(1400);
  set((s) => {
    s.callFeed = [];
    s.calls = [...s.calls, { id: uid("call"), patient_id: s.patient.id, kind: "group", language: "es-US", started_at: nowIso(), ended_at: null, chert_call_id: null, room_name: null, transcript: null }];
  });
  await wait(700);
  push({ kind: "said", who: "pal", text: "Ana, Rose says she feels dizzy and may have taken two pills. I'm here with you both.", at: nowIso() });
  await wait(2500);
  push({ kind: "said", who: "caregiver", text: "Mamá, siéntate. Ya voy para allá.", english: "Mom, sit down. I'm on my way.", at: nowIso() });
  await wait(9000);
  endActiveCalls();
}

export async function runReminder(medicationId: string) {
  await wait(2500);
  set((s) => {
    const d = s.doses.find((x) => x.medication_id === medicationId && (x.status === "pending" || x.status === "wrong_pill_caught"));
    if (d) s.doses = s.doses.map((x) => (x.id === d.id ? { ...x, status: "taken", confirmed_via: "tapback", created_at: nowIso() } : x));
  });
}

export function endActiveCalls() {
  set((s) => {
    s.calls = s.calls.map((c) => (c.ended_at ? c : { ...c, ended_at: nowIso() }));
  });
}

export function acknowledgeAlert(id: string) {
  set((s) => {
    s.alerts = s.alerts.map((a) => (a.id === id ? { ...a, acknowledged_at: nowIso() } : a));
  });
}

export function updateMedication(id: string, patch: { strength?: string; dose?: string; times?: string[]; active?: boolean }) {
  set((s) => {
    s.meds = s.meds.map((m) => (m.id === id ? { ...m, ...patch } : m));
  });
}

export function addMedication(m: Medication) {
  set((s) => { s.meds = [...s.meds, m]; });
}

export function upsertPatient(p: Partial<Patient>) {
  set((s) => { s.patient = { ...s.patient, ...p }; });
}

export async function mockParseRx(): Promise<RxFields> {
  await wait(1600);
  return {
    drug: "Amlodipine", strength: "5 mg", dose: "1 tablet", times: ["09:00"], food_rule: "none",
    avoid_foods: ["grapefruit"], quantity: 30, refills: 2,
    warnings: ["May cause dizziness", "Avoid grapefruit juice"],
  };
}

export async function mockDescribePill(): Promise<string> {
  await wait(900);
  return "Small round white tablet, imprint “AN 5”";
}

export async function mockBrief(): Promise<Brief> {
  await wait(1700);
  const s = getState();
  return {
    patient_id: s.patient.id,
    week_start: at("00:00", -6).slice(0, 10),
    adherence_pct: 89,
    doses_taken: 25,
    doses_missed: 2,
    wrong_pills_caught: 1,
    mood_trend: s.history.map((h) => h.mood),
    symptoms: [
      { name: "Mild knee pain", severity: "2/5", quote: "Me duele un poco la rodilla." },
      { name: "Dizzy when standing", severity: "3/5", quote: "Me mareé un poquito al pararme." },
    ],
    quotes: [
      { original: "Se me olvidó después de cenar.", english: "I forgot after dinner." },
      { original: "Me mareé un poquito al pararme.", english: "I got a little dizzy when I stood up." },
    ],
    concerns: [
      "Evening Metformin missed twice (Wed, Thu); consider moving it to lunch or adding a second reminder.",
      "One report of dizziness on standing while on Lisinopril 10 mg; worth a blood-pressure check.",
      "Lisinopril has 4 tablets left; refill needed this week.",
    ],
    summary:
      "Rose took 89% of doses this week. Evening Metformin is the weak spot, and one wrong-pill moment was caught on camera before she took it.",
  };
}

export async function mockDoseChange(medicationId: string, newDose: string) {
  await wait(1200);
  updateMedication(medicationId, { strength: newDose });
}
