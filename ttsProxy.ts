/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side proxy for third-party TTS providers (Deepgram, Cartesia, Fish Audio).
 *
 * Why a proxy:
 *  1. These APIs are not meant to be called from browsers (CORS / access-token policy).
 *  2. API keys stay on the server (env) or are forwarded per-request from the client UI.
 *  3. Only fixed, whitelisted hosts are ever contacted — no arbitrary URL proxying.
 */
import type { Express, Request, Response as ExpressResponse } from "express";

export type TtsProvider = "deepgram" | "cartesia" | "fish";

export type TtsErrorCode =
  | "BAD_PROVIDER"
  | "BAD_REQUEST"
  | "NO_KEY"
  | "BAD_KEY"
  | "NO_CREDITS"
  | "RATE_LIMITED"
  | "TEXT_TOO_LONG"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

interface ProviderConfig {
  envKey: string;
  baseUrl: string;
  /** Max characters accepted by this provider for a single request. */
  maxText: number;
}

const PROVIDERS: Record<TtsProvider, ProviderConfig> = {
  deepgram: { envKey: "DEEPGRAM_API_KEY", baseUrl: "https://api.deepgram.com", maxText: 2000 },
  cartesia: { envKey: "CARTESIA_API_KEY", baseUrl: "https://api.cartesia.ai", maxText: 5000 },
  fish: { envKey: "FISH_AUDIO_API_KEY", baseUrl: "https://api.fish.audio", maxText: 5000 },
};

const CARTESIA_VERSION = "2026-08-14";
const REQUEST_TIMEOUT_MS = 45_000;
const VOICES_CACHE_TTL_MS = 10 * 60_000;
const VOICES_MAX_PAGES = 3;

/** Deepgram exposes no voices API — these are the published Aura model IDs. */
const DEEPGRAM_VOICES: Array<{ id: string; label: string }> = [
  { id: "aura-2-thalia-en", label: "Thalia (EN-US · feminine)" },
  { id: "aura-2-andromeda-en", label: "Andromeda (EN-US · feminine)" },
  { id: "aura-2-helena-en", label: "Helena (EN-US · feminine)" },
  { id: "aura-2-apollo-en", label: "Apollo (EN-US · masculine)" },
  { id: "aura-2-arcas-en", label: "Arcas (EN-US · masculine)" },
  { id: "aura-2-aries-en", label: "Aries (EN-US · masculine)" },
  { id: "aura-2-asteria-en", label: "Asteria (EN-US · feminine)" },
  { id: "aura-2-athena-en", label: "Athena (EN-US · feminine)" },
  { id: "aura-2-atlas-en", label: "Atlas (EN-US · masculine)" },
  { id: "aura-2-aurora-en", label: "Aurora (EN-US · feminine)" },
  { id: "aura-2-cora-en", label: "Cora (EN-US · feminine)" },
  { id: "aura-2-draco-en", label: "Draco (EN-GB · masculine)" },
  { id: "aura-2-juno-en", label: "Juno (EN-US · feminine)" },
  { id: "aura-2-jupiter-en", label: "Jupiter (EN-US · masculine)" },
  { id: "aura-2-luna-en", label: "Luna (EN-US · feminine)" },
  { id: "aura-2-pandora-en", label: "Pandora (EN-GB · feminine)" },
  { id: "aura-2-zeus-en", label: "Zeus (EN-US · masculine)" },
  { id: "aura-2-celeste-es", label: "Celeste (ES-CO · feminine)" },
  { id: "aura-2-nestor-es", label: "Nestor (ES-ES · masculine)" },
  { id: "aura-2-julius-de", label: "Julius (DE · masculine)" },
  { id: "aura-2-viktoria-de", label: "Viktoria (DE · feminine)" },
  { id: "aura-2-agathe-fr", label: "Agathe (FR · feminine)" },
  { id: "aura-2-hector-fr", label: "Hector (FR · masculine)" },
  { id: "aura-2-livia-it", label: "Livia (IT · feminine)" },
  { id: "aura-2-fujin-ja", label: "Fujin (JA · masculine)" },
  { id: "aura-2-izanami-ja", label: "Izanami (JA · feminine)" },
  { id: "aura-2-rhea-nl", label: "Rhea (NL · feminine)" },
  { id: "aura-2-sander-nl", label: "Sander (NL · masculine)" },
];

interface VoiceOption {
  id: string;
  label: string;
}

class TtsHttpError extends Error {
  constructor(
    public code: TtsErrorCode,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function isProvider(value: string): value is TtsProvider {
  return value in PROVIDERS;
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

/** env key wins when present, otherwise the per-request key from the client UI. */
function resolveKey(provider: TtsProvider, req: Request): string {
  const envKey = (process.env[PROVIDERS[provider].envKey] || "").trim();
  if (envKey) return envKey;
  const headerKey = String(req.headers["x-tts-key"] || "").trim();
  if (headerKey) return headerKey;
  throw new TtsHttpError("NO_KEY", 503, `Missing ${PROVIDERS[provider].envKey}.`);
}

function mapUpstreamStatus(status: number, bodyText: string): TtsHttpError {
  const detail = bodyText.slice(0, 300);
  if (status === 401 || status === 403) return new TtsHttpError("BAD_KEY", 401, detail || "Invalid API key.");
  if (status === 402) return new TtsHttpError("NO_CREDITS", 402, detail || "No credits left on this account.");
  if (status === 413) return new TtsHttpError("TEXT_TOO_LONG", 413, detail || "Text too long.");
  if (status === 429) return new TtsHttpError("RATE_LIMITED", 429, detail || "Rate limited.");
  return new TtsHttpError("UPSTREAM_ERROR", 502, detail || `Upstream responded with ${status}.`);
}

async function assertUpstreamOk(res: Response): Promise<void> {
  // `Response` here is the global fetch Response, not Express'.
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw mapUpstreamStatus(res.status, text);
}

function sendError(res: ExpressResponse, error: unknown): void {
  if (error instanceof TtsHttpError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  const isTimeout = error instanceof Error && error.name === "AbortError";
  if (isTimeout) {
    res.status(504).json({ code: "TIMEOUT", error: "Provider timed out." });
    return;
  }
  console.error("[TTS Proxy] unexpected error:", error);
  res.status(500).json({ code: "UPSTREAM_ERROR", error: "Unexpected proxy failure." });
}

function readText(body: any, maxText: number): string {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) throw new TtsHttpError("BAD_REQUEST", 400, "Field 'text' is required.");
  if (text.length > maxText) {
    throw new TtsHttpError("TEXT_TOO_LONG", 413, `Text exceeds ${maxText} characters for this provider.`);
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Synthesis                                                           */
/* ------------------------------------------------------------------ */

async function synthesizeDeepgram(key: string, text: string, voice: string): Promise<Response> {
  const model = voice || "aura-2-thalia-en";
  const url =
    `${PROVIDERS.deepgram.baseUrl}/v1/speak` +
    `?model=${encodeURIComponent(model)}&encoding=linear16&container=wav&sample_rate=24000`;
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
}

async function synthesizeCartesia(key: string, body: any): Promise<Response> {
  const transcript = readText(body, PROVIDERS.cartesia.maxText);
  const payload: any = {
    model_id: body.model || "sonic-3.6",
    transcript,
    voice: body.voice,
    output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 },
  };
  if (!payload.voice) throw new TtsHttpError("BAD_REQUEST", 400, "Field 'voice' is required.");

  const generationConfig: any = {};
  if (typeof body.speed === "number" && body.speed > 0) generationConfig.speed = body.speed;
  if (typeof body.emotion === "string" && body.emotion) generationConfig.emotion = body.emotion;
  if (Object.keys(generationConfig).length > 0) payload.generation_config = generationConfig;

  return fetch(`${PROVIDERS.cartesia.baseUrl}/tts/bytes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
}

async function synthesizeFish(key: string, body: any): Promise<Response> {
  const text = readText(body, PROVIDERS.fish.maxText);
  const payload: any = {
    text,
    format: "wav",
    sample_rate: 24000,
    normalize: true,
  };
  if (typeof body.voice === "string" && body.voice) payload.reference_id = body.voice;
  if (typeof body.speed === "number" && body.speed > 0) payload.prosody = { speed: body.speed };

  return fetch(`${PROVIDERS.fish.baseUrl}/v1/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      // `s2.1-pro-free` is the free developer tier (paid models return 402).
      model: typeof body.model === "string" && body.model ? body.model : "s2.1-pro-free",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
}

/* ------------------------------------------------------------------ */
/* Voices                                                              */
/* ------------------------------------------------------------------ */

const voicesCache = new Map<string, { expires: number; voices: VoiceOption[] }>();

function cacheGet(key: string): VoiceOption[] | null {
  const hit = voicesCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    voicesCache.delete(key);
    return null;
  }
  return hit.voices;
}

function cacheSet(key: string, voices: VoiceOption[]): void {
  voicesCache.set(key, { expires: Date.now() + VOICES_CACHE_TTL_MS, voices });
}

async function listCartesiaVoices(key: string, query: string): Promise<VoiceOption[]> {
  const voices: VoiceOption[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < VOICES_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (query) params.set("q", query);
    if (startingAfter) params.set("starting_after", startingAfter);

    const res = await fetch(`${PROVIDERS.cartesia.baseUrl}/voices?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION },
      signal: timeoutSignal(20_000),
    });
    await assertUpstreamOk(res);
    const data = await res.json();

    for (const voice of data?.data || []) {
      if (!voice?.id) continue;
      const label = [voice.name, voice.tagline].filter(Boolean).join(" — ") || voice.id;
      voices.push({ id: voice.id, label });
    }

    if (!data?.has_more || !data?.next_page) break;
    startingAfter = data.next_page;
    if (query) break; // a search hit already fits in one page
  }

  return voices;
}

async function listFishVoices(key: string, query: string): Promise<VoiceOption[]> {
  const voices: VoiceOption[] = [];

  for (let page = 1; page <= VOICES_MAX_PAGES; page++) {
    const params = new URLSearchParams({ page_size: "100", page_number: String(page), sort_by: "score" });
    if (query) params.set("title", query);

    const res = await fetch(`${PROVIDERS.fish.baseUrl}/model?${params.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: timeoutSignal(20_000),
    });
    await assertUpstreamOk(res);
    const data = await res.json();

    for (const model of data?.items || []) {
      if (!model?._id) continue;
      const languages = Array.isArray(model.languages) ? model.languages.slice(0, 3).join(", ") : "";
      const label = [model.title, languages ? `(${languages})` : ""].filter(Boolean).join(" ");
      voices.push({ id: model._id, label });
    }

    if (data?.has_more === false || (data?.items || []).length < 100) break;
    if (query) break;
  }

  return voices;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerTtsRoutes(app: Express): void {
  app.post("/api/tts/:provider", async (req: Request, res: ExpressResponse): Promise<any> => {
    const provider = req.params.provider;
    if (!isProvider(provider)) {
      return res.status(404).json({ code: "BAD_PROVIDER", error: `Unknown TTS provider '${provider}'.` });
    }

    try {
      const config = PROVIDERS[provider];
      const text = readText(req.body, config.maxText);
      const key = resolveKey(provider, req);

      let upstream: Response;
      if (provider === "deepgram") {
        upstream = await synthesizeDeepgram(key, text, req.body?.voice);
      } else if (provider === "cartesia") {
        upstream = await synthesizeCartesia(key, { ...req.body, text });
      } else {
        upstream = await synthesizeFish(key, { ...req.body, text });
      }

      await assertUpstreamOk(upstream);

      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "audio/wav");
      res.setHeader("X-Tts-Provider", provider);
      return res.send(bytes);
    } catch (error) {
      console.error(`[TTS Proxy] /api/tts/${provider} error:`, error);
      return sendError(res, error);
    }
  });

  app.get("/api/tts/voices/:provider", async (req: Request, res: ExpressResponse): Promise<any> => {
    const provider = req.params.provider;
    if (!isProvider(provider)) {
      return res.status(404).json({ code: "BAD_PROVIDER", error: `Unknown TTS provider '${provider}'.` });
    }

    const query = String(req.query.q || "").trim().slice(0, 64);
    const cacheKey = `${provider}:${query}`;

    try {
      if (provider === "deepgram") {
        return res.json({ voices: DEEPGRAM_VOICES });
      }

      const cached = cacheGet(cacheKey);
      if (cached) return res.json({ voices: cached });

      const key = resolveKey(provider, req);
      const voices =
        provider === "cartesia"
          ? await listCartesiaVoices(key, query)
          : await listFishVoices(key, query);

      if (!query) cacheSet(cacheKey, voices);
      return res.json({ voices });
    } catch (error) {
      console.error(`[TTS Proxy] /api/tts/voices/${provider} error:`, error);
      return sendError(res, error);
    }
  });
}
