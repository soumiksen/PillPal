# PillPal Odyssey companions

Four original Homer-inspired faces: Helen, Odysseus, Agamemnon, and a gentle Cyclops. The appearance layer leaves Pal's Gemini voice, Claude vision, medication instructions, and escalation tools unchanged. It does not impersonate a clinician. These are original character designs, not actor likenesses.

## Review the characters without credentials

From the repository root:

```sh
npm ci
npm run avatars:preview -w @pillpal/agent
```

Open **http://localhost:8790**. Choose a character, listening/speaking/thinking state, and preview mode. Shuffle changes to a different face. Pause motion and reduced-motion preferences are supported. This gallery is a developer review surface, not a patient app.

For a portable offline preview, run `npm run avatars:export -w @pillpal/agent -- /absolute/output/PillPal_Avatar_Preview.html`. Open the exported HTML in a browser. All portraits and animation code are embedded; it needs no server, internet connection, microphone, or API key. This tests appearance and controls, not a real conversation.

The **Animated 2D** preview uses the same SVG rig as the real video publisher. The **3D-style portrait** preview is still artwork, not a rigged 3D model or a live provider session.

## Run in a call

### Test on your own computer before merging

Use Node 22+. From the feature branch's repository root, run `npm ci`. Create `.env.avatar-test` locally in the repository root using the settings below, then fill in the blank credentials in your editor. This dedicated file is ignored by Git; the test does not load your normal `.env` file. No environment file or credentials are distributed with these changes.

Start with the animated 2D provider, Helen, and Spanish:

```dotenv
PAL_AVATAR_PROVIDER=illustrated
PAL_AVATAR=helen
DEMO_LANGUAGE=es
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
GOOGLE_API_KEY=
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
ANTHROPIC_API_KEY=
```

For LiveKit Cloud, enter the URL, API key, and API secret from a test project. `GOOGLE_API_KEY` is required for voice; `ANTHROPIC_API_KEY` is optional for real camera analysis. LemonSlice credentials are unnecessary for `illustrated`. Check only whether each required variable is present; never print values or paste credentials into an issue or PR.

On Windows ARM64 (such as an ARM-based Surface), run the worker in WSL2/Linux. The installed LiveKit native SDK has Linux ARM64 and Windows x64 binaries, but no Windows ARM64 binary. Chrome can remain on Windows.

For WSL2, install a Linux distribution and Node 22+ there, use a checkout on the Linux filesystem, and run `npm ci` inside WSL rather than reusing Windows `node_modules`. Create the ignored credentials file in that checkout and run the same `avatars:call` command. Open `http://localhost:8788` in Windows Chrome after the runner reports Ready.

If a restricted Windows terminal fails with `uv_os_get_passwd ENOMEM` while importing `tsx`, the application has not started. Retry the command in your own ordinary PowerShell terminal with Node 22+ available. This error alone does not establish an ARM compatibility problem or a provider credential error.

For hosted talking portraits, configure `GOOGLE_API_KEY`, `LEMONSLICE_API_KEY`, and all three LiveKit values (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) from a **test LiveKit Cloud project** reachable by LemonSlice. Then run:

```sh
npm run avatars:call -w @pillpal/agent
```

Wait for **Ready: open http://localhost:8788**, open that address in Chrome, choose a character, click **Start call**, and allow microphone/camera access. The page uses a fictional patient and a mock REST API; dose logging and caregiver alerts are simulated. It does not place a FaceTime call. The runner uses a unique test-agent name and overrides any production API URL or patient ID inherited from the shell. Ctrl+C stops its two local processes.

To test 2D with voice, set `PAL_AVATAR_PROVIDER=illustrated`; LemonSlice is then unnecessary. Keep your LiveKit Cloud values, or leave all three LiveKit variables blank and run `livekit-server --dev` in another terminal. `GOOGLE_API_KEY` is still needed for a real conversation. Add `ANTHROPIC_API_KEY` only when testing real camera analysis; otherwise vision uses the existing offline stubs.

Try: a greeting, a short conversation, an interruption, each character on a new call, camera off/on, hang up, and reconnect. Hosted animation and real FaceTime remain acceptance tests to run with provider access.

The agent defaults to built-in illustration. It publishes a 368×560 camera track named `pal-avatar-video` on Pal's existing LiveKit participant, with breathing, blinks, subtle head motion, and a speaking-state mouth. It needs no additional avatar-service account. Mouth movement is approximate; it is not phoneme lip sync.

Set these variables in your local agent environment or deployment secret settings (never commit secret values):

| Variable | Values / behavior |
| --- | --- |
| `PAL_AVATAR_PROVIDER` | `illustrated` (default), `lemonslice`, or `off` |
| `PAL_AVATAR` | `stable` (default), `random`, `helen`, `odysseus`, `agamemnon`, or `cyclops` |
| `LEMONSLICE_API_KEY` | Required only for hosted portrait animation |
| `AVATAR_PREVIEW_PORT` | Local gallery port, default `8790` |

`stable` hashes the patient ID so repeated calls show the same face. `random` picks once per call, never halfway through a conversation. Prefer stable selection for the patient experience; randomization is useful for the hackathon demo. This is deterministic selection, not a stored user preference.

Optional LiveKit dispatch metadata overrides the face for one call:

```json
{"patient_id":"your-patient-id","kind":"check_in","avatar_id":"helen"}
```

Only the four allowlisted IDs are accepted. Invalid metadata face IDs are ignored; invalid environment configuration raises a clear configuration error. `PAL_AVATAR_PROVIDER=off` restores the prior voice-only behavior.

The existing localhost call harness now has a character picker and remote Pal video. Run its existing `dev:local` / `dev:agent` commands with a local LiveKit server and your existing voice-model credentials. The artwork gallery alone does not need LiveKit or Gemini.

## Hosted talking portraits

Set `PAL_AVATAR_PROVIDER=lemonslice` and configure `LEMONSLICE_API_KEY` securely. The official `@livekit/agents-plugin-lemonslice` plugin receives the bundled portrait and animates Pal's existing Gemini audio. It also needs the existing `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`; the LiveKit URL must be reachable by the hosted service, not a localhost-only room.

The plugin starts **before** `AgentSession.start`, routes generated audio through its avatar participant, and publishes audio/video on behalf of Pal. Do not separately publish another voice track: Chert requires exactly one eligible audio publisher. The avatar participant has LiveKit agent kind, so `ctx.waitForParticipant()` excludes it when waiting for the patient. Patient-camera handling also excludes agent participants and ignores their mute/unsubscribe events.

If the provider key is absent, Pal falls back to the built-in illustration before provisioning begins. If hosted provisioning fails after it begins, the call job fails explicitly instead of risking a second audio publisher after an ambiguous timeout. Select `illustrated` and retry. No automatic mid-call provider failover is implemented.

The generated portraits are PNG assets in `agent/assets/avatars/`. They must travel with both `agent/src` and `agent/dist`; the path resolver supports development and compiled execution. Keep this directory in your deployment image. A Docker build that copies only `dist/` will need to copy `assets/` too.

## Chert acceptance test

The local rendering/build checks do **not** prove FaceTime interoperability. On a test line:

1. Enable agent video with `media: { audio: true, video: true }`; caller-camera capture is a separate setting.
2. Test `illustrated` first. Confirm Pal's face, one audible voice, and the existing bridge-ready greeting behavior.
3. Confirm the patient's camera still reaches vision while the avatar is visible.
4. Switch to `lemonslice` only after configuring provider access and a reachable LiveKit room. Check startup/greeting latency against Chert's readiness requirements. Provisioning is not prewarmed and may add latency.
5. Try all four faces, especially Cyclops: a one-eyed nonhuman face may animate less reliably in a portrait model. Use the illustrated Cyclops if anatomy changes.
6. Interrupt Pal, turn the caller camera off/on, hang up, and repeat a call. Verify no lingering avatar participant, duplicate audio, or video loop after shutdown.

Do not present the still portraits as tested live 3D animation. The local 2D rig is the dependency-light demo path; hosted portrait animation requires a real call acceptance test.

## Validation

```sh
npm test -w @pillpal/agent
npm run avatars:test -w @pillpal/agent
npm run check
```

The tests cover stable/random selection and overrides, asset availability, rasterization of each character/state, gallery controls and HTTP routes, and rejection of avatar events by patient-camera handling. Full Chert/Gemini/LemonSlice network calls require your provider access and are not mocked as successful.

Official integration references:

- https://docs.livekit.io/agents/models/avatar/plugins/lemonslice/
- https://docs.livekit.io/transport/media/raw-tracks/
- https://docs.trychert.com/facetime/bring-your-own-room

Portraits were generated specifically for this project; the fallback illustrations are editable vector artwork generated by `agent/src/avatars/illustration.ts`.
