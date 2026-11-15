import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "PillPal — care, one FaceTime away",
  description: "Caregiver and doctor portal for PillPal, the medication companion that checks in over FaceTime and iMessage.",
};

export const viewport: Viewport = { themeColor: "#F2F7F6" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
        <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "var(--font-sans)", fontSize: 15 } }} />
      </body>
    </html>
  );
}
