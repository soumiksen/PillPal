import type { Metadata, Viewport } from "next";

/** Home-screen app metadata: own manifest, apple-touch-icon, standalone on iOS, black status bar. */
export function callAppMetadata(role: "patient" | "caregiver"): Metadata {
  const name = role === "patient" ? "PillPal" : "PillPal Care";
  const icon = role === "patient" ? "/call/pal-180.png" : "/call/care-180.png";
  return {
    title: name,
    description: role === "patient" ? "Pal calls you when it's time for your medicine." : "Join your loved one's PillPal calls.",
    manifest: `/${role}.webmanifest`,
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: "black-translucent" },
    icons: { icon: [{ url: icon.replace("180", "192"), sizes: "192x192" }], apple: [{ url: icon, sizes: "180x180" }] },
    other: { "apple-mobile-web-app-capable": "yes", "mobile-web-app-capable": "yes" },
    robots: { index: false, follow: false },
  };
}

export const callAppViewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};
