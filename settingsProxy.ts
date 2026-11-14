/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side routes for custom OpenAI-compatible provider settings:
 *
 *   GET  /api/settings                 → config with masked API keys
 *   POST /api/settings/:section        → save one section (llm | tts | stt)
 *   GET  /api/settings/:section/models → list models from {baseUrl}/models
 *   POST /api/settings/:section/test   → real connectivity test per section
 *
 * All upstream calls happen here (never in the browser): no CORS issues and
 * API keys stay on the server. Errors follow the ttsProxy convention:
 * JSON `{ code, error }`.
 */
import type { Express, Request, Response as ExpressResponse } from "express";
import {
  AppSettings,
  DEFAULT_SETTINGS,
  isSettingsSection,
  loadSettings,
  maskSettings,
  resolveSectionKey,
  saveSection,
  SettingsSection,
} from "./settingsStore";

type SettingsErrorCode =
  | "BAD_SECTION"
  | "BAD_REQUEST"
  | "BAD_URL"
  | "NO_KEY"
  | "BAD_KEY"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR";

const REQUEST_TIMEOUT_MS = 45_000;

class SettingsHttpError extends Error {
  constructor(
    public code: SettingsErrorCode,
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function sendError(res: ExpressResponse, error: unknown): void {
  if (error instanceof SettingsHttpError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  const isTimeout = error instanceof Error && error.name === "AbortError";
  if (isTimeout) {
    res.status(504).json({ code: "TIMEOUT", error: "Provider timed out." });
    return;
  }
  console.error("[Settings] unexpected error:", error);
  res.status(500).json({ code: "UPSTREAM_ERROR", error: "Unexpected settings failure." });
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

/** Only plain http(s) endpoints — no file:, no arbitrary schemes. */
function normalizeBaseUrl(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  if (!value) throw new SettingsHttpError("BAD_URL", 400, "Base URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SettingsHttpError("BAD_URL", 400, `Invalid Base URL: '${value}'.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsHttpError("BAD_URL", 400, "Only http(s) Base URLs are allowed.");
  }
  return value;
}

async function mapUpstream(res: Response): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  const detail = text.slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    throw new SettingsHttpError("BAD_KEY", 401, detail || "Invalid API key.");
  }
  if (res.status === 404) {
    throw new SettingsHttpError("NOT_FOUND", 404, detail || "Endpoint not found on this Base URL.");
  }
  if (res.status === 429) {
    throw new SettingsHttpError("RATE_LIMITED", 429, detail || "Rate limited.");
  }
  throw new SettingsHttpError("UPSTREAM_ERROR", 502, detail || `Upstream responded with ${res.status}.`);
}

function requireKey(section: SettingsSection, providedKey?: string): string {
  const key = resolveSectionKey(section, providedKey);
  if (!key) {
    throw new SettingsHttpError("NO_KEY", 503, "No API key configured for this section.");
  }
  return key;
}

/** 1 second of 16 kHz mono silence as a WAV buffer (for STT probing). */
function silentWav(): Buffer {
  const sampleRate = 16000;
  const numSamples = sampleRate;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

interface UpstreamRequest {
  url: string;
  init: RequestInit;
}

/** Builds the upstream call for "fetch models" for a given section. */
function modelsRequest(section: SettingsSection, baseUrl: string, key: string): UpstreamRequest {
  return {
    url: `${baseUrl}/models`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: timeoutSignal(20_000),
    },
  };
}

/** Builds the minimal real-world probe request per section. */
function testRequest(
  section: SettingsSection,
  baseUrl: string,
  key: string,
  settings: AppSettings
): UpstreamRequest {
  if (section === "llm") {
    const model = settings.llm.model || "gpt-4o-mini";
    return {
      url: `${baseUrl}/chat/completions`,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 8,
        }),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      },
    };
  }
  if (section === "tts") {
    const model = settings.tts.model || "tts-1";
    const voice = settings.tts.voice || "alloy";
    return {
      url: `${baseUrl}/audio/speech`,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: "ping", voice }),
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      },
    };
  }
  // stt — probe with a tiny silent WAV; any 2xx + JSON means the route works.
  const model = settings.stt.model || "whisper-1";
  const form = new FormData();
  form.append("file", new Blob([silentWav()], { type: "audio/wav" }), "ping.wav");
  form.append("model", model);
  return {
    url: `${baseUrl}/audio/transcriptions`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    },
  };
}

function sectionFrom(req: Request): SettingsSection {
  const section = String(req.params.section || "");
  if (!isSettingsSection(section)) {
    throw new SettingsHttpError("BAD_SECTION", 404, `Unknown settings section '${section}'.`);
  }
  return section;
}

/**
 * Synthesize speech with the configured OpenAI-compatible TTS endpoint.
 * Shared by the modal's "Synthesize" test and the audio branch of
 * `/api/generate-content` (Text Studio / TTS preview).
 */
export async function synthesizeTtsAudio(
  text: string,
  opts: { apiKey?: string; model?: string; voice?: string; responseFormat?: string } = {}
): Promise<{ bytes: Buffer; contentType: string }> {
  const settings = loadSettings();
  const baseUrl = normalizeBaseUrl(settings.tts.baseUrl);
  const key = requireKey("tts", opts.apiKey);
  const model = String(opts.model || settings.tts.model || "tts-1");
  const voice = String(opts.voice || settings.tts.voice || "alloy");

  const payload: Record<string, unknown> = { model, input: text, voice };
  if (opts.responseFormat) payload.response_format = opts.responseFormat;

  const upstream = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
  await mapUpstream(upstream);

  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new SettingsHttpError("UPSTREAM_ERROR", 502, "Provider returned empty audio.");
  }
  return { bytes, contentType: upstream.headers.get("content-type") || "audio/mpeg" };
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function registerSettingsRoutes(app: Express): void {
  // Read current settings (keys masked).
  app.get("/api/settings", (_req: Request, res: ExpressResponse) => {
    return res.json(maskSettings(loadSettings()));
  });

  // Save one section. An empty/omitted apiKey keeps the stored key.
  app.post("/api/settings/:section", (req: Request, res: ExpressResponse): any => {
    try {
      const section = sectionFrom(req);
      const body = isObject(req.body) ? req.body : {};
      const current = loadSettings();
      const merged: any = { ...current[section], ...body };

      merged.baseUrl = normalizeBaseUrl(merged.baseUrl);

      const providedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      merged.apiKey = providedKey || current[section].apiKey;

      if (section === "llm") {
        merged.enabled = Boolean(merged.enabled);
        merged.model = String(merged.model || "").trim();
      } else if (section === "tts") {
        merged.model = String(merged.model || "").trim();
        merged.voice = String(merged.voice || "").trim();
      } else {
        merged.model = String(merged.model || "").trim();
      }

      saveSection(section, merged as any);
      return res.json({ ok: true, settings: maskSettings(loadSettings()) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Fetch the model list from the provider's /models endpoint.
  app.get("/api/settings/:section/models", async (req: Request, res: ExpressResponse): Promise<any> => {
    try {
      const section = sectionFrom(req);
      const settings = loadSettings();
      const baseUrl = normalizeBaseUrl(
        String(req.query.baseUrl || "").trim() || settings[section].baseUrl
      );
      const provided =
        String(req.query.key || "").trim() ||
        String(req.headers["x-settings-key"] || "").trim();
      const key = requireKey(section, provided);

      const { url, init } = modelsRequest(section, baseUrl, key);
      const upstream = await fetch(url, init);
      await mapUpstream(upstream);

      const data: any = await upstream.json().catch(() => ({}));
      const rawList = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : [];
      const models = rawList
        .map((m: any) => (typeof m === "string" ? m : m?.id || m?.name || ""))
        .filter(Boolean);

      return res.json({ models });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Real connectivity test per section.
  app.post("/api/settings/:section/test", async (req: Request, res: ExpressResponse): Promise<any> => {
    try {
      const section = sectionFrom(req);
      const settings = loadSettings();
      const baseUrl = normalizeBaseUrl(
        isObject(req.body) && typeof req.body.baseUrl === "string" && req.body.baseUrl
          ? req.body.baseUrl
          : settings[section].baseUrl
      );
      const providedKey = isObject(req.body) ? req.body.apiKey : undefined;
      const key = requireKey(section, providedKey);

      const { url, init } = testRequest(section, baseUrl, key, settings);
      const startedAt = Date.now();
      const upstream = await fetch(url, init);
      await mapUpstream(upstream);

      const latencyMs = Date.now() - startedAt;

      if (section === "tts") {
        const bytes = Buffer.from(await upstream.arrayBuffer());
        if (bytes.byteLength === 0) {
          throw new SettingsHttpError("UPSTREAM_ERROR", 502, "Provider returned empty audio.");
        }
      } else if (section === "llm") {
        const data: any = await upstream.json().catch(() => ({}));
        if (!data?.choices && !data?.error) {
          throw new SettingsHttpError("UPSTREAM_ERROR", 502, "Unexpected chat/completions response.");
        }
      }

      return res.json({ ok: true, latencyMs });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Functional TTS: synthesize free text via the saved (or provided) config.
  app.post("/api/settings/tts/speak", async (req: Request, res: ExpressResponse): Promise<any> => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new SettingsHttpError("BAD_REQUEST", 400, "Field 'text' is required.");
      if (text.length > 4000) {
        throw new SettingsHttpError("BAD_REQUEST", 400, "Text too long (max 4000 characters).");
      }

      const { bytes, contentType } = await synthesizeTtsAudio(text, {
        apiKey: body.apiKey,
        model: body.model,
        voice: body.voice,
      });
      res.setHeader("Content-Type", contentType);
      return res.send(bytes);
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Functional STT: transcribe an uploaded audio file (base64 in JSON — no
  // multipart parser dependency needed).
  app.post("/api/settings/stt/transcribe", async (req: Request, res: ExpressResponse): Promise<any> => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
      if (!audioBase64) {
        throw new SettingsHttpError("BAD_REQUEST", 400, "Field 'audioBase64' is required.");
      }
      const filename = String(body.filename || "audio.wav").replace(/[^\w.\-() ]+/g, "_");

      const settings = loadSettings();
      const baseUrl = normalizeBaseUrl(settings.stt.baseUrl);
      const key = requireKey("stt", body.apiKey);
      const model = String(body.model || settings.stt.model || "whisper-1");

      let bytes: Buffer;
      try {
        bytes = Buffer.from(audioBase64, "base64");
      } catch {
        throw new SettingsHttpError("BAD_REQUEST", 400, "Invalid base64 audio payload.");
      }
      if (bytes.byteLength === 0) {
        throw new SettingsHttpError("BAD_REQUEST", 400, "Empty audio file.");
      }

      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "audio/wav" }), filename);
      form.append("model", model);

      const upstream = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      await mapUpstream(upstream);

      const data: any = await upstream.json().catch(() => ({}));
      return res.json({ text: data?.text || "" });
    } catch (error) {
      return sendError(res, error);
    }
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { DEFAULT_SETTINGS };
