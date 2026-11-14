# Gemini Voice Library

English | [Русский](README.ru.md) | [Deutsch](README.de.md)

A React app for exploring and auditioning **30 Google Gemini TTS voices**, with an
AI Casting Director, a batch Text-to-Speech studio, and pluggable custom
OpenAI-compatible **LLM / TTS / STT** endpoints.

## Features

- **Voice library** — carousel or grid of 30 Gemini voices with live audio preview,
  search, gender/pitch filters, favorites, and dark mode.
- **AI Casting Director** — describe a character/scene, the AI returns 3 matching
  voices plus a ready-to-use system prompt (Gemini JSON mode).
- **Text & File Studio** — batch line-by-line synthesis with intonation presets,
  per-line playback and mono WAV export.
- **Multi-provider TTS preview** — Gemini, Cartesia (Sonic 3.6), Deepgram (Aura 2),
  Fish Audio (S2.1 Free); voice lists are fetched dynamically through a server proxy.
- **Custom OpenAI-compatible endpoints** — configure LLM, TTS and STT independently
  (Base URL + key + model), with **Fetch models**, **Test connection** and **Save**
  per section. Settings are persisted **on the server** (`data/settings.json`),
  API keys are masked on read.
- **Custom LLM switch** — when enabled, all text AI features (Casting Director,
  chat endpoints) call your OpenAI-compatible `chat/completions` instead of Gemini.
  Image/video generation always stays on Gemini.
- **Favorites → ZIP** — download filtered voices as mono WAV archive.
- Interface in **English / Russian / German**, mobile-adaptive down to 360 px.

## Quick start

```bash
npm install
npm run dev          # → http://localhost:3000 (auto-picks a free port if busy)
```

Optional `.env.local` (see `.env.example`):

```ini
GEMINI_API_KEY=...          # required for Gemini features
DEEPGRAM_API_KEY=...        # optional, TTS provider tabs
CARTESIA_API_KEY=...
FISH_AUDIO_API_KEY=...
```

Keys can also be pasted directly in the UI — provider keys go to `localStorage`,
LLM/TTS/STT settings keys are stored server-side and never returned unmasked.

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server (Express + Vite middleware) |
| `npm run build` | Production bundle (`dist/`) + bundled server |
| `npm run start` | Run the production bundle |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |

## Ports (auto-selection)

The dev server never crashes with `EADDRINUSE`:

- HTTP port: `PORT` env var, default **3000**. If taken, the next free port is
  probed (up to `+20`) and the chosen port is printed in the log.
- The probe checks **both address families** (`0.0.0.0` *and* `[::]`): on Windows
  an IPv4-only and an IPv6-only listener can share the same port number, and a
  single-family probe would wrongly report it as free — then `localhost` would
  open the *other* app.
- Vite HMR port starts at `VITE_HMR_PORT` (default **24688**) with the same walk,
  so a stale dev server never produces `WebSocket server error` noise.

## Architecture

```
┌────────────────────────────  Browser (React 19 SPA)  ───────────────────────────┐
│  components/*   App, FilterBar, Carousel3D/GridView, VoiceFinder (AI Casting),  │
│                 TextStudioModal, AiResultCard, AiTtsPreview,                    │
│                 OpenAiProviderModal (LLM/TTS/STT settings)                      │
│  genaiProxy.ts        GoogleGenAI shim → HTTP calls to /api/*                  │
│  lib/ttsProviders.ts  TTS adapters (gemini/cartesia/deepgram/fishtts),          │
│                       x-tts-key header, raw-PCM/WAV decoding                   │
│  translations.ts      en / ru / de dictionary (lang prop)                       │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ fetch (JSON / NDJSON stream)
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                                 Express (server.ts)                             │
│  /api/generate-content(-stream), /api/chat-message(-stream)                     │
│      └─► Gemini API (env key)  ——or——  openAiLlm.ts  ──► your /chat/completions │
│  /api/generate-images, /api/generate-videos, /api/videos-operation,             │
│  /api/video-download            ──► Gemini API (always Gemini)                 │
│  ttsProxy.ts      POST /api/tts/:provider, GET /api/tts/voices/:provider       │
│      └─► Deepgram / Cartesia / Fish Audio  (env key or x-tts-key header)       │
│  settingsProxy.ts GET/POST /api/settings, /models, /test,                      │
│                   POST /api/settings/tts/speak, /stt/transcribe                │
│      └─► settingsStore.ts ──► data/settings.json (atomic write, key masking)    │
│  Vite middleware (dev)  /  static dist (prod)                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key modules

| File | Responsibility |
|---|---|
| `server.ts` | Express app, Gemini proxy routes, port auto-selection, Vite middleware / static serving, route registration |
| `ttsProxy.ts` | Server proxy for Deepgram / Cartesia / Fish: synthesis, dynamic voice lists (10-min cache), static 28-voice Deepgram list, unified `{code, error}` errors |
| `settingsStore.ts` | First file-backed store: `data/settings.json`, sections `llm`/`tts`/`stt`, atomic writes, in-memory cache, **key masking** (`hasKey`, `keyPreview`) |
| `settingsProxy.ts` | Settings CRUD + `Fetch models` (`GET …/models`) + `Test connection` (real probe per section) + functional `tts/speak` & `stt/transcribe` proxies |
| `openAiLlm.ts` | Gemini ⇄ OpenAI adapter: `contents`/`systemInstruction` → `messages`, JSON-mode instruction, response → Gemini shape, SSE → NDJSON chunks |
| `genaiProxy.ts` | Client-side `GoogleGenAI` shim so components call `/api/*` instead of the SDK directly |
| `lib/ttsProviders.ts` | Client TTS adapters, `localStorage` key store, raw-PCM → `AudioBuffer` decoding |
| `translations.ts` | Flat `en`/`ru`/`de` dictionaries; components take a `lang` prop |

### Main data flows

1. **AI Casting Director** — `VoiceFinder` → `POST /api/generate-content`
   (`responseMimeType: application/json` + `responseSchema`) → Gemini **or** custom
   LLM (when `llm.enabled`) → JSON parsed into `AiResultCard` → prompt copied /
   sample text played via `AiTtsPreview`.
2. **TTS preview** — `AiTtsPreview` → adapter (`gemini` calls the AI endpoint,
   others call `POST /api/tts/:provider`) → WAV/PCM → `AudioBuffer` → visualizer.
3. **Settings** — `OpenAiProviderModal` → `GET /api/settings` (masked) → edit →
   `POST /api/settings/:section` (empty key = keep stored) → `data/settings.json`.

### Error contract

All proxy endpoints answer JSON `{ code, error }` with codes:
`BAD_PROVIDER | BAD_REQUEST | NO_KEY | BAD_KEY | NO_CREDITS | RATE_LIMITED |
TEXT_TOO_LONG | TIMEOUT | UPSTREAM_ERROR | BAD_URL | NOT_FOUND | BAD_SECTION`;
the client maps them to localized messages.

## Mobile adaptation

Verified at 360–412 px (Android) and 640–1920 px (desktop):

- `viewport-fit=cover`, safe-area insets, `overscroll-behavior: none`;
- `100dvh` instead of `100vh` (no content hidden behind Chrome's address bar);
- hover-only controls revealed on touch (`@media (hover: none)`);
- two-row scrollable header on phones; no horizontal page scroll
  (`overflowX = 0` at every breakpoint);
- modals capped at `92dvh` with internal scrolling; touch targets ≥ 40 px.

## TODO

### Security
- [ ] **SSRF in `/api/video-download`** — proxies arbitrary `uri` params; whitelist Google hostnames.
- [ ] Rate limiting / auth on API endpoints (settings writes are currently unauthenticated).
- [ ] `data/settings.json` stores API keys in plaintext — restrict file perms or encrypt at rest.
- [ ] Audit `openAiLlm` / settings proxies for header-injection from user Base URLs.

### Reliability
- [ ] End-to-end tests with **real** provider keys (current tests use a mock OpenAI server and fake keys).
- [ ] Automated test suite (unit + API); today verification is manual (curl / browser).
- [ ] Unbounded `chats` and `videoOps` `Map`s in `server.ts` — add TTL/size eviction (memory leak).
- [ ] Graceful shutdown (`SIGINT`) for the dev server.

### Code health
- [ ] Remove dead code: `components/ControlBar.tsx`, empty `index.css`, unused `imageUrl`/`fileUri` fields.
- [ ] Tailwind **CDN** → build-time Tailwind (performance, CSP, offline).
- [ ] Localize hardcoded English strings (`TextStudioModal`, `VoiceFinder` headers).
- [ ] `.scrollbar-hide` class is used but never defined (scroll hiding relies on a global `::-webkit-scrollbar` hack).

### Features
- [ ] Wire custom TTS/STT settings into `AiTtsPreview` / `TextStudioModal` (today they are settings-only + modal test buttons).
- [ ] Pass through token/usage metadata from the custom LLM.
- [ ] Chat UI — `/api/chat-message(-stream)` exist but no frontend consumes them yet.
- [ ] PWA manifest + service worker (“Add to home screen” on Android).
- [ ] Settings export/import and a “clear stored key” button per section.
- [ ] Microphone recording for STT (file upload only today).

## License

Apache-2.0 (see `SPDX-License-Identifier` headers in source files).
