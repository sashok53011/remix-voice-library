# Gemini Voice Library

[English](README.md) | [Русский](README.ru.md) | Deutsch

Eine React-App zum Entdecken und Anhören von **30 Google-Gemini-TTS-Stimmen**
mit AI Casting Director, Stapel-Sprachstudio und austauschbaren
OpenAI-kompatiblen **LLM-/TTS-/STT-Endpunkten**.

## Funktionen

- **Stimmen-Bibliothek** — Karussell oder Raster mit 30 Gemini-Stimmen, Live-Vorschau,
  Suche, Filter nach Geschlecht/Tonhöhe, Favoriten und Dunkelmodus.
- **AI Casting Director** — Charakter/Szene beschreiben, die KI liefert 3 passende
  Stimmen plus fertigen System-Prompt (Gemini-JSON-Modus).
- **Text & File Studio** — zeilenweise Stapel-Synthese mit Intonations-Vorlagen,
  Wiedergabe pro Zeile und Mono-WAV-Export.
- **TTS-Vorschau mehrerer Anbieter** — Gemini, Cartesia (Sonic 3.6),
  Deepgram (Aura 2), Fish Audio (S2.1 Free); Stimmenlisten werden dynamisch
  über einen Server-Proxy geladen.
- **Eigene OpenAI-kompatible Endpunkte** — LLM, TTS und STT unabhängig konfigurieren
  (Base URL + Schlüssel + Modell) mit den Schaltflächen **Fetch models**,
  **Test connection** und **Save** pro Abschnitt. Einstellungen werden
  **serverseitig** gespeichert (`data/settings.json`), Schlüssel beim Auslesen maskiert.
- **Eigener-LLM-Schalter** — wenn aktiviert, rufen alle textbasierten KI-Funktionen
  (Casting Director, Chat-Endpunkte) Ihren `chat/completions` statt Gemini auf.
  Bild-/Videogenerierung bleibt immer bei Gemini.
- **Favoriten → ZIP** — gefilterte Stimmen als Mono-WAV-Archiv herunterladen.
- Oberfläche auf **Englisch/Russisch/Deutsch**, mobil angepasst bis 360 px.

## Schnellstart

```bash
npm install
npm run dev          # → http://localhost:3000 (belegt bei Bedarf den nächsten freien Port)
```

Optionale `.env.local` (siehe `.env.example`):

```ini
GEMINI_API_KEY=...          # erforderlich für Gemini-Funktionen
DEEPGRAM_API_KEY=...        # optional, TTS-Anbieter-Tabs
CARTESIA_API_KEY=...
FISH_AUDIO_API_KEY=...
```

Schlüssel lassen sich auch direkt in der UI eingeben: Anbieter-Schlüssel liegen
in `localStorage`, die Schlüssel der LLM/TTS/STT-Abschnitte werden serverseitig
gespeichert und nie unmaskiert zurückgegeben.

| Skript | Zweck |
|---|---|
| `npm run dev` | Dev-Server (Express + Vite-Middleware) |
| `npm run build` | Produktions-Bundle (`dist/`) + gebündelter Server |
| `npm run start` | Startet das Produktions-Bundle |
| `npm run typecheck` | TypeScript-Prüfung (`tsc --noEmit`) |

## Ports (automatische Auswahl)

Der Dev-Server stürzt nie mit `EADDRINUSE` ab:

- HTTP-Port: Umgebungsvariable `PORT`, Standard **3000**. Bei Belegung wird der
  nächste freie Port probiert (bis `+20`) und im Log ausgegeben.
- Die Prüfung erfolgt für **beide Adressfamilien** (`0.0.0.0` *und* `[::]`): unter
  Windows können ein IPv4- und ein IPv6-Listener dieselbe Portnummer teilen, und
  eine Einzelfamilien-Prüfung meldet den Port fälschlich als frei — dann öffnet
  `localhost` die *andere* App.
- Der Vite-HMR-Port beginnt bei `VITE_HMR_PORT` (Standard **24688**) mit dem
  gleichen Verfahren — ein veralteter Instanz erzeugt keine
  `WebSocket server error`-Meldungen mehr.

## Architektur

```
┌────────────────────────────  Browser (React-19-SPA)  ──────────────────────────┐
│  components/*   App, FilterBar, Carousel3D/GridView, VoiceFinder (AI Casting), │
│                 TextStudioModal, AiResultCard, AiTtsPreview,                   │
│                 OpenAiProviderModal (LLM/TTS/STT-Einstellungen)                │
│  genaiProxy.ts        GoogleGenAI-Shim → HTTP-Aufrufe /api/*                   │
│  lib/ttsProviders.ts  TTS-Adapter (gemini/cartesia/deepgram/fishtts),          │
│                       Header x-tts-key, Rohtext-PCM/WAV-Dekodierung           │
│  translations.ts      en/ru/de-Wörterbuch (prop lang)                          │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ fetch (JSON / NDJSON-Stream)
┌──────────────────────────────────────▼─────────────────────────────────────────┐
│                                 Express (server.ts)                            │
│  /api/generate-content(-stream), /api/chat-message(-stream)                    │
│      └─► Gemini-API (env-Schlüssel) ——oder—— openAiLlm.ts ──► Ihr /chat/…      │
│  /api/generate-images, /api/generate-videos, /api/videos-operation,            │
│  /api/video-download            ──► Gemini-API (immer Gemini)                  │
│  ttsProxy.ts      POST /api/tts/:provider, GET /api/tts/voices/:provider      │
│      └─► Deepgram / Cartesia / Fish Audio  (env-Schlüssel oder x-tts-key)     │
│  settingsProxy.ts GET/POST /api/settings, /models, /test,                     │
│                   POST /api/settings/tts/speak, /stt/transcribe               │
│      └─► settingsStore.ts ──► data/settings.json (atomar, Schlüssel-Maskierung)│
│  Vite-Middleware (dev)  /  statisches dist (prod)                              │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Kernmodule

| Datei | Verantwortung |
|---|---|
| `server.ts` | Express-App, Gemini-Proxy-Routen, Port-Automatik, Vite-Middleware / statisches Serving, Registrierung der Routen-Module |
| `ttsProxy.ts` | Server-Proxy für Deepgram / Cartesia / Fish: Synthese, dynamische Stimmenlisten (10-Min-Cache), statische 28-Stimmen-Liste von Deepgram, einheitliche `{code, error}`-Fehler |
| `settingsStore.ts` | Erster dateibasierter Store: `data/settings.json`, Abschnitte `llm`/`tts`/`stt`, atomare Schreibungen, Speicher-Cache, **Schlüssel-Maskierung** (`hasKey`, `keyPreview`) |
| `settingsProxy.ts` | Einstellungs-CRUD + `Fetch models` (`GET …/models`) + `Test connection` (echter Probe pro Abschnitt) + funktionelle Proxys `tts/speak` & `stt/transcribe` |
| `openAiLlm.ts` | Gemini⇄OpenAI-Adapter: `contents`/`systemInstruction` → `messages`, JSON-Modus-Anweisung, Antwort → Gemini-Form, SSE → NDJSON-Chunks |
| `genaiProxy.ts` | Clientseitiger `GoogleGenAI`-Shim — Komponenten rufen `/api/*` statt direkt die SDK auf |
| `lib/ttsProviders.ts` | Client-TTS-Adapter, Schlüsselspeicher in `localStorage`, Rohtext-PCM → `AudioBuffer`-Dekodierung |
| `translations.ts` | Flache `en`/`ru`/`de`-Wörterbücher; Komponenten erhalten die Prop `lang` |

### Haupt-Datenflüsse

1. **AI Casting Director** — `VoiceFinder` → `POST /api/generate-content`
   (`responseMimeType: application/json` + `responseSchema`) → Gemini **oder**
   eigener LLM (bei aktiviertem `llm.enabled`) → JSON wird in `AiResultCard`
   ausgewertet → Prompt kopieren / Beispieltext über `AiTtsPreview` abspielen.
2. **TTS-Vorschau** — `AiTtsPreview` → Adapter (`gemini` ruft den AI-Endpunkt,
   die anderen `POST /api/tts/:provider`) → WAV/PCM → `AudioBuffer` → Visualizer.
3. **Einstellungen** — `OpenAiProviderModal` → `GET /api/settings` (maskiert) →
   Bearbeiten → `POST /api/settings/:section` (leerer Schlüssel = gespeicherten
   behalten) → `data/settings.json`.

### Fehlervertrag

Alle Proxy-Endpunkte antworten mit JSON `{ code, error }` und den Codes:
`BAD_PROVIDER | BAD_REQUEST | NO_KEY | BAD_KEY | NO_CREDITS | RATE_LIMITED |
TEXT_TOO_LONG | TIMEOUT | UPSTREAM_ERROR | BAD_URL | NOT_FOUND | BAD_SECTION`;
der Client bildet sie auf lokalisierte Meldungen ab.

## Mobile Anpassung

Geprüft bei 360–412 px (Android) und 640–1920 px (Desktop):

- `viewport-fit=cover`, Safe-Area-Einrückungen, `overscroll-behavior: none`;
- `100dvh` statt `100vh` (kein Inhalt hinter der Chrome-Adressleiste);
- Hover-only-Elemente werden auf Touch-Geräten eingeblendet (`@media (hover: none)`);
- zweizeilige, scrollbare Kopfzeile auf Telefonen; kein horizontaler Seitenscroll
  (`overflowX = 0` an allen Breakpoints);
- Modale auf max. `92dvh` mit internem Scroll; Touch-Ziele ≥ 40 px.

## TODO

### Sicherheit
- [ ] **SSRF in `/api/video-download`** — proxyt beliebige `uri`-Parameter; Google-Domain-Whitelist einführen.
- [ ] Rate-Limiting / Auth auf den API-Endpunkten (das Speichern der Einstellungen ist bisher unauthentifiziert).
- [ ] `data/settings.json` speichert API-Schlüssel im Klartext — Dateiberechtigungen einschränken oder verschlüsseln.
- [ ] Audit der Header in `openAiLlm` / Settings-Proxys gegen Injectionen ausnutzbarer Base-URLs.

### Zuverlässigkeit
- [ ] E2E-Tests mit **echten** Anbieter-Schlüsseln (aktuell laufen die Tests gegen einen Mock-OpenAI-Server und Fake-Schlüssel).
- [ ] Automatisierte Tests (Unit + API); bisher manuelle Prüfung (curl / Browser).
- [ ] Unbegrenzte `chats`- und `videoOps`-`Map`s in `server.ts` — TTL/Eviction ergänzen (Speicherleck).
- [ ] Graceful Shutdown (`SIGINT`) für den Dev-Server.

### Codequalität
- [ ] Toten Code entfernen: `components/ControlBar.tsx`, leeres `index.css`, ungenutzte Felder `imageUrl`/`fileUri`.
- [ ] Tailwind-**CDN** → Tailwind im Build (Performance, CSP, Offline).
- [ ] Hardcodierte englische Zeichenketten lokalisieren (`TextStudioModal`, `VoiceFinder`-Kopfzeilen).
- [ ] Die Klasse `.scrollbar-hide` wird verwendet, aber nirgends definiert (das Verstecken der Scrollbars hängt an einem globalen `::-webkit-scrollbar`-Hack).

### Funktionen
- [ ] Eigene TTS/STT-Einstellungen an `AiTtsPreview` / `TextStudioModal` anbinden (bisher nur Einstellungen + Test-Buttons im Modal).
- [ ] Token-/Nutzungsmetadaten des eigenen LLM durchreichen.
- [ ] Chat-UI — `/api/chat-message(-stream)` existieren, aber noch kein Frontend nutzt sie.
- [ ] PWA-Manifest + Service Worker („Zum Startbildschirm hinzufügen" auf Android).
- [ ] Einstellungen exportieren/importieren und pro Abschnitt einen „gespeicherten Schlüssel löschen"-Button.
- [ ] Mikrofonaufnahme für STT (bisher nur Datei-Upload).

## Lizenz

Apache-2.0 (siehe `SPDX-License-Identifier`-Header in den Quelldateien).
