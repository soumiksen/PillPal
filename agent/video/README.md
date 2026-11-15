# Devpost video mode (branch `devpost` only)

Pal plays a fixed script: pre-recorded lines at fixed times, Helen's expressions, and actions. No Gemini session,
no listening, no LLM. Same phone apps, LiveKit rooms and Helen portrait as live Pal.

| What | How |
|---|---|
| Patient + meds | `npm run video:seed` (idempotent) → put the printed id in `.env` as `VIDEO_PATIENT_ID=` |
| Lines and timings | `agent/video/script.json` (seconds after the patient taps Accept; `caregiver_join` steps count from the caregiver joining) |
| Voices | `npm run video:voices` (Gemini TTS, voice Kore) → `voices/<id>.wav`; only new/changed lines are regenerated |
| Laptop | `npm run video:up` (API :8787 with scheduler off + agent with `PAL_MODE=script`) |
| Trigger | http://localhost:8787/director, or `npm run scene:1` / `scene:2` / `scene:reset` |
| Phones | https://pillpal-devpost.vercel.app/patient and /caregiver (dashboard: /dashboard) |
| Test | `npm run test:e2e:video` (see the header of `scripts/e2e-video.mjs`) |

The agent logs one `[script]` line per step with planned vs actual time. A missing WAV is logged and skipped.
Pal never talks over herself: if a line is still playing, the next one waits (the log shows the delay).
