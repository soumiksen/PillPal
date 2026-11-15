"use client";
import { useMemo, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { UpdateMedicationBody } from "@pillpal/shared";
import { api } from "@/lib/api";
import type { Medication } from "@/lib/types";
import { Button, Dialog, Field, Input, Select, Textarea } from "./ui";

const FOOD = { empty_stomach: "Empty stomach", with_food: "With food", none: "No food rule" } as const;
type FoodRule = keyof typeof FOOD;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const parseList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** One row per time of day, with add and remove. */
function TimesEditor({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {times.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input type="time" value={t} aria-label={`Dose time ${i + 1}`} onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button type="button" variant="ghost" size="sm" disabled={times.length <= 1} onClick={() => onChange(times.filter((_, j) => j !== i))} aria-label="Remove this time">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="quiet" size="sm" className="w-fit" onClick={() => onChange([...times, "12:00"])}>
        <Plus className="size-4" aria-hidden /> Add a time
      </Button>
    </div>
  );
}

const timesProblem = (times: string[]) =>
  times.length === 0 || times.some((t) => !HHMM.test(t)) ? "Pick a time for every dose." : new Set(times).size !== times.length ? "Each time can only appear once." : null;

/* ------------------------------------------------------------------ change an existing prescription */

export function ChangePrescriptionDialog({
  med,
  patientId,
  patientName,
  caregiver,
  language,
  onClose,
  onSaved,
}: {
  med: Medication | null;
  patientId: string;
  patientName: string;
  caregiver: string;
  language: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog
      open={Boolean(med)}
      onOpenChange={(o) => !o && onClose()}
      title={med ? `Change ${med.drug} prescription` : ""}
      description={med ? `Now ${med.strength}, ${med.dose}, at ${med.times.join(" and ")}.` : undefined}
    >
      {med ? <PrescriptionForm key={med.id} med={med} patientId={patientId} patientName={patientName} caregiver={caregiver} language={language} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function PrescriptionForm({
  med,
  patientId,
  patientName,
  caregiver,
  language,
  onClose,
  onSaved,
}: {
  med: Medication;
  patientId: string;
  patientName: string;
  caregiver: string;
  language: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [strength, setStrength] = useState(med.strength);
  const [dose, setDose] = useState(med.dose);
  const [times, setTimes] = useState<string[]>(med.times);
  const [food, setFood] = useState<FoodRule>(med.food_rule as FoodRule);
  const [avoid, setAvoid] = useState(med.avoid_foods.join(", "));
  const [pills, setPills] = useState(med.pills_left == null ? "" : String(med.pills_left));
  const [note, setNote] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [saving, setSaving] = useState(false);

  const { patch, changes, problem } = useMemo(() => {
    const patch: UpdateMedicationBody = {};
    const changes: { label: string; from: string; to: string }[] = [];
    const add = (label: string, from: string, to: string) => changes.push({ label, from, to });
    if (strength.trim() !== med.strength) {
      patch.strength = strength.trim();
      add("Strength", med.strength, strength.trim());
    }
    if (dose.trim() !== med.dose) {
      patch.dose = dose.trim();
      add("Dose", med.dose, dose.trim());
    }
    if (!same(times, med.times)) {
      patch.times = [...times].sort();
      add("Times", med.times.join(", "), [...times].sort().join(", "));
    }
    if (food !== med.food_rule) {
      patch.food_rule = food;
      add("Food rule", FOOD[med.food_rule as FoodRule] ?? med.food_rule, FOOD[food]);
    }
    const avoidList = parseList(avoid);
    if (!same(avoidList, med.avoid_foods)) {
      patch.avoid_foods = avoidList;
      add("Avoid", med.avoid_foods.join(", ") || "nothing", avoidList.join(", ") || "nothing");
    }
    const n = pills.trim() === "" ? null : Number(pills);
    if (n !== null && n !== med.pills_left) {
      if (Number.isInteger(n) && n >= 0) {
        patch.pills_left = n;
        add("Pills left", med.pills_left == null ? "unknown" : String(med.pills_left), String(n));
      }
    }
    const problem =
      !strength.trim() ? "The strength can't be empty." : !dose.trim() ? "The dose can't be empty." : timesProblem(times) ?? (n !== null && (!Number.isInteger(n) || n < 0) ? "Pills left must be a whole number." : null);
    return { patch, changes, problem };
  }, [strength, dose, times, food, avoid, pills, med]);

  async function save() {
    if (problem || changes.length === 0) return;
    setSaving(true);
    try {
      await api.updateMedication(med.id, patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the change.");
      setSaving(false);
      return;
    }
    // A new dose is the one change the patient must be told about, in their language, with the exact new dose.
    const doseChanged = patch.strength !== undefined || patch.dose !== undefined;
    if (doseChanged) {
      try {
        await api.notifyDoseChange({
          patient_id: patientId,
          medication_id: med.id,
          old_dose: patch.strength !== undefined ? med.strength : med.dose,
          new_dose: patch.strength !== undefined ? patch.strength : patch.dose!,
          doctor_note: note.trim(),
        });
        toast.success(`Prescription changed. ${patientName} gets a text and a voice note in ${language}; ${caregiver} gets a summary.`);
      } catch (e) {
        toast.warning(`Prescription saved, but the message to ${patientName} did not send: ${e instanceof Error ? e.message : "try again"}. Tell them yourself.`);
      }
    } else {
      toast.success(`Prescription changed. Pal uses it from the next call with ${patientName}.`);
    }
    onSaved();
    onClose();
    setSaving(false);
  }

  async function stop() {
    setSaving(true);
    try {
      await api.updateMedication(med.id, { active: false });
      toast.success(`${med.drug} stopped. Pal will no longer remind ${patientName} or check it.`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't stop the medicine.");
    } finally {
      setSaving(false);
    }
  }

  const doseChanged = patch.strength !== undefined || patch.dose !== undefined;

  if (confirmStop) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[16px]">
          Stop <strong>{med.drug} {med.strength}</strong>? Pal will no longer remind {patientName} or check it on camera. Past doses stay in the history.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmStop(false)} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" onClick={stop} disabled={saving}>
            {saving ? "Stopping…" : "Yes, stop it"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Strength" htmlFor="rx-strength">
          <Input id="rx-strength" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 50 mcg" />
        </Field>
        <Field label="How much each time" htmlFor="rx-dose">
          <Input id="rx-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1 tablet" />
        </Field>
      </div>
      <Field label="Times of day" hint="Pal checks in at each of these.">
        <TimesEditor times={times} onChange={setTimes} />
      </Field>
      <Field label="Food rule" htmlFor="rx-food">
        <Select id="rx-food" value={food} onChange={(e) => setFood(e.target.value as FoodRule)}>
          {(Object.keys(FOOD) as FoodRule[]).map((k) => (
            <option key={k} value={k}>
              {FOOD[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Foods to avoid" htmlFor="rx-avoid" hint="Separate with commas.">
        <Input id="rx-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="alcohol, grapefruit" />
      </Field>
      <Field label="Pills left" htmlFor="rx-pills">
        <Input id="rx-pills" type="number" min={0} value={pills} onChange={(e) => setPills(e.target.value)} />
      </Field>
      {doseChanged ? (
        <Field label="Note for the family" htmlFor="rx-note" hint={`Pal explains it to ${patientName} in plain ${language}.`}>
          <Textarea id="rx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lowering the dose because of the dizziness this week." />
        </Field>
      ) : null}

      <div className="rounded-[14px] bg-mint-soft p-3 text-[15px]" aria-live="polite">
        {changes.length === 0 ? (
          "No changes yet."
        ) : (
          <>
            <p className="font-semibold">Review before saving</p>
            <ul className="mt-1 list-disc pl-5">
              {changes.map((c) => (
                <li key={c.label}>
                  {c.label}: {c.from} → <strong>{c.to}</strong>
                </li>
              ))}
            </ul>
            {doseChanged ? (
              <p className="mt-2">{patientName} gets a text and a voice note in {language}. {caregiver} gets an English summary.</p>
            ) : null}
          </>
        )}
        <p className="mt-2 text-ink-soft">Pal never changes a dose by itself. Only you do, here.</p>
      </div>
      {problem && changes.length > 0 ? <p className="text-caught">{problem}</p> : null}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => setConfirmStop(true)} disabled={saving}>
          Stop this medicine
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || changes.length === 0 || Boolean(problem)}>
            <Send className="size-4" aria-hidden /> {saving ? "Saving…" : doseChanged ? "Save and notify" : "Save change"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ add a new medicine */

export function AddMedicineDialog({
  open,
  patientId,
  patientName,
  doctorName,
  onClose,
  onSaved,
}: {
  open: boolean;
  patientId: string;
  patientName: string;
  doctorName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add a medicine" description={`For ${patientName}. Pal starts checking in at the next dose time.`}>
      {open ? <AddForm patientId={patientId} doctorName={doctorName} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function AddForm({ patientId, doctorName, onClose, onSaved }: { patientId: string; doctorName: string; onClose: () => void; onSaved: () => void }) {
  const [drug, setDrug] = useState("");
  const [strength, setStrength] = useState("");
  const [dose, setDose] = useState("1 tablet");
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [food, setFood] = useState<FoodRule>("none");
  const [avoid, setAvoid] = useState("");
  const [pills, setPills] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const problem = !drug.trim() ? "Enter the medicine's name." : !strength.trim() ? "Enter the strength." : !dose.trim() ? "Enter how much to take." : timesProblem(times);

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      await api.createMedication(
        {
          patient_id: patientId,
          drug: drug.trim(),
          strength: strength.trim(),
          dose: dose.trim(),
          times: [...times].sort(),
          food_rule: food,
          avoid_foods: parseList(avoid),
          pills_left: pills.trim() === "" ? undefined : Number(pills),
          confirmed_by: doctorName,
        },
        photo,
      );
      toast.success(`${drug.trim()} added.`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the medicine.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Medicine" htmlFor="add-drug">
        <Input id="add-drug" value={drug} onChange={(e) => setDrug(e.target.value)} placeholder="e.g. Lisinopril" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Strength" htmlFor="add-strength">
          <Input id="add-strength" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 10 mg" />
        </Field>
        <Field label="How much each time" htmlFor="add-dose">
          <Input id="add-dose" value={dose} onChange={(e) => setDose(e.target.value)} />
        </Field>
      </div>
      <Field label="Times of day">
        <TimesEditor times={times} onChange={setTimes} />
      </Field>
      <Field label="Food rule" htmlFor="add-food">
        <Select id="add-food" value={food} onChange={(e) => setFood(e.target.value as FoodRule)}>
          {(Object.keys(FOOD) as FoodRule[]).map((k) => (
            <option key={k} value={k}>
              {FOOD[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Foods to avoid" htmlFor="add-avoid" hint="Optional. Separate with commas.">
        <Input id="add-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} />
      </Field>
      <Field label="Pills in the bottle" htmlFor="add-pills" hint="Optional.">
        <Input id="add-pills" type="number" min={0} value={pills} onChange={(e) => setPills(e.target.value)} />
      </Field>
      <Field label="Photo of the pill" htmlFor="add-photo" hint="Optional. Pal compares the pill on camera with this photo.">
        <Input id="add-photo" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </Field>
      {problem && (drug || strength) ? <p className="text-caught">{problem}</p> : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || Boolean(problem)}>
          {saving ? "Adding…" : "Add medicine"}
        </Button>
      </div>
    </form>
  );
}
