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
  /** Dose events for the 6 days before today (today's live doses are in `doses`). */
  pastWeek: DoseEvent[];
};

function seedRose(): State {
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
    share_code: "ROSE01",
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
  const pastWeek = buildPastWeek(patient.id, meds, {
    "-4|med-lisi|13:00": "wrong_pill_caught",
    "-3|med-metf|18:30": "missed",
    "-2|med-metf|18:30": "missed",
  });
  const history = historyFrom([...pastWeek, ...doses], [4, 3, 3, 4, 2, 4, 4]);
  return { patient, meds, doses, alerts, checkins, calls, callFeed: [], history, pastWeek };
}

let states: Map<string, State> | null = null;
let roster: State[] | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function all(): Map<string, State> {
  if (!states) {
    states = new Map();
    for (const st of [seedRose(), ...OTHER_PATIENTS.map(seedOther)]) states.set(st.patient.id, st);
  }
  return states;
}

/** The live demo patient (Rose): every scripted call, reminder and alert plays on her. */
export function getState(): State {
  return all().get(DEMO_PATIENT_ID)!;
}
/** Any patient's state; undefined for an unknown id. Stable between changes (safe as a store snapshot). */
export function getStateFor(id: string): State | undefined {
  return all().get(id);
}
/** Every patient, for the doctor's list. Stable between changes. */
export function getAll(): State[] {
  if (!roster) roster = [...all().values()];
  return roster;
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setFor(id: string, mut: (s: State) => void) {
  const s = all().get(id);
  if (!s) return;
  mut(s);
  all().set(id, { ...s });
  roster = null;
  emit();
}
const set = (mut: (s: State) => void) => setFor(DEMO_PATIENT_ID, mut);

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
  const owner = getAll().find((st) => st.meds.some((m) => m.id === id));
  if (!owner) return;
  setFor(owner.patient.id, (s) => {
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

export async function mockBrief(patientId: string = DEMO_PATIENT_ID): Promise<Brief> {
  await wait(1700);
  const s = getStateFor(patientId) ?? getState();
  const week = [...s.pastWeek, ...s.doses];
  const due = week.filter((d) => d.status !== "pending");
  const taken = due.filter((d) => d.status === "taken").length;
  const missed = due.filter((d) => d.status === "missed").length;
  const caught = week.filter((d) => d.status === "wrong_pill_caught").length;
  const notes = BRIEF_NOTES[s.patient.id];
  return {
    patient_id: s.patient.id,
    week_start: at("00:00", -6).slice(0, 10),
    adherence_pct: due.length ? Math.round((taken / due.length) * 100) : 100,
    doses_taken: taken,
    doses_missed: missed,
    wrong_pills_caught: caught,
    mood_trend: s.history.map((h) => h.mood),
    symptoms: notes?.symptoms ?? [],
    quotes: notes?.quotes ?? [],
    concerns: notes?.concerns ?? ["No concerns this week."],
    summary: notes?.summary ?? `${s.patient.preferred_name} took ${taken} of ${due.length} doses this week.`,
  };
}

export async function mockDoseChange(medicationId: string, newDose: string) {
  await wait(1200);
  updateMedication(medicationId, { strength: newDose });
}

// ---------------------------------------------------------------------------
// Week history + the doctor's other patients (fictional demo people).

type Override = "missed" | "wrong_pill_caught" | "pending";

/** One dose event per medicine time for the 6 days before today. Keys look like "-3|med-id|18:30". */
function buildPastWeek(patientId: string, meds: Medication[], overrides: Record<string, Override>): DoseEvent[] {
  const out: DoseEvent[] = [];
  let n = 0;
  for (let off = -6; off <= -1; off++) {
    for (const m of meds) {
      for (const t of m.times) {
        const status = (overrides[`${off}|${m.id}|${t}`] ?? "taken") as DoseEvent["status"];
        out.push({
          id: `${patientId}-w${off}-${m.id}-${t}`,
          medication_id: m.id,
          patient_id: patientId,
          scheduled_at: at(t, off),
          status,
          confirmed_via: status === "taken" ? (n++ % 3 === 1 ? "tapback" : "facetime") : null,
          created_at: at(t, off),
          chert_message_id: null,
          evidence_jpeg_url: null,
        });
      }
    }
  }
  return out;
}

/** Today's doses: taken if the time has passed (unless overridden), due otherwise. */
function buildToday(patientId: string, meds: Medication[], overrides: Record<string, Override>): DoseEvent[] {
  const now = Date.now();
  return meds.flatMap((m) =>
    m.times.map((t) => {
      const when = at(t);
      const status = (overrides[`0|${m.id}|${t}`] ?? (new Date(when).getTime() < now ? "taken" : "pending")) as DoseEvent["status"];
      return {
        id: `${patientId}-t-${m.id}-${t}`,
        medication_id: m.id,
        patient_id: patientId,
        scheduled_at: when,
        status,
        confirmed_via: status === "taken" ? "facetime" : null,
        created_at: when,
        chert_message_id: null,
        evidence_jpeg_url: null,
      };
    }),
  );
}

function historyFrom(week: DoseEvent[], moods: number[]): DayHistory[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = today();
    d.setDate(d.getDate() - (6 - i));
    const day = week.filter((x) => new Date(x.scheduled_at).toDateString() === d.toDateString());
    return {
      day: d.toLocaleDateString("en-US", { weekday: "short" }),
      taken: day.filter((x) => x.status === "taken").length,
      total: day.length,
      mood: moods[i] ?? 0,
    };
  });
}

interface OtherPatient {
  patient: Omit<Patient, "consent_at" | "created_at" | "care_chat_id" | "meal_times" | "address">;
  meds: { id: string; drug: string; strength: string; times: string[]; food_rule: Medication["food_rule"]; pill: string; left: number }[];
  overrides: Record<string, Override>;
  moods: number[];
  alert?: { level: Alert["level"]; reason: string; summary: string; offset: number; open: boolean };
  checkin: { mood: number; summary: string; quote: { original: string; english: string }; offset: number; risk: string };
}

const OTHER_PATIENTS: OtherPatient[] = [
  {
    patient: {
      id: "harold-0002", name: "Harold Kim", preferred_name: "Harold", phone: "+1 (817) 555-0167", language: "ko-KR",
      caregiver_name: "Grace", caregiver_phone: "+1 (817) 555-0199", doctor_name: "Dr. Priya Patel", share_code: "HAROLD",
    },
    meds: [
      { id: "med-h-amlo", drug: "Amlodipine", strength: "5 mg", times: ["08:00"], food_rule: "none", pill: "Small white octagon, imprint “AN 5”", left: 17 },
      { id: "med-h-ator", drug: "Atorvastatin", strength: "20 mg", times: ["21:00"], food_rule: "none", pill: "White oval, imprint “PD 155”", left: 9 },
    ],
    overrides: { "-6|med-h-ator|21:00": "missed", "-4|med-h-ator|21:00": "missed", "-3|med-h-ator|21:00": "missed", "-1|med-h-ator|21:00": "missed" },
    moods: [3, 3, 2, 3, 2, 3, 3],
    alert: { level: "orange", reason: "Bedtime Atorvastatin missed 4 of the last 6 nights", summary: "Harold says he falls asleep before the 9 pm call.", offset: -1, open: true },
    checkin: { mood: 3, summary: "Harold was tired but cheerful. Morning Amlodipine taken on camera.", quote: { original: "밤에는 너무 졸려서 잊어버려요.", english: "I get so sleepy at night that I forget." }, offset: 0, risk: "yellow" },
  },
  {
    patient: {
      id: "maggie-0003", name: "Margaret O'Neill", preferred_name: "Maggie", phone: "+1 (682) 555-0123", language: "en-US",
      caregiver_name: "Tom", caregiver_phone: "+1 (682) 555-0177", doctor_name: "Dr. Priya Patel", share_code: "MAGGIE",
    },
    meds: [
      { id: "med-m-warf", drug: "Warfarin", strength: "5 mg", times: ["17:00"], food_rule: "none", pill: "Peach round tablet, imprint “5”", left: 24 },
      { id: "med-m-done", drug: "Donepezil", strength: "10 mg", times: ["21:00"], food_rule: "none", pill: "Yellow round tablet, imprint “ARICEPT 10”", left: 30 },
    ],
    overrides: {},
    moods: [4, 5, 4, 4, 5, 4, 5],
    checkin: { mood: 5, summary: "Maggie was chatty and sharp. Both evening pills taken on camera every day.", quote: { original: "Pal, you're more reliable than my alarm clock.", english: "Pal, you're more reliable than my alarm clock." }, offset: -1, risk: "green" },
  },
  {
    patient: {
      id: "bao-0004", name: "Bao Nguyen", preferred_name: "Bao", phone: "+1 (214) 555-0145", language: "vi-VN",
      caregiver_name: "Linh", caregiver_phone: "+1 (214) 555-0181", doctor_name: "Dr. Priya Patel", share_code: "BAO001",
    },
    meds: [
      { id: "med-b-losa", drug: "Losartan", strength: "50 mg", times: ["08:00"], food_rule: "none", pill: "Green oval tablet, imprint “L 50”", left: 12 },
      { id: "med-b-metf", drug: "Metformin", strength: "1000 mg", times: ["08:00", "18:00"], food_rule: "with_food", pill: "White oblong tablet, imprint “G 45”", left: 40 },
    ],
    overrides: { "-5|med-b-metf|18:00": "wrong_pill_caught", "0|med-b-losa|08:00": "wrong_pill_caught" },
    moods: [4, 4, 3, 4, 4, 3, 4],
    alert: { level: "yellow", reason: "Wrong pill caught twice this week", summary: "Bao picked up Metformin instead of Losartan this morning. Pal caught it on camera.", offset: 0, open: false },
    checkin: { mood: 4, summary: "Bao mixed up the two white-ish pills again; Pal pointed out the green one.", quote: { original: "Hai viên thuốc trông giống nhau quá.", english: "The two pills look so alike." }, offset: 0, risk: "yellow" },
  },
];

function seedOther(o: OtherPatient): State {
  const patient: Patient = { ...o.patient, meal_times: {}, address: null, consent_at: at("09:00", -20), care_chat_id: null, created_at: at("09:00", -20) };
  const meds: Medication[] = o.meds.map((m) => ({
    id: m.id, patient_id: patient.id, drug: m.drug, strength: m.strength, dose: "1 tablet", times: m.times, food_rule: m.food_rule,
    avoid_foods: [], pills_left: m.left, refill_info: null, pill_description: m.pill, reference_photo_url: null, active: true,
    confirmed_by: patient.caregiver_name, created_at: at("09:00", -20),
  }));
  const pastWeek = buildPastWeek(patient.id, meds, o.overrides);
  const doses = buildToday(patient.id, meds, o.overrides);
  const alerts: Alert[] = o.alert
    ? [{
        id: `a-${patient.id}`, patient_id: patient.id, level: o.alert.level, reason: o.alert.reason, summary: o.alert.summary,
        sent_to: patient.caregiver_name, created_at: at("09:00", o.alert.offset), acknowledged_at: o.alert.open ? null : at("09:30", o.alert.offset),
      }]
    : [];
  const checkins: CheckIn[] = [{
    id: `c-${patient.id}`, call_id: null, patient_id: patient.id, mood: o.checkin.mood, risk_level: o.checkin.risk, summary: o.checkin.summary,
    symptoms: [], visual_notes: [], quotes: [o.checkin.quote], created_at: at("08:10", o.checkin.offset),
  }];
  return { patient, meds, doses, alerts, checkins, calls: [], callFeed: [], history: historyFrom([...pastWeek, ...doses], o.moods), pastWeek };
}

const BRIEF_NOTES: Record<string, Pick<Brief, "summary" | "concerns" | "quotes" | "symptoms">> = {
  [DEMO_PATIENT_ID]: {
    summary: "Mostly on track. Evening Metformin is the weak spot, and one wrong pill was caught on camera before she took it.",
    concerns: [
      "Evening Metformin missed twice in a row; consider moving it to lunch or adding a second reminder.",
      "One report of dizziness on standing while on Lisinopril 10 mg; worth a blood-pressure check.",
      "Lisinopril has 4 tablets left; refill needed this week.",
    ],
    quotes: [
      { original: "Se me olvidó después de cenar.", english: "I forgot after dinner." },
      { original: "Me mareé un poquito al pararme.", english: "I got a little dizzy when I stood up." },
    ],
    symptoms: [
      { name: "Mild knee pain", severity: "2/5", quote: "Me duele un poco la rodilla." },
      { name: "Dizzy when standing", severity: "3/5", quote: "Me mareé un poquito al pararme." },
    ],
  },
  "harold-0002": {
    summary: "Mornings are solid; the 9 pm Atorvastatin is missed most nights because Harold is asleep by then.",
    concerns: [
      "Atorvastatin missed 4 of 6 nights; it can be taken in the morning with Amlodipine instead.",
      "Seems tired on most calls; worth asking about sleep.",
    ],
    quotes: [{ original: "밤에는 너무 졸려서 잊어버려요.", english: "I get so sleepy at night that I forget." }],
    symptoms: [{ name: "Daytime tiredness", severity: "2/5", quote: "요즘 좀 피곤해요." }],
  },
  "maggie-0003": {
    summary: "Every dose taken on time, confirmed on camera. Mood is high and her memory on calls is steady.",
    concerns: ["No missed doses. Next INR check is due for the Warfarin."],
    quotes: [{ original: "Pal, you're more reliable than my alarm clock.", english: "Pal, you're more reliable than my alarm clock." }],
    symptoms: [],
  },
  "bao-0004": {
    summary: "Doses are taken, but Bao mixes up Losartan and Metformin; Pal caught the wrong pill twice this week.",
    concerns: [
      "Two look-alike tablets caused 2 wrong-pill moments; a pill organizer or a different-coloured brand could help.",
      "Otherwise adherence is good and blood sugar complaints are absent.",
    ],
    quotes: [{ original: "Hai viên thuốc trông giống nhau quá.", english: "The two pills look so alike." }],
    symptoms: [],
  },
};
