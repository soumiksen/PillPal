# PillPal — rules for every Claude Code session
- Read docs/contracts.md first. Types live in packages/shared; never redefine them locally.
- Stay in your folder: web/ = Frontend, api/ + supabase/ = Backend, agent/ + packages/ = AI Eng.
  Root files, packages/shared and docs/ change only through a PR reviewed by Role 3.
- Branch names: fe/<thing>, be/<thing>, ai/<thing>. Never push to main. Small PRs, often.
- Before every PR: git fetch origin && git merge origin/main, then npm run check (must pass).
- TypeScript, Node 22+. Never commit .env. Never log tokens or patient data.
- AI: Gemini (free) only for live voice, voice-memo transcription and TTS. Claude for all vision and text.
  Claude JSON = one tool with input_schema + tool_choice forcing it. Cache translations and TTS.
- Safety: never invent or change a dose; never auto-call 911; vision "unsure" below 0.7 confidence.
- Chert docs index: https://docs.trychert.com/llms.txt — fetch pages instead of guessing.
- Never read, print, log or commit .env values; reference env vars by name only.
