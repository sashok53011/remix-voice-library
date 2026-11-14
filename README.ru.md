# Gemini Voice Library

[English](README.md) | Русский | [Deutsch](README.de.md)

Приложение на React для просмотра и прослушивания **30 голосов Google Gemini TTS**
с AI Casting Director, пакетной студией озвучки и подключаемыми
OpenAI-совместимыми эндпоинтами **LLM / TTS / STT**.

## Возможности

- **Библиотека голосов** — карусель или сетка из 30 голосов Gemini с живым
  прослушиванием, поиском, фильтрами по полу/тону, избранным и тёмной темой.
- **AI Casting Director** — опишите персонажа/сцену, ИИ вернёт 3 подходящих
  голоса и готовый system prompt (JSON-режим Gemini).
- **Text & File Studio** — построчная пакетная синтезация с пресетами интонации,
  воспроизведением построчно и экспортом в mono WAV.
- **Превью нескольких TTS-провайдеров** — Gemini, Cartesia (Sonic 3.6),
  Deepgram (Aura 2), Fish Audio (S2.1 Free); списки голосов загружаются
  динамически через серверный прокси.
- **Свои OpenAI-совместимые эндпоинты** — независимая настройка LLM, TTS и STT
  (Base URL + ключ + модель) с кнопками **Fetch models**, **Test connection** и
  **Save** для каждой секции. Настройки сохраняются **на сервере**
  (`data/settings.json`), ключи при чтении маскируются.
- **Переключатель своего LLM** — когда включён, все текстовые ИИ-функции
  (Casting Director, эндпоинты чата) идут на ваш `chat/completions` вместо
  Gemini. Генерация картинок/видео всегда остаётся на Gemini.
- **Избранное → ZIP** — скачивание отфильтрованных голосов архивом mono WAV.
- Интерфейс на **английском / русском / немецком**, адаптирован под экраны
  от 360 px.

## Быстрый старт

```bash
npm install
npm run dev          # → http://localhost:3000 (если порт занят — займёт следующий свободный)
```

Опциональный `.env.local` (см. `.env.example`):

```ini
GEMINI_API_KEY=...          # обязателен для функций Gemini
DEEPGRAM_API_KEY=...        # опционально, вкладки TTS-провайдеров
CARTESIA_API_KEY=...
FISH_AUDIO_API_KEY=...
```

Ключи можно ввести и через интерфейс: ключи провайдеров хранятся в
`localStorage`, ключи секций LLM/TTS/STT — на сервере и наружу в открытом
виде не отдаются.

| Скрипт | Назначение |
|---|---|
| `npm run dev` | Dev-сервер (Express + Vite middleware) |
| `npm run build` | Прод-бандл (`dist/`) + бандлированный сервер |
| `npm run start` | Запуск прод-бандла |
| `npm run typecheck` | Проверка типов (`tsc --noEmit`) |

## Порты (автоподбор)

Dev-сервер больше не падает с `EADDRINUSE`:

- HTTP-порт: переменная `PORT`, по умолчанию **3000**. Если занят — перебирает
  следующие свободные (до `+20`) и печатает выбранный порт в лог.
- Проверка идёт **по обоим семействам адресов** (`0.0.0.0` *и* `[::]`): на
  Windows IPv4-слушатель и IPv6-слушатель могут делить один номер порта, и
  проба одного семейства ложно сочтёт порт свободным — тогда `localhost`
  откроет *другое* приложение.
- HMR-порт Vite начинается с `VITE_HMR_PORT` (по умолчанию **24688**) и
  обходится так же — устаревший инстанс больше не засоряет лог ошибкой
  `WebSocket server error`.

## Архитектура

```
┌────────────────────────────  Браузер (React 19 SPA)  ──────────────────────────┐
│  components/*   App, FilterBar, Carousel3D/GridView, VoiceFinder (AI Casting), │
│                 TextStudioModal, AiResultCard, AiTtsPreview,                   │
│                 OpenAiProviderModal (настройки LLM/TTS/STT)                    │
│  genaiProxy.ts        шим GoogleGenAI → HTTP-вызовы /api/*                     │
│  lib/ttsProviders.ts  адаптеры TTS (gemini/cartesia/deepgram/fishtts),         │
│                       заголовок x-tts-key, декодирование raw-PCM/WAV          │
│  translations.ts      словари en / ru / de (проп lang)                         │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ fetch (JSON / NDJSON-стрим)
┌──────────────────────────────────────▼─────────────────────────────────────────┐
│                                 Express (server.ts)                            │
│  /api/generate-content(-stream), /api/chat-message(-stream)                    │
│      └─► Gemini API (env-ключ)  ——или——  openAiLlm.ts  ──► ваш /chat/completions│
│  /api/generate-images, /api/generate-videos, /api/videos-operation,            │
│  /api/video-download            ──► Gemini API (всегда Gemini)                 │
│  ttsProxy.ts      POST /api/tts/:provider, GET /api/tts/voices/:provider      │
│      └─► Deepgram / Cartesia / Fish Audio  (env-ключ или заголовок x-tts-key) │
│  settingsProxy.ts GET/POST /api/settings, /models, /test,                     │
│                   POST /api/settings/tts/speak, /stt/transcribe               │
│      └─► settingsStore.ts ──► data/settings.json (атомарная запись, маскировка)│
│  Vite middleware (dev)  /  статика dist (prod)                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Ключевые модули

| Файл | Ответственность |
|---|---|
| `server.ts` | Приложение Express, маршруты-прокси к Gemini, автоподбор порта, Vite middleware / статика, регистрация модулей маршрутов |
| `ttsProxy.ts` | Серверный прокси Deepgram / Cartesia / Fish: синтез, динамические списки голосов (кэш 10 мин), статический список из 28 голосов Deepgram, единые ошибки `{code, error}` |
| `settingsStore.ts` | Первый файловый стор проекта: `data/settings.json`, секции `llm`/`tts`/`stt`, атомарная запись, кэш в памяти, **маскировка ключей** (`hasKey`, `keyPreview`) |
| `settingsProxy.ts` | CRUD настроек + `Fetch models` (`GET …/models`) + `Test connection` (реальный запрос для каждой секции) + функциональные прокси `tts/speak` и `stt/transcribe` |
| `openAiLlm.ts` | Адаптер Gemini ⇄ OpenAI: `contents`/`systemInstruction` → `messages`, инструкция для JSON-режима, ответ → форма Gemini, SSE → NDJSON-чанки |
| `genaiProxy.ts` | Клиентский шим `GoogleGenAI` — компоненты ходят в `/api/*`, а не в SDK напрямую |
| `lib/ttsProviders.ts` | Клиентские адаптеры TTS, хранилище ключей в `localStorage`, декодирование raw-PCM → `AudioBuffer` |
| `translations.ts` | Плоские словари `en`/`ru`/`de`; компоненты получают проп `lang` |

### Основные потоки данных

1. **AI Casting Director** — `VoiceFinder` → `POST /api/generate-content`
   (`responseMimeType: application/json` + `responseSchema`) → Gemini **или**
   свой LLM (при включённом `llm.enabled`) → JSON разбирается в `AiResultCard`
   → промпт копируется / образец проигрывается через `AiTtsPreview`.
2. **Превью TTS** — `AiTtsPreview` → адаптер (`gemini` зовёт AI-эндпоинт,
   остальные — `POST /api/tts/:provider`) → WAV/PCM → `AudioBuffer` → визуализатор.
3. **Настройки** — `OpenAiProviderModal` → `GET /api/settings` (маскировано) →
   правка → `POST /api/settings/:section` (пустой ключ = сохранить прежний) →
   `data/settings.json`.

### Контракт ошибок

Все прокси-эндпоинты отвечают JSON `{ code, error }` с кодами:
`BAD_PROVIDER | BAD_REQUEST | NO_KEY | BAD_KEY | NO_CREDITS | RATE_LIMITED |
TEXT_TOO_LONG | TIMEOUT | UPSTREAM_ERROR | BAD_URL | NOT_FOUND | BAD_SECTION`;
клиент преобразует их в локализованные сообщения.

## Мобильная адаптация

Проверено на 360–412 px (Android) и 640–1920 px (десктоп):

- `viewport-fit=cover`, safe-area отступы, `overscroll-behavior: none`;
- `100dvh` вместо `100vh` (контент не уезжает под адресную строку Chrome);
- hover-only элементы проявляются на тач-устройствах (`@media (hover: none)`);
- двухстрочная шапка со скроллом на телефонах; горизонтального скролла страницы
  нет (`overflowX = 0` на всех брейкпоинтах);
- модалки ограничены `92dvh` с внутренним скроллом; тач-цели ≥ 40 px.

## TODO

### Безопасность
- [ ] **SSRF в `/api/video-download`** — проксирует произвольные параметры `uri`; сделать белый список доменов Google.
- [ ] Rate limiting / авторизация на API-эндпоинтах (запись настроек сейчас не аутентифицирована).
- [ ] `data/settings.json` хранит ключи открытым текстом — ограничить права на файл или шифровать.
- [ ] Аудит заголовков в `openAiLlm` / прокси настроек на инъекции из пользовательских Base URL.

### Надёжность
- [ ] E2E-тесты с **настоящими** ключами провайдеров (сейчас тесты идут через mock OpenAI-сервер и фейковые ключи).
- [ ] Автотесты (unit + API); сейчас проверка вручную (curl / браузер).
- [ ] Неограниченные `Map`-ы `chats` и `videoOps` в `server.ts` — добавить TTL/eviction (утечка памяти).
- [ ] Graceful shutdown (`SIGINT`) для dev-сервера.

### Здоровье кода
- [ ] Удалить мёртвый код: `components/ControlBar.tsx`, пустой `index.css`, неиспользуемые поля `imageUrl`/`fileUri`.
- [ ] Tailwind **CDN** → сборочный Tailwind (производительность, CSP, оффлайн).
- [ ] Локализовать захардкоженные английские строки (`TextStudioModal`, заголовки `VoiceFinder`).
- [ ] Класс `.scrollbar-hide` используется нигде не определён (скрытие скроллбаров держится на глобальном хаке `::-webkit-scrollbar`).

### Функции
- [ ] Подключить свои TTS/STT-настройки к `AiTtsPreview` / `TextStudioModal` (сейчас — только настройки + кнопки теста в модалке).
- [ ] Прокидывать метаданные об использовании токенов из своего LLM.
- [ ] UI чата — `/api/chat-message(-stream)` есть, но фронтенд их пока не использует.
- [ ] PWA-манифест + service worker («Добавить на главный экран» на Android).
- [ ] Экспорт/импорт настроек и кнопка «очистить сохранённый ключ» для каждой секции.
- [ ] Запись с микрофона для STT (сейчас только загрузка файла).

## Лицензия

Apache-2.0 (см. заголовки `SPDX-License-Identifier` в исходных файлах).
