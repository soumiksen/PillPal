# PillPal

PillPal is a medication companion that lives inside FaceTime and iMessage. At pill time its AI agent "Pal" FaceTimes the patient, looks at the pill and the plate through the camera, logs the dose, and pulls the caregiver into a group FaceTime when something is wrong. Pal speaks the patient's language. Caregivers and doctors use a web portal. The patient installs nothing.

## Workspace layout

| Path | Owner | What |
|---|---|---|
| `web/` | Role 1 · Frontend | Next.js caregiver + doctor portal on `:3000` (not created yet) |
| `api/` | Role 2 · Backend | Hono REST API on `:8787`, Chert iMessage + FaceTime, scheduler |
| `supabase/` | Role 2 · Backend | `schema.sql`, `seed.sql` |
| `agent/` | Role 3 · AI Eng. | Pal, the LiveKit voice/video agent |
| `packages/shared/` | Role 3 | `@pillpal/shared` — zod schemas + TS types for every DB row, API body, AI return type |
| `packages/ai/` | Role 3 | `@pillpal/ai` — every Claude + Gemini call (real when `ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` are set, offline stubs otherwise) |
| `docs/contracts.md` | Role 3 | The shared contracts. Read this first. |

## How to run

Requires Node 22+ (`nvm use`).

```bash
npm install
cp .env.example .env      # fill in values; never commit .env
npm run check             # typecheck + build every workspace (what CI runs)
npm run dev               # currently starts the API on http://localhost:8787 (GET /health)
```

## Phone demo (web calls)

Pal calls from our own FaceTime-style web apps (LiveKit Cloud), not Chert FaceTime. Chert iMessage still sends
reminders and alerts. `CALL_TRANSPORT=facetime` brings back the old Chert FaceTime path.

| Phone | Open in Safari, then Share → Add to Home Screen | App |
| --- | --- | --- |
| Patient | `https://<web host>/patient` | **PillPal** (Helen icon) |
| Caregiver | `https://<web host>/caregiver` | **PillPal Care** (heart icon) |

On first open, type `DEMO_ACCESS_CODE` once. Then tap **Start** every time the app is opened: it turns on sound
and keeps the screen awake. Leave both apps open on "Waiting for calls".

On the laptop, run:

```bash
npm run demo:up     # [api] CALL_TRANSPORT=web SCHEDULER=on  +  [pal] the agent worker, prefixed logs
```

- At each dose time the scheduler rings the patient's app. If nobody answers in 45 s, it rings once more after
  `REMINDER_TIMEOUT_MIN`.
- Ring at a set time: `curl -X POST localhost:8787/demo/call-at -H "x-demo-code: $DEMO_ACCESS_CODE" -H 'content-type: application/json' -d '{"patient_id":"…","at":"14:05","kind":"check_in"}'`
  (America/Chicago time).
- If the patient asks for her caregiver, or there is a red flag, Pal says "{caregiver} is joining us now" and the
  caregiver's app rings into the same call. The caregiver also gets the iMessage alert. Pal never calls 911.
- Dry run with no texts sent: `SCHEDULER=off CHERT_MODE=mock npm run demo:up`. Shell values override the defaults.
- To run the web app locally: `npm run dev:demo -w @pillpal/web` (uses the root `.env`).
- The portal's pill-box dashboard is now at `/dashboard`. `/caregiver` is the phone app.

Contributing: read [`CLAUDE.md`](CLAUDE.md) and [`docs/contracts.md`](docs/contracts.md). Work on `fe/*`, `be/*` or `ai/*` branches and open a PR into `main`.
