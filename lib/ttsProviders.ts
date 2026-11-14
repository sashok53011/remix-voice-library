/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side TTS provider adapters.
 *
 * Every provider returns one of two shapes:
 *  - `raw-pcm`   → headerless 16-bit PCM (Gemini), decoded manually at `sampleRate`
 *  - `container` → a complete audio file (WAV/MP3) decoded via `AudioContext.decodeAudioData`
 */
import { GoogleGenAI, Modality } from "../genaiProxy";
import { Voice } from "../types";

export type TtsProviderId = "gemini" | "cartesia" | "deepgram" | "fishtts";

export interface TtsVoiceOption {
  id: string;
  label: string;
}

export type TtsSynthResult =
  | { kind: "raw-pcm"; bytes: Uint8Array; sampleRate: number }
  | { kind: "container"; bytes: ArrayBuffer };

export interface TtsSynthesizeArgs {
  text: string;
  voiceId: string;
}

export interface TtsAdapter {
  id: TtsProviderId;
  label: string;
  badge: string;
  /** True when synthesis requires an API key (env var or one pasted in the UI). */
  needsKey: boolean;
  listVoices(): Promise<TtsVoiceOption[]>;
  synthesize(args: TtsSynthesizeArgs): Promise<TtsSynthResult>;
}

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

export class TtsProviderError extends Error {
  constructor(public code: TtsErrorCode | string) {
    super(code);
    this.name = "TtsProviderError";
  }
}

/* ------------------------------------------------------------------ */
/* API keys (hybrid: server env first, per-user key as fallback)       */
/* ------------------------------------------------------------------ */

const KEY_STORAGE = "tts_provider_keys";

type KeyStore = Partial<Record<TtsProviderId, string>>;

export function getStoredKey(provider: TtsProviderId): string {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return "";
    const store = JSON.parse(raw) as KeyStore;
    return store[provider] || "";
  } catch {
    return "";
  }
}

export function setStoredKey(provider: TtsProviderId, key: string): void {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    const store = raw ? (JSON.parse(raw) as KeyStore) : {};
    if (key) store[provider] = key;
    else delete store[provider];
    localStorage.setItem(KEY_STORAGE, JSON.stringify(store));
  } catch (e) {
    console.error("Failed to save TTS provider key", e);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP plumbing                                                       */
/* ------------------------------------------------------------------ */

async function readError(res: Response): Promise<TtsProviderError> {
  try {
    const data = await res.json();
    return new TtsProviderError(data?.code || "UPSTREAM_ERROR");
  } catch {
    return new TtsProviderError("UPSTREAM_ERROR");
  }
}

function authHeaders(provider: TtsProviderId): Record<string, string> {
  const key = getStoredKey(provider);
  return key ? { "x-tts-key": key } : {};
}

async function fetchVoiceOptions(
  provider: TtsProviderId,
  query?: string
): Promise<TtsVoiceOption[]> {
  const url = `/api/tts/voices/${provider}` + (query ? `?q=${encodeURIComponent(query)}` : "");
  const res = await fetch(url, { headers: authHeaders(provider) });
  if (!res.ok) throw await readError(res);
  const data = await res.json();
  return Array.isArray(data?.voices) ? data.voices : [];
}

async function postSynthesis(
  provider: TtsProviderId,
  body: Record<string, unknown>
): Promise<ArrayBuffer> {
  const res = await fetch(`/api/tts/${provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(provider) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return res.arrayBuffer();
}

/* ------------------------------------------------------------------ */
/* Audio decoding helpers                                              */
/* ------------------------------------------------------------------ */

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Headerless 16-bit little-endian PCM → AudioBuffer. */
export function decodeRawPcm(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels = 1
): AudioBuffer {
  const aligned = data.byteOffset % 2 === 0 ? data : data.slice();
  const dataInt16 = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
  const frameCount = Math.floor(dataInt16.length / numChannels);
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/** Normalizes any provider result into an AudioBuffer for playback/visualizer. */
export async function resultToAudioBuffer(
  result: TtsSynthResult,
  ctx: AudioContext
): Promise<AudioBuffer> {
  if (result.kind === "raw-pcm") {
    return decodeRawPcm(result.bytes, ctx, result.sampleRate);
  }
  // decodeAudioData detaches the buffer, so hand it a copy.
  return ctx.decodeAudioData(result.bytes.slice(0));
}

/* ------------------------------------------------------------------ */
/* Adapters                                                            */
/* ------------------------------------------------------------------ */

interface AdapterMeta {
  label: string;
  badge: string;
  needsKey: boolean;
}

const ADAPTER_META: Record<TtsProviderId, AdapterMeta> = {
  gemini: { label: "Gemini TTS", badge: "Google GenAI", needsKey: false },
  cartesia: { label: "Cartesia AI", badge: "Sonic 3.6 · WAV 24 kHz", needsKey: true },
  deepgram: { label: "Deepgram Aura", badge: "Aura 2 · WAV 24 kHz", needsKey: true },
  fishtts: { label: "Fish TTS", badge: "S2.1 Free · WAV 24 kHz", needsKey: true },
};

export const TTS_PROVIDER_ORDER: TtsProviderId[] = ["gemini", "cartesia", "deepgram", "fishtts"];

function remoteAdapter(id: Exclude<TtsProviderId, "gemini">, voiceField: string): TtsAdapter {
  const meta = ADAPTER_META[id];
  return {
    id,
    label: meta.label,
    badge: meta.badge,
    needsKey: meta.needsKey,
    listVoices: () => fetchVoiceOptions(id),
    synthesize: async ({ text, voiceId }) => {
      const body: Record<string, unknown> = { text };
      if (voiceField) body[voiceField] = voiceId;
      const bytes = await postSynthesis(id, body);
      return { kind: "container", bytes };
    },
  };
}

export function createAdapters(geminiVoices: Voice[]): TtsAdapter[] {
  const geminiMeta = ADAPTER_META.gemini;

  const gemini: TtsAdapter = {
    id: "gemini",
    label: geminiMeta.label,
    badge: geminiMeta.badge,
    needsKey: geminiMeta.needsKey,
    listVoices: async () =>
      geminiVoices.map((v) => ({ id: v.name, label: `${v.name} (${v.analysis.gender})` })),
    synthesize: async ({ text, voiceId }) => {
      const ai = new GoogleGenAI({ apiKey: "server-side" });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro-preview-tts",
        contents: { parts: [{ text }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) throw new TtsProviderError("UPSTREAM_ERROR");

      return { kind: "raw-pcm", bytes: decodeBase64(audioData), sampleRate: 24000 };
    },
  };

  return [
    gemini,
    remoteAdapter("cartesia", "voice"),
    remoteAdapter("deepgram", "voice"),
    remoteAdapter("fishtts", "voice"),
  ];
}
