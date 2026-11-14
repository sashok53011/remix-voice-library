/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adapter that lets an OpenAI-compatible chat endpoint stand in for Gemini.
 *
 * Incoming requests keep the Gemini shape (`contents`, `config.systemInstruction`,
 * `responseMimeType`/`responseSchema`) so the frontend does not change at all;
 * responses are converted back into the Gemini response shape consumed by
 * `serializeGenerateContentResponse` in server.ts.
 */
import {
  AppSettings,
  loadSettings,
} from "./settingsStore";

/** True when a custom LLM is configured and switched on. */
export function isCustomLlmEnabled(settings: AppSettings = loadSettings()): boolean {
  return Boolean(settings.llm.enabled && settings.llm.baseUrl.trim());
}

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiPart[];
  role?: string;
}

/** Extracts plain text from Gemini `contents` (string | {parts} | Content[]). */
export function contentsToText(contents: unknown): string {
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => contentsToText(c))
      .filter(Boolean)
      .join("\n");
  }
  const content = contents as GeminiContent | undefined;
  if (content && Array.isArray(content.parts)) {
    return content.parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Extracts systemInstruction (string | {parts}). */
function systemInstructionToText(systemInstruction: unknown): string {
  if (typeof systemInstruction === "string") return systemInstruction;
  return contentsToText(systemInstruction);
}

/** Builds the OpenAI `messages` array from a Gemini-style request body. */
export function buildMessages(body: any): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  const config = body?.config || {};

  const system = systemInstructionToText(config.systemInstruction);
  if (system) messages.push({ role: "system", content: system });

  const userText = contentsToText(body?.contents);
  if (userText) messages.push({ role: "user", content: userText });

  if (messages.length === 0) {
    throw new Error("Request contains no text content.");
  }
  return messages;
}

/**
 * JSON-mode requests (`responseMimeType: application/json`) get an explicit
 * instruction appended — no `response_format` field, because stricter
 * OpenAI-compatible servers reject unknown fields.
 */
function applyJsonMode(messages: OpenAiChatMessage[], config: any): OpenAiChatMessage[] {
  if (config?.responseMimeType !== "application/json") return messages;
  const schema = config.responseSchema
    ? `\nJSON schema to follow:\n${JSON.stringify(config.responseSchema)}`
    : "";
  const instruction =
    `You must respond with a single valid JSON object only — no markdown, no prose, ` +
    `no code fences.${schema}`;
  const copy = messages.map((m) => ({ ...m }));
  const last = copy[copy.length - 1];
  copy[copy.length - 1] = { ...last, content: `${last.content}\n\n${instruction}` };
  return copy;
}

/** Wraps plain text into the Gemini response shape the client expects. */
export function toGeminiResponse(text: string, model: string): any {
  return {
    candidates: [
      {
        content: { parts: [{ text }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
    text,
    modelVersion: model,
    usageMetadata: undefined,
  };
}

/** Wraps a text delta into one Gemini stream chunk (NDJSON line on the wire). */
export function toGeminiChunk(text: string, model: string): any {
  return {
    candidates: [
      {
        content: { parts: [{ text }], role: "model" },
        index: 0,
      },
    ],
    modelVersion: model,
  };
}

interface ChatCallResult {
  text: string;
}

async function readUpstreamError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  const detail = body.slice(0, 400);
  let message = `Custom LLM request failed with status ${res.status}.`;
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message || parsed?.message || message;
  } catch {
    if (detail) message = detail;
  }
  const error = new Error(message);
  (error as any).status = res.status;
  return error;
}

function llmEndpoint(): { baseUrl: string; key: string; model: string } {
  const settings = loadSettings();
  return {
    baseUrl: settings.llm.baseUrl.trim().replace(/\/+$/, ""),
    key: settings.llm.apiKey,
    model: settings.llm.model || "gpt-4o-mini",
  };
}

/** Non-streaming chat completion over explicit messages → plain text. */
export async function runCustomLlmMessages(messages: OpenAiChatMessage[]): Promise<ChatCallResult> {
  const { baseUrl, key, model } = llmEndpoint();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await readUpstreamError(res);

  const data: any = await res.json();
  const text: string =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    "";
  if (!text) throw new Error("Custom LLM returned an empty response.");
  return { text };
}

/** Gemini-style request body → non-streaming completion. */
export async function runCustomLlm(body: any): Promise<ChatCallResult> {
  const messages = applyJsonMode(buildMessages(body), body?.config);
  return runCustomLlmMessages(messages);
}

/** Streaming chat completion over explicit messages → Gemini-shaped chunks. */
export async function* streamCustomLlmMessages(
  messages: OpenAiChatMessage[]
): AsyncGenerator<any, void, unknown> {
  const { baseUrl, key, model } = llmEndpoint();

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw await readUpstreamError(res);
  if (!res.body) throw new Error("Custom LLM returned an empty stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta: string = parsed?.choices?.[0]?.delta?.content ?? "";
          if (delta) yield toGeminiChunk(delta, model);
        } catch {
          // Ignore malformed keep-alive/heartbeat lines.
        }
      }
    }
    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const parsed = JSON.parse(payload);
            const delta: string = parsed?.choices?.[0]?.delta?.content ?? "";
            if (delta) yield toGeminiChunk(delta, model);
          } catch {
            /* trailing partial line — drop it */
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Streaming chat completion from a Gemini-style request body → async iterator
 * of Gemini-shaped chunks. Parses the provider's SSE (`data: {...}` lines).
 */
export async function* streamCustomLlm(body: any): AsyncGenerator<any, void, unknown> {
  const messages = applyJsonMode(buildMessages(body), body?.config);
  yield* streamCustomLlmMessages(messages);
}
