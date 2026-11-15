# @pillpal/api

Hono REST API on `:8787` (Role 2 · Backend). Bodies and responses are typed and validated with
the zod schemas from `@pillpal/shared`. All AI goes through `@pillpal/ai` (never a model API directly).

**Status: skeleton.** Every endpoint validates its body and returns realistic stub data; Supabase,
Chert and LiveKit wiring land in follow-up PRs.

## Run

```bash
npm install                 # from repo root
cd api
npm run seed:patient        # once: inserts demo patient Rose + 3 meds, prints the patient id
npm run dev                 # http://localhost:8787 (tsx watch)
```

Env is read from the repo-root `.env` via `--env-file=../.env`, and only through `src/env.ts`.
If a required variable is missing, the process exits and names it (never prints values).
Required: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. The seed also needs `PATIENT_PHONE`, `CAREGIVER_PHONE`.

| Script | What |
|---|---|
| `npm run dev` | watch mode with `.env` |
| `npm run build` | `tsc -b` → `dist/` |
| `npm start` | run `dist/` with `.env` |
| `npm run typecheck` | typecheck `src/` and `scripts/` |
| `npm run seed:patient` | idempotent demo-patient seed (prints only the id) |

## Endpoints (contracts 5.3)

| Method + path | Body (`@pillpal/shared`) | Response |
|---|---|---|
| `GET /health` | — | `OkResponse` |
| `GET /patients/:id/context` | — | `PatientContext` |
| `POST /patients` | `CreatePatientBody` | `IdResponse` (201) |
| `PATCH /patients/:id` | `UpdatePatientBody` | `IdResponse` |
| `POST /rx/parse` | multipart, file field `image` (`photo` also accepted) | `RxFields` |
| `POST /medications` | `CreateMedicationBody` as JSON, or multipart fields + file `pill_photo` | `IdResponse` (201) |
| `PATCH /medications/:id` | `UpdateMedicationBody` (JSON or multipart) | `IdResponse` |
| `POST /doses` | `CreateDoseBody` | `IdResponse` (201) |
| `POST /symptoms` | `SymptomBody` | `OkResponse` |
| `POST /memories` | `MemoryBody` | `IdResponse` (201) |
| `POST /calls/started` | `CallStartedBody` | `IdResponse` (201) |
| `POST /calls/ended` | `CallEndedBody` | `CallEndedResponse` |
| `POST /escalate` | `EscalateBody` | `EscalateResponse` |
| `POST /dial` | `DialBody` | `DialResponse` |
| `POST /demo/remind` | `DemoRemindBody` | `DemoRemindResponse` |
| `POST /reports/generate` | `GenerateReportBody` | `Brief` |
| `POST /notify/dose-change` | `DoseChangeBody` | `DoseChangeResponse` |

Multipart array fields (`times`, `avoid_foods`) may be a JSON array string or comma-separated.

Errors are JSON: `400 {error:"validation_error", issues:[{path,message}]}`, `404 {error:"not_found"}`,
`500 {error:"internal_error"}`. CORS allows `http://localhost:3000` (override with `WEB_ORIGIN`).
The request logger prints method, path, status and duration only — never bodies, query strings or phones.
