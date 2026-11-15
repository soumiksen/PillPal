"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ImagePlus, Plus, ScanText, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, PATIENT_ID } from "@/lib/api";
import { homeFor, rememberPatient, useRequireAccount } from "@/lib/account";
import { LANGUAGES, languageName } from "@/lib/languages";
import type { CreatePatientBody, FoodRule, RxFields } from "@/lib/types";
import { Button, Field, Input, Panel, Select, cn } from "@/components/ui";

/** Form state for POST /patients (CreatePatientBody), with every field present while editing. */
type Draft = Required<Omit<CreatePatientBody, "consent_at" | "address">> & { consent_at: string | null };
type MedDraft = RxFields & { pillPhoto?: File | null; pillPreview?: string; labelPreview?: string; aiRead: boolean };

const STEPS = ["About them", "Their medicines", "Review and start"];

export default function OnboardPage() {
  const router = useRouter();
  const account = useRequireAccount();
  const isDoctor = account.profile?.role === "doctor";
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Draft>({
    name: "",
    preferred_name: "",
    phone: "",
    language: "es-US",
    caregiver_name: "",
    caregiver_phone: "",
    doctor_name: "",
    meal_times: { breakfast: "08:00", lunch: "12:30", dinner: "18:30" },
    consent_at: null,
  });
  const [meds, setMeds] = useState<MedDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const canNext0 = p.name && p.phone && p.caregiver_name && p.caregiver_phone && p.consent_at;

  async function finish() {
    setSaving(true);
    try {
      const { consent_at, ...rest } = p;
      const { id } = await api.createPatient({ ...rest, consent_at: consent_at ?? undefined, preferred_name: p.preferred_name || p.name.split(" ")[0] });
      for (const m of meds) {
        await api.createMedication(
          {
            drug: m.drug,
          strength: m.strength,
          dose: m.dose,
          times: m.times,
          food_rule: m.food_rule,
          avoid_foods: m.avoid_foods,
            patient_id: id || PATIENT_ID,
            pills_left: m.quantity ?? undefined,
            refill_info: m.refills != null ? `${m.refills} refills left` : undefined,
            confirmed_by: p.caregiver_name,
          },
          m.pillPhoto,
        );
      }
      rememberPatient(id || PATIENT_ID);
      toast.success(`${p.preferred_name || p.name} is set up. Pal will call at the first dose time.`);
      router.push(isDoctor ? `/doctor/${id}` : homeFor(account.profile?.role));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save. Check the API is running.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[860px]">
      <h1 className="font-display text-[40px] font-semibold leading-tight tracking-tight">Set up a patient</h1>
      <p className="mt-1 text-ink-soft">About three minutes. They won&apos;t need to install anything.</p>

      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-[15px] font-semibold",
              i === step ? "bg-char text-white" : i < step ? "bg-mint text-teal-deep" : "bg-paper text-ink-faint ring-1 ring-line",
            )}
          >
            <span className={cn("grid size-7 place-items-center rounded-full text-sm", i === step ? "bg-white/15" : i < step ? "bg-paper" : "bg-mist")}>
              {i < step ? <Check className="size-4" /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-6">
        {step === 0 ? <AboutStep p={p} setP={setP} /> : null}
        {step === 1 ? <MedsStep meds={meds} setMeds={setMeds} /> : null}
        {step === 2 ? <ReviewStep p={p} meds={meds} /> : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < 2 ? (
          <Button size="lg" onClick={() => setStep((s) => s + 1)} disabled={step === 0 ? !canNext0 : meds.length === 0}>
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={finish} disabled={saving}>
            {saving ? "Saving…" : `Start check-ins for ${p.preferred_name || p.name.split(" ")[0] || "them"}`}
          </Button>
        )}
      </div>
    </div>
  );
}

function AboutStep({ p, setP }: { p: Draft; setP: (fn: (d: Draft) => Draft) => void }) {
  const up = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP((d) => ({ ...d, [k]: e.target.value }));
  return (
    <Panel className="grid gap-5 p-7 sm:grid-cols-2">
      <Field label="Full name" htmlFor="name">
        <Input id="name" value={p.name} onChange={up("name")} placeholder="Rose Martínez" autoComplete="off" />
      </Field>
      <Field label="What Pal should call them" htmlFor="pref">
        <Input id="pref" value={p.preferred_name} onChange={up("preferred_name")} placeholder="Rose" />
      </Field>
      <Field label="Their iPhone number" htmlFor="phone" hint="Pal FaceTimes and texts this number.">
        <Input id="phone" type="tel" value={p.phone} onChange={up("phone")} placeholder="+1 817 555 0142" />
      </Field>
      <Field label="Language Pal speaks with them" htmlFor="lang" hint="Pal switches if they change language mid-call.">
        <Select id="lang" value={p.language} onChange={up("language")}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
              {l.native && l.native !== l.label ? ` · ${l.native}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Caregiver's name" htmlFor="cg">
        <Input id="cg" value={p.caregiver_name} onChange={up("caregiver_name")} placeholder="Ana" />
      </Field>
      <Field label="Caregiver's iPhone" htmlFor="cgp" hint="Alerts and group FaceTimes go here.">
        <Input id="cgp" type="tel" value={p.caregiver_phone} onChange={up("caregiver_phone")} placeholder="+1 469 555 0188" />
      </Field>
      <Field label="Doctor" htmlFor="doc">
        <Input id="doc" value={p.doctor_name} onChange={up("doctor_name")} placeholder="Dr. Priya Patel" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        {(["breakfast", "lunch", "dinner"] as const).map((meal) => (
          <Field key={meal} label={meal[0].toUpperCase() + meal.slice(1)} htmlFor={meal}>
            <Input
              id={meal}
              type="time"
              value={p.meal_times?.[meal] ?? ""}
              onChange={(e) => setP((d) => ({ ...d, meal_times: { ...d.meal_times, [meal]: e.target.value } }))}
              className="px-2"
            />
          </Field>
        ))}
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-[14px] bg-mist p-4 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-1 size-5 accent-[#3F6212]"
          checked={Boolean(p.consent_at)}
          onChange={(e) => setP((d) => ({ ...d, consent_at: e.target.checked ? new Date().toISOString() : null }))}
        />
        <span>
          <span className="font-semibold">They agree to video check-ins.</span>{" "}
          <span className="text-ink-soft">
            Pal may use the camera to look at pills and meals, and shares notes with their caregiver and doctor. They can say “no camera today” at any time.
          </span>
        </span>
      </label>
    </Panel>
  );
}

const blankMed = (): MedDraft => ({ drug: "", strength: "", dose: "1 tablet", times: ["09:00"], food_rule: "none", avoid_foods: [], quantity: null, refills: null, warnings: [], aiRead: false });

function MedsStep({ meds, setMeds }: { meds: MedDraft[]; setMeds: (fn: (m: MedDraft[]) => MedDraft[]) => void }) {
  const [reading, setReading] = useState(false);
  const labelInput = useRef<HTMLInputElement>(null);

  async function onLabel(file?: File) {
    if (!file) return;
    setReading(true);
    const preview = URL.createObjectURL(file);
    try {
      const rx = await api.parseRx(file);
      setMeds((m) => [...m, { ...rx, aiRead: true, labelPreview: preview }]);
      toast.success(`Read ${rx.drug} ${rx.strength} from the label. Please check each field.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that label. Try a sharper photo, or type it in.");
      setMeds((m) => [...m, { ...blankMed(), labelPreview: preview }]);
    } finally {
      setReading(false);
      if (labelInput.current) labelInput.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel className="flex flex-wrap items-center justify-between gap-5 border-dashed border-teal/40 bg-mint-soft/60 p-6">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-full bg-lime text-ink">
            <ScanText className="size-7" aria-hidden />
          </span>
          <div>
            <p className="font-display text-xl font-semibold">Snap the prescription label</p>
            <p className="text-ink-soft">PillPal reads the medicine, dose, times and food rule. You confirm every field.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input ref={labelInput} type="file" accept="image/*" capture="environment" className="sr-only" id="label-photo" onChange={(e) => onLabel(e.target.files?.[0])} />
          <label
            htmlFor="label-photo"
            className={cn("inline-flex h-12 cursor-pointer items-center gap-2 rounded-[16px] bg-lime px-5 font-bold text-ink hover:bg-lime-deep", reading && "pointer-events-none opacity-60")}
          >
            <Camera className="size-5" aria-hidden /> {reading ? "Reading the label…" : "Take or upload photo"}
          </label>
          <Button variant="quiet" className="h-12" onClick={() => setMeds((m) => [...m, blankMed()])}>
            <Plus className="size-4" /> Type it in
          </Button>
        </div>
      </Panel>

      {meds.map((m, i) => (
        <MedCard key={i} m={m} onChange={(next) => setMeds((all) => all.map((x, j) => (j === i ? next : x)))} onRemove={() => setMeds((all) => all.filter((_, j) => j !== i))} />
      ))}
      {meds.length === 0 && !reading ? <p className="text-center text-ink-faint">Add at least one medicine to continue.</p> : null}
    </div>
  );
}

function MedCard({ m, onChange, onRemove }: { m: MedDraft; onChange: (m: MedDraft) => void; onRemove: () => void }) {
  const set = <K extends keyof MedDraft>(k: K, v: MedDraft[K]) => onChange({ ...m, [k]: v });
  return (
    <Panel as="article" className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {m.labelPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.labelPreview} alt="Prescription label photo" className="size-14 rounded-xl object-cover ring-1 ring-line" />
          ) : null}
          <div>
            <p className="font-display text-xl font-semibold">{m.drug || "New medicine"}</p>
            {m.aiRead ? (
              <p className="inline-flex items-center gap-1 text-sm font-semibold text-teal-deep">
                <Sparkles className="size-3.5" aria-hidden /> Read from the label, please confirm
              </p>
            ) : (
              <p className="text-sm text-ink-faint">Entered by hand</p>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${m.drug || "medicine"}`}>
          <Trash2 className="size-4" /> Remove
        </Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Field label="Medicine" htmlFor={`drug-${m.drug}`}>
          <Input value={m.drug} onChange={(e) => set("drug", e.target.value)} placeholder="Amlodipine" />
        </Field>
        <Field label="Strength">
          <Input value={m.strength} onChange={(e) => set("strength", e.target.value)} placeholder="5 mg" />
        </Field>
        <Field label="Amount each time">
          <Input value={m.dose} onChange={(e) => set("dose", e.target.value)} placeholder="1 tablet" />
        </Field>
        <Field label="Times (comma separated)" hint="24-hour, e.g. 08:00, 19:00">
          <Input value={m.times.join(", ")} onChange={(e) => set("times", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
        </Field>
        <Field label="Food rule">
          <Select value={m.food_rule} onChange={(e) => set("food_rule", e.target.value as FoodRule)}>
            <option value="none">No food rule</option>
            <option value="with_food">Take with food</option>
            <option value="empty_stomach">Empty stomach</option>
          </Select>
        </Field>
        <Field label="Avoid" hint="Comma separated">
          <Input value={m.avoid_foods.join(", ")} onChange={(e) => set("avoid_foods", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} placeholder="grapefruit" />
        </Field>
        <Field label="Pills in the bottle">
          <Input type="number" min={0} value={m.quantity ?? ""} onChange={(e) => set("quantity", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Refills left">
          <Input type="number" min={0} value={m.refills ?? ""} onChange={(e) => set("refills", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-semibold">Photo of one pill</span>
          <label className="flex h-12 cursor-pointer items-center gap-2 rounded-[12px] border border-dashed border-line bg-mist px-3 text-ink-soft hover:border-teal hover:text-teal-deep">
            {m.pillPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.pillPreview} alt="Pill" className="size-9 rounded-lg object-cover" />
            ) : (
              <ImagePlus className="size-5" aria-hidden />
            )}
            <span className="text-[15px]">{m.pillPhoto ? "Change photo" : "Pal compares against this"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onChange({ ...m, pillPhoto: f, pillPreview: URL.createObjectURL(f) });
              }}
            />
          </label>
        </div>
      </div>
      {m.warnings.length ? (
        <p className="mt-4 rounded-[12px] bg-caught-wash px-4 py-2.5 text-[15px] text-caught">Label warnings: {m.warnings.join(" · ")}</p>
      ) : null}
    </Panel>
  );
}

function ReviewStep({ p, meds }: { p: Draft; meds: MedDraft[] }) {
  const first = p.preferred_name || p.name.split(" ")[0];
  return (
    <Panel className="p-7">
      <p className="font-display text-2xl font-semibold leading-snug">
        Pal will call {first} on FaceTime in {languageName(p.language)} at each dose time, and text {p.caregiver_name || "the caregiver"} only when something needs them.
      </p>
      <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {[
          ["Patient", `${p.name} · ${p.phone}`],
          ["Caregiver", `${p.caregiver_name} · ${p.caregiver_phone}`],
          ["Doctor", p.doctor_name || "Not added"],
          ["Meals", `Breakfast ${p.meal_times?.breakfast}, lunch ${p.meal_times?.lunch}, dinner ${p.meal_times?.dinner}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm font-semibold text-ink-faint">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-6 text-sm font-semibold text-ink-faint">Medicines</h2>
      <ul className="mt-2 divide-y divide-line">
        {meds.map((m, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2 py-2.5">
            <span className="font-semibold">
              {m.drug} {m.strength}
            </span>
            <span className="text-ink-soft tabular">
              {m.times.join(", ")} · {m.food_rule === "with_food" ? "with food" : m.food_rule === "empty_stomach" ? "empty stomach" : "any time"}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
