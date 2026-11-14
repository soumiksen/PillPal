# PillPal

PillPal is a medication companion that lives inside FaceTime and iMessage. At pill time its AI agent "Pal" FaceTimes the patient, looks at the pill and the plate through the camera, logs the dose, and pulls the caregiver into a group FaceTime when something is wrong. Pal speaks the patient's language. Caregivers and doctors use a web portal. The patient installs nothing.

## Workspace layout

| Path | Owner | What |
|---|---|---|
| `web/` | Role 1 · Frontend | Next.js caregiver + doctor portal on `:3000` (not created yet) |
| `api/` | Role 2 · Backend | Hono REST API on `:8787`, Chert iMessage + FaceTime, scheduler |
| `supabase/` | Role 2 · Backend | `schema.sql`, `seed.sql` |
| `agent/` | Role 3 · AI Eng. | Pal, the LiveKit voice/video agent (not created yet) |
| `packages/shared/` | Role 3 | `@pillpal/shared` — zod schemas + TS types for every DB row, API body, AI return type |
| `packages/ai/` | Role 3 | `@pillpal/ai` — every Claude + Gemini call (stubs for now) |
| `docs/contracts.md` | Role 3 | The shared contracts. Read this first. |

## How to run

Requires Node 22+ (`nvm use`).

```bash
npm install
cp .env.example .env      # fill in values; never commit .env
npm run check             # typecheck + build every workspace (what CI runs)
npm run dev               # currently starts the API on http://localhost:8787 (GET /health)
```

Contributing: read [`CLAUDE.md`](CLAUDE.md) and [`docs/contracts.md`](docs/contracts.md). Work on `fe/*`, `be/*` or `ai/*` branches and open a PR into `main`.
