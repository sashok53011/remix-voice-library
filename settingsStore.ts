/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-side persistence for custom OpenAI-compatible provider settings
 * (LLM / TTS / STT). This is the first file-backed store in the project:
 * a JSON file under `data/`, written atomically (tmp + rename) and cached
 * in memory.
 *
 * API keys never leave the server unmasked: reads return `hasKey` +
 * `keyPreview`, writes treat an empty key as "keep the stored one".
 */
import fs from "fs";
import path from "path";

export type SettingsSection = "llm" | "tts" | "stt";
export const SETTINGS_SECTIONS: SettingsSection[] = ["llm", "tts", "stt"];

export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TtsSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

export interface SttSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AppSettings {
  llm: LlmSettings;
  tts: TtsSettings;
  stt: SttSettings;
}

/** Shape returned to the client: keys replaced by a mask. */
export interface MaskedAppSettings {
  llm: Omit<LlmSettings, "apiKey"> & { apiKey: ""; hasKey: boolean; keyPreview: string };
  tts: Omit<TtsSettings, "apiKey"> & { apiKey: ""; hasKey: boolean; keyPreview: string };
  stt: Omit<SttSettings, "apiKey"> & { apiKey: ""; hasKey: boolean; keyPreview: string };
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: { enabled: false, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "" },
  tts: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "tts-1", voice: "alloy" },
  stt: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "whisper-1" },
};

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

let cache: AppSettings | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSection<T extends object>(
  section: unknown,
  fallback: T
): T {
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  if (!isObject(section)) return out as T;
  for (const key of Object.keys(out)) {
    const value = section[key];
    const def = out[key];
    if (typeof def === "boolean") {
      out[key] = typeof value === "boolean" ? value : def;
    } else if (typeof def === "string") {
      out[key] = typeof value === "string" ? value.trim() : def;
    }
  }
  return out as T;
}

function sanitize(raw: unknown): AppSettings {
  if (!isObject(raw)) return { ...DEFAULT_SETTINGS };
  return {
    llm: sanitizeSection(raw.llm, DEFAULT_SETTINGS.llm),
    tts: sanitizeSection(raw.tts, DEFAULT_SETTINGS.tts),
    stt: sanitizeSection(raw.stt, DEFAULT_SETTINGS.stt),
  };
}

/** Reads settings from disk (cached). Missing/corrupt file → defaults. */
export function loadSettings(): AppSettings {
  if (cache) return cache;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      cache = sanitize(raw);
      return cache;
    }
  } catch (error) {
    console.error("[Settings] Failed to read settings.json, using defaults:", error);
  }
  cache = { ...DEFAULT_SETTINGS };
  return cache;
}

/** Persists the whole settings object atomically. */
export function saveSettings(settings: AppSettings): AppSettings {
  const clean = sanitize(settings);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(clean, null, 2), "utf-8");
  fs.renameSync(tmpFile, SETTINGS_FILE);
  cache = clean;
  return clean;
}

/** Merges a single section into the stored settings and persists it. */
export function saveSection<K extends SettingsSection>(
  section: K,
  value: AppSettings[K]
): AppSettings {
  const current = loadSettings();
  return saveSettings({ ...current, [section]: value } as AppSettings);
}

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as string[]).includes(value);
}

/** `sk-abcdef123456` → `sk-…3456`; short values → `…`. */
export function maskKey(key: string): string {
  const trimmed = (key || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "…";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

/** Client-facing view of the settings (keys masked). */
export function maskSettings(settings: AppSettings): MaskedAppSettings {
  const wrap = <T extends { apiKey: string }>(section: T) => {
    const { apiKey, ...rest } = section;
    return {
      ...rest,
      apiKey: "" as const,
      hasKey: Boolean(apiKey && apiKey.trim()),
      keyPreview: maskKey(apiKey),
    };
  };
  return {
    llm: wrap(settings.llm),
    tts: wrap(settings.tts),
    stt: wrap(settings.stt),
  };
}

/**
 * Effective key for a section: an explicitly provided (not yet saved) key
 * wins over the stored one, so "Fetch models"/"Test" work mid-edit.
 */
export function resolveSectionKey(
  section: SettingsSection,
  providedKey?: string
): string {
  const provided = typeof providedKey === "string" ? providedKey.trim() : "";
  if (provided) return provided;
  return loadSettings()[section].apiKey.trim();
}
