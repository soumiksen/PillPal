# @pillpal/api

Hono REST API on `:8787` (Role 2 · Backend). Bodies and responses are typed and validated with the zod
schemas from `@pillpal/shared`. All AI goes through `@pillpal/ai` (never a model API directly).
Every endpoint in contracts 5.3 reads and writes Supabase; there are no stubs left in `api/`.

## Run

```bash
npm install                 # from repo root
cd api
npm run seed:patient        # once: demo patient Rose + 3 meds, prints the patient id
npm run seed:history        # once: 7 days of history for Rose (idempotent; prints row counts)
npm run dev                 # http://localhost:8787 (tsx watch)
```

Env is read from the repo-root `.env` via `--env-file=../.env`, and only through `src/env.ts`. If a required
variable is missing, the process exits and names it (never prints values).

## Environment (names only)

| Name | Default | Used for |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | required | database (service key, server only) |
| `PORT`, `WEB_ORIGIN` | `8787`, `http://localhost:3000` | server, CORS |
| `PATIENT_ID`, `PATIENT_PHONE`, `CAREGIVER_PHONE`, `DEMO_LANGUAGE` | — | demo fallbacks + log role labels |
| `CHERT_MODE` | `mock` | iMessage transport: `mock` \| `live` \| `shared` |
| `CHERT_MSG_TOKEN`, `CHERT_FROM`, `CHERT_WEBHOOK_SECRET`, `CHERT_TENANT` | — | `CHERT_MODE=live` (Messaging API) |
| `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID` | — | `CHERT_MODE=shared` and `CHERT_FACETIME_MODE=live` (project key `ftk_…`) |
| `CHERT_APP_BASE` | `https://app.trychert.com/api/v1` | shared-messages base (override only) |
| `CHERT_FACETIME_MODE` | `mock` | FaceTime calls: `mock` \| `live` |
| `CHERT_FACETIME_BASE` | `https://facetime.trychert.com/api` | Calls API base (override only) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `AGENT_NAME` | `AGENT_NAME=pillpal-agent` | `CHERT_FACETIME_MODE=live` |
| `SCHEDULER` | `off` | `on` = node-cron every minute (America/Chicago) |
| `REMINDER_TIMEOUT_MIN`, `MISSED_AFTER_MIN` | `2`, `60` | scheduler timings |
| `PHARMACY_NAME`, `PHARMACY_ADDRESS`, `PHARMACY_LAT`, `PHARMACY_LNG` | — | low-pill message; lat/lng add a location pin (live only) |

Boot fails naming what is missing: `live` needs the three Messaging keys; `shared` needs `CHERT_API_KEY`,
`CHERT_PROJECT_ID`, `CHERT_LINE_ID`; FaceTime `live` needs those plus the three `LIVEKIT_*`.

## npm scripts

| Script | What |
|---|---|
| `npm run dev` / `npm start` | watch mode / run `dist/`, both with the root `.env` |
| `npm run build` · `npm run typecheck` | `tsc -b` · typecheck `src/`, `scripts/`, `test/` |
| `npm run seed:patient` | idempotent demo patient (prints only the id) |
| `npm run seed:history` | idempotent 7-day history for Rose (same rows as `supabase/seed.sql`; prints counts) |
| `npm run chert:ping` | one read-only iMessage request: live `GET /phone-numbers`; shared `GET /shared-messages` (status + field names); mock skips |
| `npm run facetime:ping` | one read-only `GET /v1/lines` (status, field names, whether `CHERT_LINE_ID` is listed); mock skips |
| `npm test` | unit tests, no network (`fetch` stubbed): shared-messages body/headers/rate guard, FaceTime call body + bridge token |
| `npm run test:e2e` | full mock pass on Supabase (mock Chert + FaceTime, AI stubs); deletes its rows afterwards. Needs port 8797 |

## Endpoints (contracts 5.3)

| Method + path | Body (`@pillpal/shared`) | Response |
|---|---|---|
| `GET /health` | — | `OkResponse` |
| `GET /patients/:id/context` | — | `PatientContext` |
| `POST /patients` · `PATCH /patients/:id` | `CreatePatientBody` · `UpdatePatientBody` | `IdResponse` |
| `POST /rx/parse` | multipart, file field `image` (`photo` also accepted) | `RxFields` |
| `POST /medications` · `PATCH /medications/:id` | JSON, or multipart fields + file `pill_photo` | `IdResponse` |
| `POST /doses` | `CreateDoseBody` (→ `taken` decrements `pills_left` once) | `IdResponse` |
| `POST /symptoms` · `POST /memories` | `SymptomBody` · `MemoryBody` | `OkResponse` · `IdResponse` |
| `POST /calls/started` | `CallStartedBody` (reuses the row `/dial` created for that room) | `IdResponse` |
| `POST /calls/ended` | `CallEndedBody` → `ai.extractCheckIn`; orange → alert + caregiver text; red → escalate; frees the line | `CallEndedResponse` |
| `POST /escalate` | `EscalateBody` (responds after alert + caregiver text; call part is async) | `EscalateResponse` (`group_call_id: null`) |
| `POST /dial` | `DialBody` | `DialResponse`; `409 {error:"line_busy"}` while a call is active |
| `POST /demo/remind` | `DemoRemindBody` | `DemoRemindResponse` |
| `POST /reports/generate` | `GenerateReportBody` → last 7 days → `ai.weeklyBrief` → `reports` row | `Brief` |
| `POST /notify/dose-change` | `DoseChangeBody` | `DoseChangeResponse` + `messages: [{kind, id}]` |

Errors are JSON: `400 validation_error`, `404 not_found`, `409` (`line_busy`, `patient_has_no_phone`,
`medication_not_for_patient`), `429 shared_messages_rate_limited`, `500 internal_error`. The request logger
prints method, path, status and duration only.

### Dev routes (registered when `CHERT_MODE` is `mock` or `shared`)

| Route | Body | Does |
|---|---|---|
| `POST /dev/chert/event` | raw Chert envelope `{event_id, event_type, data}` | runs `handleEvent` (same id twice → `duplicate`) |
| `POST /dev/chert/tapback` | `{message_id, kind?="love"}` | simulated `reaction.added` (the only way to tapback on Shared) |
| `POST /dev/chert/text` | `{patient_id, text}` | simulated `message.received` from the patient |
| `GET /dev/chert/outbox` | — | mock outbox `{messages:[{id, kind, to, at}]}` (role labels only) |
| `POST /dev/scheduler/tick` | — | one scheduler pass now → counts |
| `GET /dev/facetime/line` | — | who holds the FaceTime line (ids + kind) |
| `POST /dev/facetime/fail-next-group` | `{code?}` | mock FaceTime: next group call is refused (tests the fallback) |

## Mock / shared / live iMessage

`CHERT_MODE` picks the implementation behind one `ChertMessaging` interface (`src/chert/messaging.ts`).

| | `mock` (default) | `shared` | `live` |
|---|---|---|---|
| API | none: logs `[chert-mock] <method> → patient\|caregiver`, in-memory outbox | `POST https://app.trychert.com/api/v1/shared-messages` `{line_id, recipient, text}`, `Authorization: Bearer CHERT_API_KEY`, `X-Chert-Project-Id`, fresh `Idempotency-Key` | `https://console.trychert.com/api/v1`, `Bearer CHERT_MSG_TOKEN` |
| Inbound | `/dev/chert/*` | polls `GET /shared-messages` every 5 s → `handleEvent`; `/dev/chert/*` also on | SSE `/events/stream` + `POST /webhooks/chert` |
| Tapback ❤ | `/dev/chert/tapback` | not reported by Shared: the reminder asks for a **"taken" reply**; a `Loved "…"` text also counts; or `/dev/chert/tapback` | `reaction.added` |
| Voice note | outbox | sent as text `🔊 …` | `/voice-notes` + `/send` |
| Care Circle chat | outbox | 1:1 text to the caregiver `👥 Care Circle — …` | `/chats` (created once, id saved in `patients.care_chat_id`) |
| Pharmacy pin | outbox | text: name, address, map link | `/locations` |
| 🎉 effect | outbox | text starting with 🎉 | `effect: "celebration"` |
| Pal's ❤ on a "took it" text | outbox | `[shared] react not supported` (the reply confirms the dose instead) | `/messages/{id}/react` |
| Limits | — | **90 messages / rolling hour** (plan: 100), then `429` + a clear log | Chert's |

All three feed `handleEvent()` (`src/chert/events.ts`): dedupe on `event_id` in `chert_events`; heart tapback →
dose `taken` (+ `pills_left − 1`); text → `ai.classifyMessage` (red flag or "took two" → escalate); image →
`ai.checkPill`; voice memo → `downloadAttachment` → ffmpeg 16 kHz mono WAV → `ai.transcribe` → classified like a
text (skipped with one log line if `ffmpeg` is not installed).

Shared-line facts (skills.md): verified phones only; trial = the agent only replies within 24 h of the phone's last
text; text ≤ 4,000 chars. The response shapes of `/shared-messages` are not documented, so the message id is read from
`data.id` or `id`, and the poller accepts common field spellings and logs field **names** once if it cannot parse an item.

## FaceTime (`CHERT_FACETIME_MODE`)

`src/chert/facetime.ts`. `dial(patient, kind)` → LiveKit room `pillpal-<kind>-<8 hex>` → `AgentDispatchClient` dispatch of
`AGENT_NAME` with metadata `{patient_id, kind}` → bridge token (identity `chert-bridge-<uuid>`, join/publish/subscribe on that
room only, integer `nbf`/`exp`, ttl 3600 s) → `POST /v1/calls` (`direction:"outbound"`, `mode:"customer_managed"`,
`destination_type:"phone"`, `media:{audio:true, video:true}`, `remote_participant_identity: AGENT_NAME`, fresh
`Idempotency-Key`) → `calls` row. Group calls send `recipients:[{type:"phone_number", value}]` instead.
One line = one call: a second dial → `409 line_busy`. The line frees when `/calls/ended` arrives for that room, when
`endCall` + `waitUntilEnded` sees a terminal state, or (live) when the 3 s call-state watcher sees one; it then logs
the call's event type names from `GET /v1/calls/{id}/events`. `mock` makes no Chert or LiveKit request.

**Escalation** (`src/services/escalate.ts`, used by `/escalate`, red-flag texts and red check-ins): red alert →
caregiver text "🔴 PillPal alert for {name}: {reason}. Pal is calling you both on FaceTime now. If this is an emergency,
call 911." → response (< 5 s) → async: end the active 1:1 call and wait ≤ 10 s → group call `[patient, caregiver]`, kind
`escalation` → on any refusal (`facetime_group_unavailable`, `recipient_not_verified`, …) caregiver text "Please FaceTime
{name} now." and `alerts.sent_to = caregiver,fallback_text:<code>`. Never calls 911.

## Scheduler (`SCHEDULER=on`)

`src/scheduler.ts`, node-cron every minute (America/Chicago), no overlapping runs: a med time due in the last 60 min with
no `dose_event` → pending event + reminder (translated) with the message id; pending > 2 min and the line free → one
`dial(patient,"dose")`; pending > 60 min → `missed`; 2+ missed today → orange alert + caregiver text (once a day); 3
taken in a row (newest today) → 🎉 once per streak; `pills_left ≤ 5` → caregiver text + pharmacy info once a day per med.

## Live FaceTime test

1. **Stop `chert dev`** (it holds the line; 1 line = 1 call).
2. In the root `.env`: `CHERT_FACETIME_MODE=live` with `CHERT_API_KEY`, `CHERT_PROJECT_ID`, `CHERT_LINE_ID`,
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Patient phone must be verified for the project.
3. Start Pal as a LiveKit worker on the **same LiveKit project** with `AGENT_NAME=pillpal-agent` (agent/).
4. `cd api && npm run facetime:ping` → expect `200` and `CHERT_LINE_ID found`.
5. `npm run dev`, then
   `curl -s -XPOST localhost:8787/dial -H 'content-type: application/json' -d '{"patient_id":"<PATIENT_ID>","kind":"check_in"}'`
   → `{chert_call_id, room_name}` (201 from Chert = allocated, not answered).
6. Answer on the iPhone. **Keep the call under 1 minute**, then hang up. The log shows `[facetime] call status …` and
   the event type names; a second `/dial` during the call returns `409`.

## Demo runbook (worksheet section 7)

| Step | What happens | Endpoint / route |
|---|---|---|
| 1 Hook | talk only | — |
| 2 Onboarding | label photo → fields → confirm | `POST /rx/parse` → `POST /patients` / `PATCH /patients/:id` → `POST /medications` (photo → `ai.describePill`) |
| 3 Live FaceTime | "Start check-in call" → iPhone rings → pill + plate check → dashboard green | `POST /dial` → agent: `GET /patients/:id/context`, `POST /calls/started`, `POST /doses` (realtime `dose_events`), `POST /symptoms`, `POST /calls/ended` → `check_ins` |
| 4 Multilingual | Rose switches to Spanish; dashboard shows quote + English | agent; `POST /calls/ended` saves `language` + quotes `{original, english}` |
| 5 iMessage | "Send reminder" → Rose's language → ❤ → green | `POST /demo/remind` → live: `reaction.added`; shared: Rose replies "taken" (poll) or `POST /dev/chert/tapback`; mock: `POST /dev/chert/tapback` |
| 6 Escalation | "I feel dizzy and I think I took two" → red alert → group FaceTime | agent `POST /escalate` (or a red-flag text via `handleEvent`) → alert + caregiver text → group call or "Please FaceTime Rose now." |
| 7 Doctor | weekly brief → dose change → text + voice note | `POST /reports/generate` → `POST /notify/dose-change` |
| 8 Close | talk only | — |
