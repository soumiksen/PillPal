import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "PillPal — care, one FaceTime away",
  description: "Caregiver and doctor portal for PillPal, the medication companion that checks in over FaceTime and iMessage.",
};

export const viewport: Viewport = { themeColor: "#EEE3D2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "var(--font-sans)", fontSize: 15 } }} />
      </body>
    </html>
  );
}
