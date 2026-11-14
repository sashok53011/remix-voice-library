/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Cpu, Key, Globe, Loader2, Check, AlertCircle,
  Plug, ListRestart, Save, MessageSquare, AudioLines, FileAudio,
} from 'lucide-react';
import { TRANSLATIONS, Language } from '../translations';

interface OpenAiProviderModalProps {
  onClose: () => void;
  lang: Language;
}

type SectionId = 'llm' | 'tts' | 'stt';

interface SectionDraft {
  baseUrl: string;
  apiKey: string; // empty = keep the key stored on the server
  model: string;
  voice?: string;
  enabled?: boolean;
}

interface MaskedSection {
  baseUrl: string;
  apiKey: '';
  hasKey: boolean;
  keyPreview: string;
  model: string;
  voice?: string;
  enabled?: boolean;
}

interface MaskedSettings {
  llm: MaskedSection;
  tts: MaskedSection;
  stt: MaskedSection;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const EMPTY_DRAFT: SectionDraft = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: '',
  model: '',
  voice: 'alloy',
  enabled: false,
};

const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

const TABS: Array<{ id: SectionId; icon: typeof MessageSquare }> = [
  { id: 'llm', icon: MessageSquare },
  { id: 'tts', icon: AudioLines },
  { id: 'stt', icon: FileAudio },
];

interface SectionStatus {
  saving: boolean;
  testing: boolean;
  fetching: boolean;
  saved: boolean;
  testOk: boolean | null;
  testLatency: number | null;
  error: string | null;
  models: string[];
  modelsNote: string | null;
}

const idleStatus = (): SectionStatus => ({
  saving: false,
  testing: false,
  fetching: false,
  saved: false,
  testOk: null,
  testLatency: null,
  error: null,
  models: [],
  modelsNote: null,
});

const OpenAiProviderModal: React.FC<OpenAiProviderModalProps> = ({ onClose, lang }) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const modalRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<SectionId>('llm');
  const [settings, setSettings] = useState<MaskedSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<SectionId, SectionDraft>>({
    llm: { ...EMPTY_DRAFT },
    tts: { ...EMPTY_DRAFT, model: 'tts-1' },
    stt: { ...EMPTY_DRAFT, model: 'whisper-1' },
  });
  const [status, setStatus] = useState<Record<SectionId, SectionStatus>>({
    llm: idleStatus(),
    tts: idleStatus(),
    stt: idleStatus(),
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  // TTS functional test
  const [ttsText, setTtsText] = useState('Hello! This is a test of the custom OpenAI compatible text to speech provider.');
  const [isTtsLoading, setIsTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // STT functional test
  const [sttFile, setSttFile] = useState<File | null>(null);
  const [isSttLoading, setIsSttLoading] = useState(false);
  const [sttResult, setSttResult] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patchStatus = useCallback((section: SectionId, patch: Partial<SectionStatus>) => {
    setStatus((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
  }, []);

  const mapError = useCallback((code: string | undefined): string => {
    switch (code) {
      case 'NO_KEY': return t.settErrNoKey;
      case 'BAD_URL': return t.settErrBadUrl;
      case 'NOT_FOUND': return t.settErrNotFound;
      default: return t.settErrGeneric;
    }
  }, [t]);

  const readJsonError = useCallback(async (res: Response): Promise<string> => {
    try {
      const data = await res.json();
      // Prefer the human-readable upstream detail for auth/upstream failures.
      if ((data?.code === 'BAD_KEY' || data?.code === 'UPSTREAM_ERROR') && data?.error) {
        return String(data.error).slice(0, 200);
      }
      return mapError(data?.code);
    } catch {
      return t.settErrGeneric;
    }
  }, [mapError, t]);

  /** Loads masked settings from the server; migrates the old localStorage config once. */
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(String(res.status));
      const data: MaskedSettings = await res.json();
      setSettings(data);

      const hasAnyKey = data.llm.hasKey || data.tts.hasKey || data.stt.hasKey;
      if (!hasAnyKey) {
        // One-time migration from the previous localStorage-only config.
        try {
          const legacy = localStorage.getItem('openai_custom_config');
          if (legacy) {
            const parsed = JSON.parse(legacy);
            if (parsed?.baseUrl) {
              setDrafts({
                llm: {
                  baseUrl: parsed.baseUrl,
                  apiKey: parsed.apiKey || '',
                  model: '',
                  enabled: false,
                },
                tts: {
                  baseUrl: parsed.baseUrl,
                  apiKey: parsed.apiKey || '',
                  model: parsed.ttsModel || 'tts-1',
                  voice: parsed.ttsVoice || 'alloy',
                },
                stt: {
                  baseUrl: parsed.baseUrl,
                  apiKey: parsed.apiKey || '',
                  model: parsed.sttModel || 'whisper-1',
                },
              });
            }
          }
        } catch { /* ignore legacy parse errors */ }
      } else {
        setDrafts({
          llm: {
            baseUrl: data.llm.baseUrl,
            apiKey: '',
            model: data.llm.model,
            enabled: data.llm.enabled,
          },
          tts: {
            baseUrl: data.tts.baseUrl,
            apiKey: '',
            model: data.tts.model,
            voice: data.tts.voice || 'alloy',
          },
          stt: {
            baseUrl: data.stt.baseUrl,
            apiKey: '',
            model: data.stt.model,
          },
        });
      }
      setLoadError(null);
    } catch {
      setLoadError(t.settErrGeneric);
    }
  }, [t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    modalRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const draft = drafts[activeTab];
  const st = status[activeTab];
  const masked = settings?.[activeTab];

  const setDraft = (patch: Partial<SectionDraft>) => {
    setDrafts((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], ...patch } }));
    patchStatus(activeTab, { saved: false, testOk: null, testLatency: null, error: null });
  };

  const keyHeaders = (section: SectionId): Record<string, string> =>
    drafts[section].apiKey.trim() ? { 'x-settings-key': drafts[section].apiKey.trim() } : {};

  /* ------------------------------ Actions ------------------------------ */

  const handleSave = async () => {
    if (st.saving) return;
    patchStatus(activeTab, { saving: true, error: null, saved: false });
    try {
      const body: Record<string, unknown> = {
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
      };
      if (activeTab === 'tts') body.voice = (draft.voice || '').trim();
      if (activeTab === 'llm') body.enabled = Boolean(draft.enabled);

      const res = await fetch(`/api/settings/${activeTab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readJsonError(res));

      const data = await res.json();
      if (data?.settings) setSettings(data.settings);
      // The key now lives on the server — clear it from the form.
      setDrafts((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], apiKey: '' } }));
      patchStatus(activeTab, { saving: false, saved: true });
      setTimeout(() => patchStatus(activeTab, { saved: false }), 2500);
    } catch (err: any) {
      patchStatus(activeTab, { saving: false, error: err?.message || t.settErrGeneric });
    }
  };

  const handleFetchModels = async () => {
    if (st.fetching) return;
    patchStatus(activeTab, { fetching: true, error: null, models: [], modelsNote: null });
    try {
      const params = new URLSearchParams({ baseUrl: draft.baseUrl.trim() });
      const res = await fetch(`/api/settings/${activeTab}/models?${params.toString()}`, {
        headers: keyHeaders(activeTab),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const data = await res.json();
      const models: string[] = Array.isArray(data?.models) ? data.models : [];
      patchStatus(activeTab, {
        fetching: false,
        models,
        modelsNote: models.length ? `${models.length} ${t.settModelsFetched}` : t.settNoModels,
      });
    } catch (err: any) {
      patchStatus(activeTab, { fetching: false, error: err?.message || t.settErrGeneric });
    }
  };

  const handleTest = async () => {
    if (st.testing) return;
    patchStatus(activeTab, { testing: true, error: null, testOk: null, testLatency: null });
    try {
      const res = await fetch(`/api/settings/${activeTab}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: draft.baseUrl.trim(),
          apiKey: draft.apiKey.trim(),
        }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const data = await res.json();
      patchStatus(activeTab, {
        testing: false,
        testOk: true,
        testLatency: typeof data?.latencyMs === 'number' ? data.latencyMs : null,
      });
    } catch (err: any) {
      patchStatus(activeTab, { testing: false, testOk: false, error: err?.message || t.settErrGeneric });
    }
  };

  /* ------------------------- Functional tests ------------------------- */

  const handleRunTts = async () => {
    if (!ttsText.trim() || isTtsLoading) return;
    setIsTtsLoading(true);
    setTtsError(null);
    try {
      const res = await fetch('/api/settings/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsText,
          apiKey: drafts.tts.apiKey.trim(),
          model: drafts.tts.model,
          voice: drafts.tts.voice,
        }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (err: any) {
      setTtsError(err?.message || t.ttsErrUpstream);
    } finally {
      setIsTtsLoading(false);
    }
  };

  const handleRunStt = async () => {
    if (!sttFile || isSttLoading) return;
    setIsSttLoading(true);
    setSttError(null);
    setSttResult(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.slice(result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(new Error(t.settErrGeneric));
        reader.readAsDataURL(sttFile);
      });

      const res = await fetch('/api/settings/stt/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: sttFile.name,
          audioBase64: base64,
          apiKey: drafts.stt.apiKey.trim(),
          model: drafts.stt.model,
        }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const data = await res.json();
      setSttResult(data?.text || '');
    } catch (err: any) {
      setSttError(err?.message || t.settErrGeneric);
    } finally {
      setIsSttLoading(false);
    }
  };

  /* ------------------------------ Render ------------------------------ */

  const fieldLabel = 'block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1';
  const inputClass =
    'w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:focus:ring-emerald-900';

  const btnSecondary =
    'flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed';
  const btnPrimary =
    'flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4 bg-zinc-900/70 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="openai-modal-title"
    >
      <div className="absolute inset-0" onClick={onClose}></div>

      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] outline-none animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md">
              <Cpu size={20} />
            </div>
            <div className="min-w-0">
              <h2 id="openai-modal-title" className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white truncate">
                {t.settTitle}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{t.settDesc}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 shrink-0 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 sm:px-6 pt-2">
          {TABS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Icon size={14} />
              <span>{id === 'llm' ? t.settTabLlm : id === 'tts' ? t.settTabTts : t.settTabStt}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar flex-1">
          {loadError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{loadError}</span>
            </div>
          )}

          {/* ---- Section config form ---- */}
          <div className="space-y-4">
            {activeTab === 'llm' && (
              <label className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(draft.enabled)}
                  onChange={(e) => setDraft({ enabled: e.target.checked })}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                    {t.settUseInsteadGemini}
                  </span>
                  <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    {t.settUseInsteadGeminiHint}
                  </span>
                </span>
              </label>
            )}

            <div>
              <label className={fieldLabel}>{t.settBaseUrl}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                  <Globe size={16} />
                </div>
                <input
                  type="url"
                  inputMode="url"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ baseUrl: e.target.value })}
                  placeholder={DEFAULT_BASE_URL}
                  className={`${inputClass} pl-10`}
                />
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                OpenAI, OpenRouter, Groq, Ollama, LocalAI, …
              </p>
            </div>

            <div>
              <label className={fieldLabel}>{t.settApiKey}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                  <Key size={16} />
                </div>
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ apiKey: e.target.value })}
                  placeholder={masked?.hasKey ? `${t.settKeyStored} (${masked.keyPreview})` : 'sk-...'}
                  className={`${inputClass} pl-10`}
                />
              </div>
              {masked?.hasKey && !draft.apiKey && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <Check size={11} />
                  <span>{t.settKeyKeepHint}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={fieldLabel}>{t.settModel}</label>
                <input
                  type="text"
                  value={draft.model}
                  onChange={(e) => setDraft({ model: e.target.value })}
                  placeholder={activeTab === 'llm' ? 'gpt-4o-mini' : activeTab === 'tts' ? 'tts-1' : 'whisper-1'}
                  className={inputClass}
                  list={`models-${activeTab}`}
                />
                <datalist id={`models-${activeTab}`}>
                  {st.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>

              {activeTab === 'tts' && (
                <div>
                  <label className={fieldLabel}>{t.settVoice}</label>
                  <input
                    type="text"
                    value={draft.voice || ''}
                    onChange={(e) => setDraft({ voice: e.target.value })}
                    placeholder="alloy"
                    className={inputClass}
                    list="tts-voices"
                  />
                  <datalist id="tts-voices">
                    {OPENAI_VOICES.map((v) => <option key={v} value={v} />)}
                  </datalist>
                </div>
              )}
            </div>
          </div>

          {/* ---- Action buttons ---- */}
          <div className="flex flex-wrap gap-2">
            <button onClick={handleFetchModels} disabled={st.fetching || st.saving} className={btnSecondary}>
              {st.fetching ? <Loader2 size={14} className="animate-spin" /> : <ListRestart size={14} />}
              <span>{st.fetching ? t.settFetching : t.settFetchModels}</span>
            </button>
            <button onClick={handleTest} disabled={st.testing || st.saving} className={btnSecondary}>
              {st.testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
              <span>{st.testing ? t.settTesting : t.settTest}</span>
            </button>
            <button onClick={handleSave} disabled={st.saving} className={`${btnPrimary} sm:ml-auto`}>
              {st.saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{st.saving ? t.settSaving : t.settSave}</span>
            </button>
          </div>

          {/* ---- Status feedback ---- */}
          {st.saved && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-fade-in">
              <Check size={14} />
              <span>{t.settSaved}</span>
            </div>
          )}
          {st.testOk === true && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-fade-in">
              <Check size={14} />
              <span>
                {t.settTestOk}
                {st.testLatency !== null ? ` · ${st.testLatency} ms` : ''}
              </span>
            </div>
          )}
          {st.error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-center gap-2 animate-fade-in">
              <AlertCircle size={14} />
              <span>{st.error}</span>
            </div>
          )}
          {st.modelsNote && !st.error && (
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
              <ListRestart size={12} />
              <span>{st.modelsNote}</span>
            </div>
          )}

          {/* ---- Functional test: TTS ---- */}
          {activeTab === 'tts' && (
            <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800 animate-fade-in">
              <label className={fieldLabel}>{t.settTtsTestLabel}</label>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                rows={3}
                className={`${inputClass} resize-none`}
              />
              {ttsError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{ttsError}</span>
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={handleRunTts} disabled={isTtsLoading || !ttsText.trim()} className={btnPrimary}>
                  {isTtsLoading ? <Loader2 size={14} className="animate-spin" /> : <AudioLines size={14} />}
                  <span>{isTtsLoading ? t.settSynthesizing : t.settSynthesize}</span>
                </button>
              </div>
              <audio ref={audioRef} className="w-full" controls />
            </div>
          )}

          {/* ---- Functional test: STT ---- */}
          {activeTab === 'stt' && (
            <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800 animate-fade-in">
              <label className={fieldLabel}>{t.settSttTestLabel}</label>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setSttFile(e.target.files?.[0] || null)}
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 text-center cursor-pointer hover:border-emerald-500 transition-colors bg-zinc-50/50 dark:bg-zinc-800/30"
              >
                <FileAudio size={28} className="mx-auto text-zinc-400 mb-2" />
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {sttFile ? sttFile.name : 'Click to select audio (.mp3, .wav, .m4a, .webm)'}
                </p>
              </div>
              {sttError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{sttError}</span>
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={handleRunStt} disabled={!sttFile || isSttLoading} className={btnPrimary}>
                  {isSttLoading ? <Loader2 size={14} className="animate-spin" /> : <FileAudio size={14} />}
                  <span>{isSttLoading ? t.settTranscribing : t.settTranscribe}</span>
                </button>
              </div>
              {sttResult !== null && (
                <div className="space-y-1">
                  <label className={fieldLabel}>{t.settTranscriptionResult}</label>
                  <div className="p-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-800 dark:text-zinc-200 font-mono whitespace-pre-wrap">
                    {sttResult || '—'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full text-xs font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors"
          >
            {t.done || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OpenAiProviderModal;
