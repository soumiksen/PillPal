"use client";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { LANGUAGES } from "@/lib/languages";
import type { Patient } from "@/lib/types";
import type { UpdatePatientBody } from "@pillpal/shared";
import { Button, Dialog, Field, Input, Select } from "./ui";

/** "+1 817-970-4356" / "(817) 970 4356" / "18179704356" → "+18179704356". Returns null when it can't be a phone number. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const e164 = raw.trim().startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  return e164 && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

/** The language list uses region codes (es-US); the database may hold the short form (en). Match either way. */
const languageOption = (code: string) => LANGUAGES.find((l) => l.code === code)?.code ?? LANGUAGES.find((l) => l.code.toLowerCase().startsWith(code.toLowerCase().slice(0, 2)))?.code ?? "";

type Form = {
  name: string;
  preferred_name: string;
  phone: string;
  language: string;
  caregiver_name: string;
  caregiver_phone: string;
  doctor_name: string;
  address: string;
  breakfast: string;
  lunch: string;
  dinner: string;
};

const toForm = (p: Patient): Form => ({
  name: p.name ?? "",
  preferred_name: p.preferred_name ?? "",
  phone: p.phone ?? "",
  language: languageOption(p.language ?? "en"),
  caregiver_name: p.caregiver_name ?? "",
  caregiver_phone: p.caregiver_phone ?? "",
  doctor_name: p.doctor_name ?? "",
  address: p.address ?? "",
  breakfast: p.meal_times?.breakfast ?? "",
  lunch: p.meal_times?.lunch ?? "",
  dinner: p.meal_times?.dinner ?? "",
});

export function EditPatientDialog({
  patient,
  open,
  onOpenChange,
  onSaved,
}: {
  patient: Patient;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(() => toForm(patient));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const up = (k: keyof Form) => (e: { target: { value: string } }) => setF((d) => ({ ...d, [k]: e.target.value }));

  // Start from the latest saved values every time the dialog opens.
  const handleOpen = (o: boolean) => {
    if (o) {
      setF(toForm(patient));
      setErrors({});
    }
    onOpenChange(o);
  };

  async function save() {
    const initial = toForm(patient);
    const errs: Partial<Record<keyof Form, string>> = {};
    if (!f.name.trim()) errs.name = "A name is required.";
    const phone = toE164(f.phone);
    if (!phone) errs.phone = "Enter a full phone number, like +1 817 555 0142.";
    const cgPhone = f.caregiver_phone.trim() ? toE164(f.caregiver_phone) : "";
    if (cgPhone === null) errs.caregiver_phone = "Enter a full phone number, like +1 469 555 0188, or leave it empty.";
    setErrors(errs);
    if (Object.keys(errs).length || !phone) return;

    // Send only what changed, so nothing the person did not touch (like their language) is overwritten.
    const body: UpdatePatientBody = {};
    if (f.name.trim() !== initial.name) body.name = f.name.trim();
    if (f.preferred_name.trim() !== initial.preferred_name) body.preferred_name = f.preferred_name.trim();
    if (phone !== toE164(initial.phone)) body.phone = phone;
    if (f.language && f.language !== initial.language) body.language = f.language;
    if (f.caregiver_name.trim() !== initial.caregiver_name) body.caregiver_name = f.caregiver_name.trim();
    if ((cgPhone ?? "") !== (toE164(initial.caregiver_phone) ?? "")) body.caregiver_phone = cgPhone ?? "";
    if (f.doctor_name.trim() !== initial.doctor_name) body.doctor_name = f.doctor_name.trim();
    if (f.address.trim() !== initial.address) body.address = f.address.trim();
    if (f.breakfast !== initial.breakfast || f.lunch !== initial.lunch || f.dinner !== initial.dinner) {
      body.meal_times = { breakfast: f.breakfast, lunch: f.lunch, dinner: f.dinner };
    }
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await api.updatePatient(patient.id, body);
      toast.success("Details saved.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen} title="Edit details" description={`Changes apply to Pal's next call with ${patient.preferred_name || patient.name}.`}>
      <form
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Full name" htmlFor="ep-name" hint={errors.name}>
          <Input id="ep-name" value={f.name} onChange={up("name")} />
        </Field>
        <Field label="What Pal calls them" htmlFor="ep-pref" hint="Leave empty to use their first name.">
          <Input id="ep-pref" value={f.preferred_name} onChange={up("preferred_name")} />
        </Field>
        <Field label="Their iPhone number" htmlFor="ep-phone" hint={errors.phone ?? "Pal FaceTimes and texts this number."}>
          <Input id="ep-phone" type="tel" value={f.phone} onChange={up("phone")} aria-invalid={Boolean(errors.phone)} />
        </Field>
        <Field label="Language Pal speaks with them" htmlFor="ep-lang">
          <Select id="ep-lang" value={f.language} onChange={up("language")}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} {l.native !== l.label ? `· ${l.native}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Caregiver" htmlFor="ep-cg">
          <Input id="ep-cg" value={f.caregiver_name} onChange={up("caregiver_name")} />
        </Field>
        <Field label="Caregiver's phone" htmlFor="ep-cgp" hint={errors.caregiver_phone ?? "Pal calls and texts this number in an emergency."}>
          <Input id="ep-cgp" type="tel" value={f.caregiver_phone} onChange={up("caregiver_phone")} aria-invalid={Boolean(errors.caregiver_phone)} />
        </Field>
        <Field label="Doctor" htmlFor="ep-doc">
          <Input id="ep-doc" value={f.doctor_name} onChange={up("doctor_name")} />
        </Field>
        <Field label="Address" htmlFor="ep-addr" hint="Optional.">
          <Input id="ep-addr" value={f.address} onChange={up("address")} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          {(["breakfast", "lunch", "dinner"] as const).map((meal) => (
            <Field key={meal} label={meal[0]!.toUpperCase() + meal.slice(1)} htmlFor={`ep-${meal}`}>
              <Input id={`ep-${meal}`} type="time" value={f[meal]} onChange={up(meal)} />
            </Field>
          ))}
        </div>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={() => handleOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
