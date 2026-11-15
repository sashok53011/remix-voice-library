/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from "express";
import path from "path";
import fs from "fs";
import net from "net";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { registerTtsRoutes } from "./ttsProxy";
import { registerSettingsRoutes, synthesizeTtsAudio } from "./settingsProxy";
import { loadSettings } from "./settingsStore";
import {
  isCustomLlmEnabled,
  runCustomLlm,
  runCustomLlmMessages,
  streamCustomLlm,
  streamCustomLlmMessages,
  toGeminiResponse,
  contentsToText,
} from "./openAiLlm";

const MODEL_UPGRADES: Record<string, string> = {
  "gemini-2.5-flash": "gemini-3-flash-preview",
  "gemini-2.5-pro": "gemini-3.1-pro-preview",
  "gemini-3-pro-preview": "gemini-3.1-pro-preview",
  "gemini-2.0-flash": "gemini-3-flash-preview",
  "gemini-2.0-flash-exp": "gemini-3-flash-preview",
};

function resolveModel(model?: string): string {
  if (!model) return "gemini-3-flash-preview";
  return MODEL_UPGRADES[model] || model;
}

function serializeGenerateContentResponse(r: any) {
  return {
    candidates: r?.candidates,
    promptFeedback: r?.promptFeedback,
    usageMetadata: r?.usageMetadata,
    modelVersion: r?.modelVersion,
    responseId: r?.responseId,
    text: r?.text,
    functionCalls: r?.functionCalls,
    data: r?.data,
    executableCode: r?.executableCode,
    codeExecutionResult: r?.codeExecutionResult,
  };
}

const chats = new Map<string, any>();
const videoOps = new Map<string, any>();

/**
 * Speech requests (Text Studio, the Gemini TTS tab of the preview) must never
 * reach a chat LLM: it answers with text and the client reports
 * "No audio returned from API".
 */
function isAudioRequest(body: any): boolean {
  const cfg = body?.config;
  if (cfg?.speechConfig) return true;
  return Array.isArray(cfg?.responseModalities) && cfg.responseModalities.includes("AUDIO");
}

/**
 * Convert TTS container output into the PCM shape Gemini consumers expect:
 * headerless 16-bit mono PCM at 24000 Hz (Text Studio and AiTtsPreview
 * hardcode that rate — returning the gateway's native rate, typically 48000
 * from Fish-TTS, would play "several times slower").
 *
 * Non-WAV payloads (mp3) pass through unchanged — best effort.
 */
function toGeminiPcm(buf: Buffer): Buffer {
  // --- parse RIFF: fmt + data chunks ---
  if (buf.length <= 12 || buf.toString("ascii", 0, 4) !== "RIFF") return buf;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt " && size >= 16) {
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bitsPerSample = buf.readUInt16LE(start + 14);
    } else if (id === "data") {
      data = buf.subarray(start, Math.min(start + size, buf.length));
    }
    offset += 8 + size + (size % 2);
  }
  if (!data || !sampleRate || !channels || bitsPerSample !== 16) return buf;

  // --- bytes → Int16Array (copy guarantees alignment) ---
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const interleaved = new Int16Array(ab);

  // --- stereo → mono ---
  let mono: Int16Array;
  if (channels > 1) {
    const frames = Math.floor(interleaved.length / channels);
    mono = new Int16Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
      mono[i] = Math.round(sum / channels);
    }
  } else {
    mono = interleaved;
  }

  // --- resample to 24000 (linear interpolation) ---
  if (sampleRate === 24000) return Buffer.from(mono.buffer.slice(0));
  const ratio = sampleRate / 24000;
  const outLength = Math.floor(mono.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const frac = pos - i0;
    const value = mono[i0] * (1 - frac) + mono[i1] * frac;
    out[i] = value > 32767 ? 32767 : value < -32768 ? -32768 : Math.round(value);
  }
  console.log(
    `[Backend] TTS WAV: ${sampleRate} Hz × ${channels}ch → resampled to 24000 Hz mono ` +
      `(${mono.length} → ${outLength} samples)`
  );
  return Buffer.from(out.buffer.slice(0));
}

/** Wrap raw PCM bytes into the Gemini-shaped audio response. */
function geminiAudioResponse(pcm: Buffer): any {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcm.toString("base64") } }],
          role: "model",
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
  };
}

/**
 * A port counts as free only when BOTH address families can bind it:
 * a neighbour may hold the port IPv4-only (0.0.0.0) or IPv6-only ([::]),
 * and on Windows those coexist with a single-family bind instead of
 * conflicting — which would make `localhost` resolve to the other app.
 */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/**
 * A port counts as free only when BOTH probes pass. On Windows an IPv4-only
 * (0.0.0.0) and an IPv6 ([::]) listener can share one port without clashing,
 * so a single probe lies: the IPv4 probe misses [::]-only neighbours and the
 * dualstack probe misses 0.0.0.0-only ones — either way `localhost` would
 * resolve to the other app.
 */
async function isPortFree(port: number): Promise<boolean> {
  if (!(await canBind(port, "0.0.0.0"))) return false;
  return canBind(port, "::");
}

/** Returns `start` if free, otherwise the next free port in [start, start+tries). */
async function findFreePort(start: number, tries = 30): Promise<number> {
  for (let port = start; port < start + tries; port++) {
    if (await isPortFree(port)) return port;
    console.warn(`[Backend] Port ${port} is busy, probing ${port + 1}...`);
  }
  return start;
}

async function startServer() {
  const app = express();
  const preferredPort = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // The deployed build uses base "/remix-voice-library/" (the portal proxy
  // strips that prefix itself). This alias keeps direct access on
  // http://host:PORT/remix-voice-library/... working too. It must be a GLOBAL
  // middleware (no mount path) registered BEFORE any route: a mounted
  // `app.use("/prefix", ...)` layer restores the original req.url before the
  // next layer matches, which would undo the rewrite.
  const APP_PREFIX = "/remix-voice-library";
  app.use((req, _res, next) => {
    const url = req.originalUrl;
    if (url === APP_PREFIX || url.startsWith(APP_PREFIX + "/")) {
      const rest = url.slice(APP_PREFIX.length) || "/";
      req.url = rest.startsWith("/") ? rest : "/" + rest;
    }
    next();
  });

  for (const dir of ["examples", "assets", "public"]) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      app.use(`/${dir}`, express.static(dirPath));
    }
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Third-party TTS providers (Deepgram / Cartesia / Fish Audio)
  registerTtsRoutes(app);

  // Custom OpenAI-compatible LLM / TTS / STT settings (persisted server-side)
  registerSettingsRoutes(app);

  /**
   * Chat history (Gemini-style `Content[]`) → OpenAI-style messages, so the
   * chat endpoints can be served by a custom LLM too.
   */
  function historyToMessages(history: any): any[] {
    if (!Array.isArray(history)) return [];
    return history
      .map((entry: any) => {
        const text = Array.isArray(entry?.parts)
          ? entry.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n")
          : "";
        const role = entry?.role === "model" ? "assistant" : "user";
        return text ? { role, content: text } : null;
      })
      .filter(Boolean);
  }

  app.post("/api/generate-content", async (req, res): Promise<any> => {
    try {
      if (isAudioRequest(req.body)) {
        // Speech goes to a real TTS backend: the configured OpenAI-compatible
        // endpoint when present, otherwise Gemini. Never the chat LLM.
        const tts = loadSettings().tts;
        if (tts.baseUrl.trim() && tts.apiKey.trim()) {
          try {
            // Preferred input: clean line + Fish S2 emotion tag
            // ("[tag] text" at the sentence start).
            const cleanText =
              typeof req.body?.ttsInput === "string" && req.body.ttsInput.trim()
                ? req.body.ttsInput.trim()
                : contentsToText(req.body?.contents).trim();
            // Fish S2 emotion marker: [tag] at the start of the sentence.
            // Normalization is idempotent: "happy", "[happy]" and "very excited"
            // all become a single properly bracketed marker.
            const rawTag = typeof req.body?.ttsTag === "string" ? req.body.ttsTag : "";
            const tag = rawTag.replace(/^\[+|\]+$/g, "").trim();
            const text = tag ? `[${tag}] ${cleanText}` : cleanText;
            if (!text) throw new Error("Request contains no text to synthesize.");
            const { bytes } = await synthesizeTtsAudio(text, { responseFormat: "wav" });
            return res.json(geminiAudioResponse(toGeminiPcm(bytes)));
          } catch (ttsError: any) {
            console.error("[Backend] custom TTS failed:", ttsError);
            return res.status(502).json({ error: ttsError?.message || "Custom TTS synthesis failed." });
          }
        }
        // No custom TTS configured → fall through to Gemini TTS below.
      } else if (isCustomLlmEnabled()) {
        // Custom OpenAI-compatible LLM (when enabled in Settings) replaces Gemini.
        const { text } = await runCustomLlm(req.body);
        return res.json(toGeminiResponse(text, req.body?.model || "custom-llm"));
      }
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      // Strip our custom TTS fields — the Gemini API only needs the prompt.
      const { ttsInput: _dropTtsInput, ttsTag: _dropTtsTag, ...restBody } = req.body || {};
      const params = { ...restBody, model: resolveModel(req.body?.model) };
      const response = await ai.models.generateContent(params);
      return res.json(serializeGenerateContentResponse(response));
    } catch (error: any) {
      console.error("[Backend] /api/generate-content error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate content." });
    }
  });

  app.post("/api/generate-content-stream", async (req, res): Promise<any> => {
    try {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Custom OpenAI-compatible LLM: SSE from the provider → Gemini NDJSON.
      // Audio-modality streams are excluded — a chat LLM cannot produce them.
      if (isCustomLlmEnabled() && !isAudioRequest(req.body)) {
        try {
          for await (const chunk of streamCustomLlm(req.body)) {
            res.write(JSON.stringify(chunk) + "\n");
          }
          res.end();
        } catch (error: any) {
          console.error("[Backend] custom LLM stream error:", error);
          if (!res.headersSent) {
            res.status(500).json({ error: error.message || "Failed to stream content." });
          } else {
            res.end();
          }
        }
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      // Strip our custom TTS fields — the Gemini API only needs the prompt.
      const { ttsInput: _dropTtsInput, ttsTag: _dropTtsTag, ...restBody } = req.body || {};
      const params = { ...restBody, model: resolveModel(req.body?.model) };
      const stream = await ai.models.generateContentStream(params);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for await (const chunk of stream) {
        res.write(JSON.stringify(serializeGenerateContentResponse(chunk)) + "\n");
      }
      res.end();
    } catch (error: any) {
      console.error("[Backend] /api/generate-content-stream error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || "Failed to stream content." });
      }
      res.end();
    }
  });

  app.post("/api/chat-message", async (req, res): Promise<any> => {
    try {
      const { sessionId, model, config, history, message, msgConfig } = req.body || {};

      // Custom LLM: rebuild the conversation as OpenAI messages.
      if (isCustomLlmEnabled()) {
        const messages = historyToMessages(history);
        const userText =
          typeof message === "string"
            ? message
            : Array.isArray(message?.parts)
              ? message.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n")
              : "";
        if (userText) messages.push({ role: "user", content: userText });

        const systemText =
          typeof config?.systemInstruction === "string"
            ? config.systemInstruction
            : Array.isArray(config?.systemInstruction?.parts)
              ? config.systemInstruction.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n")
              : "";
        if (systemText) messages.unshift({ role: "system", content: systemText });

        const { text } = await runCustomLlmMessages(messages);
        return res.json(toGeminiResponse(text, model || "custom-llm"));
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      let chat = sessionId ? chats.get(sessionId) : undefined;
      if (!chat) {
        chat = ai.chats.create({
          model: resolveModel(model),
          config,
          history,
        });
        if (sessionId) chats.set(sessionId, chat);
      }
      const response = await chat.sendMessage({ message, config: msgConfig });
      return res.json(serializeGenerateContentResponse(response));
    } catch (error: any) {
      console.error("[Backend] /api/chat-message error:", error);
      return res.status(500).json({ error: error.message || "Failed to send chat message." });
    }
  });

  app.post("/api/chat-stream", async (req, res): Promise<any> => {
    try {
      const { sessionId, model, config, history, message, msgConfig } = req.body || {};

      // Custom LLM streaming: history → messages, SSE → Gemini NDJSON chunks.
      if (isCustomLlmEnabled()) {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        try {
          const messages = historyToMessages(history);
          const userText =
            typeof message === "string"
              ? message
              : Array.isArray(message?.parts)
                ? message.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n")
                : "";
          if (userText) messages.push({ role: "user", content: userText });
          const systemText =
            typeof config?.systemInstruction === "string"
              ? config.systemInstruction
              : Array.isArray(config?.systemInstruction?.parts)
                ? config.systemInstruction.parts.map((p: any) => p?.text || "").filter(Boolean).join("\n")
                : "";
          if (systemText) messages.unshift({ role: "system", content: systemText });

          for await (const chunk of streamCustomLlmMessages(messages)) {
            res.write(JSON.stringify(chunk) + "\n");
          }
          res.end();
        } catch (error: any) {
          console.error("[Backend] custom LLM chat stream error:", error);
          if (!res.headersSent) {
            res.status(500).json({ error: error.message || "Failed to stream chat message." });
          } else {
            res.end();
          }
        }
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      let chat = sessionId ? chats.get(sessionId) : undefined;
      if (!chat) {
        chat = ai.chats.create({
          model: resolveModel(model),
          config,
          history,
        });
        if (sessionId) chats.set(sessionId, chat);
      }
      const stream = await chat.sendMessageStream({ message, config: msgConfig });
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      for await (const chunk of stream) {
        res.write(JSON.stringify(serializeGenerateContentResponse(chunk)) + "\n");
      }
      res.end();
    } catch (error: any) {
      console.error("[Backend] /api/chat-stream error:", error);
      if (!res.headersSent) {
        return res.status(500).json({ error: error.message || "Failed to stream chat message." });
      }
      res.end();
    }
  });

  app.post("/api/generate-images", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateImages(req.body);
      return res.json(response);
    } catch (error: any) {
      console.error("[Backend] /api/generate-images error:", error);
      return res.status(500).json({ error: error.message || "Failed to generate images." });
    }
  });

  app.post("/api/generate-videos", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const body = { ...req.body };
      if (body.video?.uri && String(body.video.uri).includes("/api/video-download?b64=")) {
        const b64Part = String(body.video.uri).split("b64=")[1]?.split("&")[0] || "";
        if (b64Part) {
          body.video = { ...body.video, uri: Buffer.from(b64Part, "base64url").toString("utf-8") };
        }
      }
      const op = await ai.models.generateVideos(body);
      if (op.name) {
        videoOps.set(op.name, op);
      }
      return res.json({
        name: op.name,
        done: op.done,
        metadata: op.metadata,
        error: op.error,
        response: op.response,
      });
    } catch (error: any) {
      console.error("[Backend] /api/generate-videos error:", error);
      return res.status(500).json({ error: error.message || "Failed to start video generation." });
    }
  });

  app.post("/api/videos-operation", async (req, res): Promise<any> => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "API key is not configured. Please add your GEMINI_API_KEY in Settings > Secrets.",
        });
      }
      const ai = new GoogleGenAI({ apiKey });
      const opName = req.body?.operation?.name;
      const storedOp = opName ? videoOps.get(opName) : undefined;
      if (!storedOp) {
        return res.status(404).json({ error: "Video operation not found on server." });
      }
      const op = await ai.operations.getVideosOperation({ operation: storedOp });
      if (op.name) {
        videoOps.set(op.name, op);
      }
      const responseCopy = op.response ? JSON.parse(JSON.stringify(op.response)) : undefined;
      if (op.done && responseCopy?.generatedVideos) {
        for (const gv of responseCopy.generatedVideos) {
          if (gv.video?.uri) {
            const b64 = Buffer.from(gv.video.uri, "utf-8").toString("base64url");
            gv.video.uri = `/api/video-download?b64=${b64}`;
          }
        }
      }
      return res.json({
        name: op.name,
        done: op.done,
        metadata: op.metadata,
        error: op.error,
        response: responseCopy,
      });
    } catch (error: any) {
      console.error("[Backend] /api/videos-operation error:", error);
      return res.status(500).json({ error: error.message || "Failed to poll video operation." });
    }
  });

  app.get("/api/video-download", async (req, res): Promise<any> => {
    try {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
      if (!apiKey) {
        return res.status(503).json({ error: "API key is not configured." });
      }
      let rawUri = "";
      if (req.query.b64) {
        rawUri = Buffer.from(String(req.query.b64).split("&")[0], "base64url").toString("utf-8");
      } else {
        rawUri = String(req.query.uri || "").split("&key=")[0];
      }
      if (!rawUri) {
        return res.status(400).json({ error: "Missing uri parameter." });
      }
      const sep = rawUri.includes("?") ? "&" : "?";
      const downloadUrl = `${rawUri}${sep}key=${apiKey}`;
      const upstream = await fetch(downloadUrl);
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        return res.status(upstream.status).send(errText || upstream.statusText);
      }
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
      const arrayBuf = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuf));
    } catch (error: any) {
      console.error("[Backend] /api/video-download error:", error);
      return res.status(500).json({ error: error.message || "Failed to download video." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    // Dynamic import: production bundles (dist/server.cjs) never load Vite,
    // so the deployed server does not need vite installed.
    const { createServer: createViteServer } = await import("vite");
    // Probe for a free HMR port: a stale dev server (or another project) may
    // already hold the preferred one, and Vite only warns — killing HMR.
    const hmrPort = await findFreePort(Number(process.env.VITE_HMR_PORT) || 24688);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { port: hmrPort },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  /**
   * Listen on the preferred port, but when it is busy (another local dev
   * server may have grabbed 3000) walk up to the next free port instead of
   * crashing with EADDRINUSE.
   *
   * No explicit host: binds the IPv6 wildcard with IPv4 fallback (dualstack),
   * so a port held by an IPv4- or IPv6-only process is detected as busy —
   * binding 0.0.0.0 would silently coexist with an IPv6-only listener on the
   * same port and make `localhost` resolve to the other app.
   */
  async function startListening(port: number, attemptsLeft: number): Promise<void> {
    // Single-family binds can coexist with a neighbour on the same port
    // (Windows), so check both families before committing to it.
    if (!(await isPortFree(port))) {
      if (attemptsLeft > 0) {
        console.warn(`[Backend] Port ${port} is busy, trying ${port + 1}...`);
        return startListening(port + 1, attemptsLeft - 1);
      }
      console.error(`[Backend] No free port found in [${preferredPort}, ${preferredPort + 20}).`);
      process.exit(1);
    }
    const server = app.listen(port, () => {
      console.log(`[Backend] Server running on http://localhost:${port}`);
      if (port !== preferredPort) {
        console.log(
          `[Backend] Port ${preferredPort} was busy — using port ${port} instead. ` +
            `Set PORT=<number> to pick a specific port.`
        );
      }
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
        console.warn(`[Backend] Port ${port} is busy, trying ${port + 1}...`);
        startListening(port + 1, attemptsLeft - 1);
      } else {
        console.error(`[Backend] Could not start server on port ${port}:`, error);
        process.exit(1);
      }
    });
  }

  startListening(preferredPort, 20);
}

startServer();
