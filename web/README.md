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
| `/` | Everyone | **Sign in / Create account** (email + password; choose Caregiver or Doctor at sign-up) |
| `/caregiver` | Caregiver | Patient header (language badge), urgent red-alert banner (FaceTime / Call 911 / I'm handling it), **this week's pill box**: 7 days × morning/midday/evening compartments whose lids open when a dose is confirmed (taken, wrong pill caught, missed, due), the latest wrong-pill catch, next compartment + "Start check-in call", lids-opened count, **live Call room** (transcript in the patient's language + English, pill/plate check verdicts), check-in with quotes and camera observations, alerts, demo controls |
| `/doctor` | Doctor | **Patient list**: patients who shared their code with you, with % taken, a 7-day strip, open alerts; add a patient by code; search by name |
| `/doctor/[patientId]` | Doctor | One patient's week: compact pill box, adherence by medicine, mood trend, flagged moments, "Write this week's brief" (summary + questions for the doctor), quotes with English, medicines with **Change dose** dialog that notifies the family |
| `/onboard` | Caregiver / doctor | 3 steps: patient details (30 Gemini Live languages) + consent → medicines from a **label photo** (AI-read, editable) + pill reference photo → review and start |

## Accounts and live data

The portal runs on the real API and Supabase by default. It needs `supabase/002_accounts.sql` applied once.

- **Sign up / sign in** with email + password (Supabase Auth). Pick Caregiver or Doctor at sign-up; the role is
  saved in `profiles` by a trigger. Turn off "Confirm email" in Supabase Auth settings so new accounts work at once.
- **Caregiver**: sets up a patient (`POST /patients` adds them to the patient's `care_team`), then sees that patient's
  pill box. Their page shows a 6-character **share code**.
- **Doctor**: enters a caregiver's share code (`join_patient` RPC) to add that patient to their list.
- **Row-level security**: a signed-in user reads only their own care team's rows; the anon key alone reads nothing.
- Every API call sends `Authorization: Bearer <Supabase access token>`; the API checks it and the care team.
- Reads Supabase with the user's session and re-reads on Realtime changes to `dose_events`, `alerts`, `check_ins`,
  `calls`, `medications`. Alerts are marked handled by updating `alerts.acknowledged_at`.
- The API's scheduler creates each day's pending `dose_events`, so the pill box fills in from day one.

`NEXT_PUBLIC_USE_MOCKS=true` is an emergency fallback only: an in-browser simulation with four fictional patients
and no accounts. Never use it for judging.

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
