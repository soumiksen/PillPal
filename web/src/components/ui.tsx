"use client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cva, type VariantProps } from "class-variance-authority";
import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 min-h-11",
  {
    variants: {
      variant: {
        primary: "bg-lime text-ink hover:bg-lime-deep",
        quiet: "bg-paper text-ink border border-line hover:border-ink/40",
        ghost: "text-ink-soft hover:text-ink hover:bg-mint-soft",
        danger: "bg-missed text-white hover:brightness-95",
      },
      size: {
        sm: "h-9 min-h-9 px-3 text-sm rounded-[10px]",
        md: "h-11 px-5 text-[15px] rounded-[14px]",
        lg: "h-14 px-7 text-[17px] rounded-[18px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export function Panel({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "aside" }) {
  return <As className={cn("rounded-[var(--radius-panel)] bg-paper", className)}>{children}</As>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[15px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-ink-faint">{hint}</p> : null}
    </div>
  );
}

const fieldBase =
  "w-full rounded-[var(--radius-field)] border border-line bg-paper px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-faint/80 hover:border-ink-faint/50 focus:border-lime-deep focus:outline-none focus:ring-3 focus:ring-mint transition-colors";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-12", className)} {...p} />
));
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(fieldBase, "h-12 cursor-pointer", className)} {...p} />
));
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-24", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]" />
        <RDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-[22px] bg-paper p-6 shadow-[var(--shadow-lift)] focus:outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="font-display text-2xl font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-ink-soft">{description}</RDialog.Description> : null}
            </div>
            <RDialog.Close className="rounded-full p-2 text-ink-faint hover:bg-mint-soft hover:text-ink cursor-pointer" aria-label="Close">
              <X className="size-5" />
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
