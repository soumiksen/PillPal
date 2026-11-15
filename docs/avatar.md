# PillPal — Pal's avatar: Helen (design and plan)

> Status: **proposal, nothing built yet.** Owner: Role 3 (everything lives in `agent/`). No contract changes needed.

## 1. Goal

Give Pal a face on the FaceTime call: **Helen**, the Helen of the Odyssey (Book 4, the serene hostess in Sparta),
who shows expressions that follow the conversation. Today the caller sees Chert's default picture, because the agent
publishes no video (the `chert dev` log says so, and `Pal's own face (agent video)` is an open item on the plan's
Chert scorecard). Chert's judging counts fresh use of FaceTime video double, so this is the highest-visibility item left.

Success looks like:

- the patient sees Helen's face on every call, from the first second, with no audio glitches;
- Helen blinks, looks at the camera, and her mouth moves with Pal's voice;
- her expression changes with the moment: listening, thinking, looking closely at a pill, pleased, concerned, calm and serious during an escalation;
- if anything in the avatar fails, the call carries on with voice only.

## 2. Constraints (from Chert's docs and our own logs)

| Constraint | Source | What it means for us |
|---|---|---|
| The agent's video must be published by the **same participant** that publishes the voice | Chert `facetime-cli/video` | Publish the avatar track from the agent's own `localParticipant`, not from a second participant or a browser page |
| Keep **exactly one** eligible audio publisher in the room | Chert `facetime-cli/video` | Do not add an avatar service that publishes its own voice unless the agent's audio is routed through it |
| Outbound calls expect the agent's video **before dialing** | Chert `facetime/outbound` | Start publishing at session start, not after the greeting |
| Agent already logs `process not scheduled; the host did not run the agent for the whole stall` | `agent-cloud.log` | The Node process is CPU-sensitive, and audio comes first. Render at a modest frame rate and measure before trusting it |
| Patients are often older | Product | Large face, plain high-contrast background, no flashing or fast motion |

## 3. Character: Helen

- **Who:** the Helen of Troy and Sparta from Odyssey Book 4. A dignified, warm hostess. Mature, kind, calm.
  Not a glamour portrait. The patients are elderly people on a medicine call.
- **Look:** stylised vector illustration with a Greek-vase and mosaic palette (terracotta, ochre, deep blue, cream),
  a draped chiton and a simple hairband or braided hair. **Original artwork only.** Do not copy a film still,
  an actress's likeness, or a specific painting. Flat shapes avoid the uncanny valley that realistic faces get on a phone screen.
- **Name:** open decision (§10). The agent calls itself "Pal" in its prompt and the demo script.
- **Honesty:** Helen is a character for an AI assistant. Pal must still never claim to be human (already in the prompt).
- **Pitch line (not patient-facing):** in Odyssey 4 Helen mixes a drug into the wine that eases grief and pain.
  A medicine companion named after her is a neat story for Devpost. Do not use it with patients, since the same
  passage is about making people forget, which is the wrong note for anyone with memory problems.

## 4. Expression system

### 4.1 A small face rig (parameters, not frames)

Rather than dozens of pre-drawn images, the face is drawn from about 12 numbers, which are smoothly eased every frame.
That gives continuous, natural-looking expressions and lets us blend them.

| Parameter | Range | Controls |
|---|---|---|
| `brow_l`, `brow_r` | -1…1 | Brow raise and angle (worry, surprise) |
| `eye_open` | 0…1 | Blink, soft squint when smiling |
| `gaze_x`, `gaze_y` | -1…1 | Where she looks (at camera, down when "thinking") |
| `mouth_open` | 0…1 | Driven by Pal's voice volume |
| `mouth_wide` | -1…1 | Pursed to wide, used for "oo" and smile shapes |
| `smile` | -1…1 | Corners up (warm) or down (concern) |
| `head_tilt` | -1…1 | Gentle tilt, listening |
| `head_nod` | -1…1 | Nod on "go ahead" |
| `lean` | 0…1 | Slight zoom-in when "looking closely" |
| `breath` | 0…1 | Idle sway so she never looks frozen |

### 4.2 Expressions (presets of those numbers)

`neutral-warm` · `smile` · `listening` · `thinking` · `looking-closely` · `pleased` · `concerned` · `serious-calm` · `surprised` · `goodbye-smile`

### 4.3 What triggers them (all reliable signals we already own)

| Trigger | Source | Expression |
|---|---|---|
| Call starts | `bridge_ready` | `smile` |
| Agent state `listening` | `AgentStateChanged` event in `@livekit/agents` | `listening` (attentive, small tilt, occasional nod) |
| Agent state `thinking` | same | `thinking` (gaze up and aside) |
| Agent state `speaking` | same | `neutral-warm`, mouth driven by voice volume |
| `check_meal` / `verify_pill` running | our tools in `agent/src/tools.ts` | `looking-closely` |
| `verify_pill` returns match | tool result | `pleased` + nod |
| `verify_pill` returns mismatch or `unsure` | tool result | `concerned` |
| `escalate_now` | tool | `serious-calm` (steady, never alarmed) |
| `end_call` | tool | `goodbye-smile` |
| Always | timers | random blinks every 2–6 s, small gaze drift, breathing |

**Optional (later):** classify the tone of each Pal sentence with a quick Haiku call into one of the presets, so
a warm joke gets a smile. It only drives visuals and never blocks speech.

### 4.4 Lip movement

Tap Pal's audio: wrap the agent's `AudioOutput` (the SDK has a chain, `AudioOutput(sampleRate, nextInChain)` in
`@livekit/agents` `voice/io`) with a pass-through that computes the volume (RMS) of each frame and forwards the audio
unchanged. Smooth it (fast attack, slower release) and feed it to `mouth_open`. For a stylised illustration this reads
as natural speech. Real viseme-based lip sync is not worth it here because Gemini Live returns audio only.

## 5. Options considered

| Option | How | Wow | Effort | Risk | Verdict |
|---|---|---|---|---|---|
| **A. Parametric 2D rig, rendered in Node** | Draw the face from the parameters with Skia (`@napi-rs/canvas`), publish via `VideoSource` | High for a stylised character | Medium | CPU use | **Recommended** |
| B. Pre-drawn sprite sheets | Swap images per expression | Medium | Low | Stiff, many drawings to make | Fallback |
| C. Hosted avatar service (Anam, Tavus and similar) | Service renders a realistic talking head | Highest | Medium, and paid | Audio must be routed through the service (one audio publisher rule); Node SDK support unverified | Only if budget and time allow |
| D. 3D (VRM or Live2D) in a headless browser | Render in Chromium, stream frames | High | High | Heavy, fragile, easy to break the single-participant rule | Not for MVP |

## 6. Architecture (Option A)

```
Gemini Live audio ─► AudioTap (RMS) ─► speaker output (unchanged)
                          │ mouth_open
AgentStateChanged ─┐      ▼
tool results ──────┼─► AvatarController ─► Rig (eased parameters) ─► Renderer (Skia) ─► RGBA frame
timers/blinks ─────┘                                                     │
                                                                          ▼
                                       VideoSource.captureFrame ─► LocalVideoTrack ─► room.localParticipant
```

Files (all new, under `agent/`):

```
agent/src/avatar/rig.ts          parameter set, presets, easing (spring or critically-damped)
agent/src/avatar/renderer.ts     draws Helen from the parameters into an RGBA buffer
agent/src/avatar/controller.ts   state machine: states + tool events -> target expression; blink and idle scheduler
agent/src/avatar/audio-tap.ts    AudioOutput pass-through computing the volume envelope
agent/src/avatar/publish.ts      VideoSource + LocalVideoTrack, frame loop, fallback to a static image
agent/src/avatar/assets/helen/   SVG layers (hair, face, eyes, brows, mouth shapes, garment)
agent/dev/avatar-preview.html    local page with a slider per parameter, for tuning the face
```

Existing files touched: `agent/src/agent.ts` (start the avatar next to the session and wire the events) and
`agent/src/tools.ts` (emit an expression event as each tool starts and finishes).

**Libraries**

- `@livekit/rtc-node` (already installed): `VideoSource`, `LocalVideoTrack.createVideoTrack`, `captureFrame`.
- `@napi-rs/canvas` (**new**): Skia 2D drawing with prebuilt binaries, no system install. Draw vector paths each frame and read back raw RGBA.
- `sharp` (already installed, 0.35.5): rasterise the SVG layers to images once at startup if we composite layers instead of drawing paths.
- No Three.js, no browser, no ML model in the loop.

**Settings** (add to `.env.example`): `AVATAR=on|off`, `AVATAR_FPS` (default 15), `AVATAR_SIZE` (default 640x480).

**Performance plan:** 15 fps at 640x480 is enough for a calm illustrated face. Run the renderer in a worker thread
so audio never waits on drawing. If frame time exceeds budget, drop to 8 fps, then to a single static frame. Treat
audio stalls as a failure of the avatar, not of the call.

## 7. Art pipeline

1. Write Helen as **layered SVG** (hair back, face, ears, eyes with separate lids and pupils, brows, nose, a set of
   about 6 mouth shapes, neck, garment, hairband). Claude can draft the SVG code; you or a designer tunes it.
2. Tune every part visually in `avatar-preview.html`, with sliders for each rig parameter and a button for each
   expression.
3. Keep the style simple and geometric so it survives a small phone screen and video compression.
4. Keep the source files in the repo (`agent/src/avatar/assets/helen/`) so anyone can change the character.

## 8. Phases

| Phase | Work | Output | Estimate |
|---|---|---|---|
| **0. Spike** | Publish one flat coloured frame as the agent's video | Chert shows it to the caller. Proves the plumbing, ticks the scorecard item | 1–2 h |
| **1. Helen v1** | SVG layers, rig, renderer, preview page, blink, breathing | A good-looking idle face | 3–4 h |
| **2. Alive** | Agent-state expressions, voice-driven mouth, fallback image | Helen reacts to the conversation | 2–3 h |
| **3. Reacts to tools** | Pill and plate looks, match and mismatch, escalation, goodbye | Expressions tied to what Pal does | 1–2 h |
| **4. Polish** | Hair and garment sway, nods, easing tuning, worker thread, CPU measurements | Smooth on a real phone | 2–4 h |
| **5. Stretch** | Sentence-tone expressions via Haiku; or Option C (hosted avatar) | Extra wow | optional |

## 9. How we will know it works

- **Preview page:** every expression looks right at 640x480 and at phone size.
- **Local test page:** extend `agent/dev/local.ts` to show the agent's video, and check smoothness and lip movement.
- **CPU:** run a call with the avatar on and check the log for `process not scheduled` warnings. Compare against avatar off.
- **Real FaceTime call:** on an iPhone, confirm Helen appears immediately, stays smooth, and the audio is unaffected.
- **Failure test:** force a render error and confirm the call continues with voice only.
- **Older-viewer check:** can someone with weaker eyesight read her expression at arm's length?

## 10. Risks and decisions

| Risk | Mitigation |
|---|---|
| Rendering starves the audio loop | Worker thread, modest frame rate, adaptive drop, avatar flag off by default until measured |
| Chert does not show a video track from the agent as expected | Phase 0 spike first, before any art work |
| Face looks odd or uncanny | Flat stylised illustration, not realism |
| Likeness or copyright | Original artwork, no film or actress reference |
| Patient thinks they are talking to a person | Pal introduces itself as an assistant; Helen is clearly a drawn character |
| Time | Phases 0–2 are the minimum worth shipping |

**Decisions needed from you**

1. **Name:** show "Helen" to patients, or keep "Pal" and use Helen only as the face? (This changes the prompt and the demo script.)
2. **Art:** write the SVG with Claude and tune it, or bring your own artwork or a designer?
3. **Budget:** stay with the free Option A, or would you pay for a hosted avatar (Option C)?
4. **Demo priority:** do Phase 0 first this evening to confirm Chert shows the video?
