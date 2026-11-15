# PillPal web — caregiver and doctor portal (Role 1 · Frontend)

Next.js 16 (App Router) · Tailwind CSS 4 · Recharts · Supabase Realtime · Radix Dialog · Lucide icons · Sonner toasts.
Font: Urbanist, bundled via Fontsource (no network fetch at build).

## Run

```bash
cd web
cp .env.example .env.local   # mocks are on by default
npm install
npm run dev                  # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (clean) |
| `npm run typecheck` | `tsc --noEmit` (used by root `npm run check`) |

## Pages

| Route | For | What it shows |
| --- | --- | --- |
| `/` | Everyone | Today's dose count for the patient and a choice of view |
| `/caregiver` | Caregiver | Patient header (language badge), urgent red-alert banner (FaceTime / Call 911 / I'm handling it), today's dose timeline with a 6 am–10 pm ruler, **live Call room** (transcript in the patient's language + English, pill/plate check verdicts), "How she's doing" check-in with quotes and camera observations, alerts, 7-day chart, demo controls |
| `/doctor` | Doctor | "Write this week's brief" → headline, adherence by medicine, mood trend, flagged moments with quotes, questions for the doctor; medicines table with **Change dose** dialog that notifies the family |
| `/onboard` | Caregiver / doctor | 3 steps: patient details (30 Gemini Live languages) + consent → medicines from a **label photo** (AI-read, editable) + pill reference photo → review and start |

## Mock mode vs live API

`NEXT_PUBLIC_USE_MOCKS=true` (default) runs a full in-browser simulation of the backend, including a scripted
check-in call (Spanish, wrong pill caught, right pill logged), the red-flag escalation into a group FaceTime,
the iMessage ❤️ reminder, label parsing, and the weekly brief. It is also the **stage backup** if the API is down.

Set `NEXT_PUBLIC_USE_MOCKS=false` after the backend merges. The portal then:

- calls the REST API at `NEXT_PUBLIC_API_URL` (contracts §5.3): `POST /patients`, `POST /rx/parse` (multipart `photo`),
  `POST /medications` (JSON `CreateMedicationBody` with `pill_photo_b64`), `PATCH /medications/:id`, `POST /notify/dose-change`,
  `POST /reports/generate`, `POST /dial`, `POST /demo/remind`
- reads Supabase with the anon key and re-reads on Realtime changes to `dose_events`, `alerts`, `check_ins`, `calls`, `medications`
- marks alerts handled by updating `alerts.acknowledged_at`

## Notes for Role 3 (merge)

- All data types come from `@pillpal/shared` (`src/lib/types.ts` only re-exports them and adds UI view types).
  Nullable columns get defaults once at load time in `src/lib/normalize.ts`.
- `typecheck` / `build` run `tsc -b ../packages/shared` first so the shared `.d.ts` files exist in CI.
- No AI keys or model calls in the browser; every AI step goes through the API.
- The live transcript in the Call room needs call events. With the real backend, the room shows call status and
  verdicts that land in Supabase; a `call_events` table (call_id, kind, payload jsonb) published to Realtime would
  let it stream the full transcript too (optional, nice for the demo).
- `.env.example` is committed (`!.env.example` in `.gitignore`).

## Design system ("fresh lime clinic")

Layout: white sidebar (menu with lime active marker) · centre column (lime welcome banner with blister-pack art,
white 28 px-radius cards) · dark charcoal right panel on the caregiver view (profile, week strip, coming-up doses, call card).

| Token | Hex | Use |
| --- | --- | --- |
| mist | `#ECEEEA` | app background |
| paper | `#FFFFFF` | cards, sidebar |
| ink | `#1E271C` | text |
| lime / lime-deep | `#A3E635` / `#84CC16` | brand, primary buttons (dark text on lime), charts |
| char / char-2 | `#2F362D` / `#3B4339` | right panel, live-call header |
| teal (leaf) | `#3F6212` | links, small accents (AA with white) |

Font: Urbanist (Fontsource, bundled). Status is never colour alone: every chip has an icon and a word.
17 px base text, 44 px touch targets, visible focus rings, skip link, `prefers-reduced-motion` respected.
