"use client";
import { Heart } from "lucide-react";
import type { CallRole } from "@pillpal/shared";

export function CallerPhoto({ role, size }: { role: CallRole; size: number }) {
  // The patient app is called by Pal (Helen's portrait); the caregiver app shows a heart for the patient.
  if (role === "patient") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/call/pal-photo.jpg" alt="Pal" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
    );
  }
  return (
    <div className="flex items-center justify-center rounded-full bg-rose-600" style={{ width: size, height: size }}>
      <Heart fill="white" color="white" style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden />
    </div>
  );
}

export function RoundButton({
  label,
  color,
  onClick,
  children,
  size = 88,
  pressed,
}: {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
  size?: number;
  pressed?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={`flex items-center justify-center rounded-full text-white ${color}`}
        style={{ width: size, height: size }}
      >
        {children}
      </button>
      <span className="text-lg text-white/85">{label}</span>
    </div>
  );
}
