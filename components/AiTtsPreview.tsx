/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Square, Loader2, Volume2, AlertCircle, ChevronDown, Key, Check } from 'lucide-react';
import { Voice } from '../types';
import AudioVisualizer from './AudioVisualizer';
import { TRANSLATIONS, Language } from '../translations';
import {
  TtsAdapter,
  TtsProviderId,
  TtsProviderError,
  TtsVoiceOption,
  createAdapters,
  getStoredKey,
  setStoredKey,
  resultToAudioBuffer,
} from '../lib/ttsProviders';

interface AiTtsPreviewProps {
  text: string;
  voices: Voice[];
  lang: Language;
}

const AiTtsPreview: React.FC<AiTtsPreviewProps> = ({ text, voices, lang }) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

  const adapters = useMemo(() => createAdapters(voices), [voices]);
  const [provider, setProvider] = useState<TtsProviderId>('gemini');
  const adapter = adapters.find(a => a.id === provider) || adapters[0];

  // Voice catalogue for the active provider
  const [voiceOptions, setVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [currentVoiceId, setCurrentVoiceId] = useState('');
  const [voicesLoading, setVoicesLoading] = useState(false);

  // API key entry (hybrid: server env first, user key as fallback)
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [keyReload, setKeyReload] = useState(0);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const isMountedRef = useRef(true);

  const mapError = (code: string): string => {
    switch (code) {
      case 'NO_KEY': return t.ttsErrNoKey;
      case 'BAD_KEY': return t.ttsErrBadKey;
      case 'NO_CREDITS': return t.ttsErrNoCredits;
      case 'RATE_LIMITED': return t.ttsErrRateLimited;
      case 'TEXT_TOO_LONG': return t.ttsErrTextTooLong;
      case 'TIMEOUT': return t.ttsErrTimeout;
      case 'BAD_REQUEST': return t.ttsErrBadRequest;
      default: return t.ttsErrUpstream;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Load the voice catalogue whenever the provider (or saved key) changes
  useEffect(() => {
    let cancelled = false;
    setVoicesLoading(true);
    setError(null);
    setVoiceOptions([]);
    setShowKeyForm(false);
    setKeySaved(false);
    setKeyInput(getStoredKey(adapter.id));

    adapter.listVoices()
      .then(options => {
        if (cancelled) return;
        setVoiceOptions(options);
        setCurrentVoiceId(prev => (options.some(o => o.id === prev) ? prev : options[0]?.id || ''));
      })
      .catch(err => {
        if (cancelled) return;
        const code = err instanceof TtsProviderError ? err.code : 'UPSTREAM_ERROR';
        if (code === 'NO_KEY') {
          setShowKeyForm(true);
        } else {
          setError(`${t.ttsVoicesFailed}: ${mapError(code)}`);
        }
        setCurrentVoiceId('');
      })
      .finally(() => {
        if (!cancelled) setVoicesLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, keyReload, lang]);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch (e) {}
      sourceNodeRef.current = null;
    }
    if (isMountedRef.current) setIsPlaying(false);
  };

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredKey(adapter.id, keyInput.trim());
    setKeySaved(true);
    setShowKeyForm(false);
    setKeyReload(n => n + 1);
  };

  const handlePlay = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isLoading) return;

    if (isPlaying) {
      stopAudio();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await adapter.synthesize({ text, voiceId: currentVoiceId });
      if (!isMountedRef.current) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const audioBuffer = await resultToAudioBuffer(result, audioContextRef.current);
      if (!isMountedRef.current) return;

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => {
        if (isMountedRef.current) setIsPlaying(false);
      };

      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);
    } catch (err: any) {
      console.error(`TTS error (${adapter.id}):`, err);
      const code = err instanceof TtsProviderError ? err.code : 'UPSTREAM_ERROR';
      if (!isMountedRef.current) return;
      if (code === 'NO_KEY') {
        setKeyInput(getStoredKey(adapter.id));
        setShowKeyForm(true);
      }
      setError(mapError(code));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  const playDisabled = isLoading || voicesLoading || adapter.listVoices === undefined;
  const needsKeyNow = showKeyForm && adapter.needsKey;

  return (
    <div className="w-full bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        
        {/* Provider Tabs */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-700 bg-zinc-100/60 dark:bg-zinc-900/60 overflow-x-auto scrollbar-hide">
            {adapters.map((p) => (
                <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-all border-b-2 ${
                        provider === p.id 
                            ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-indigo-600 shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-800 dark:hover:text-zinc-200'
                    }`}
                >
                    <span className={`w-2 h-2 rounded-full ${
                        p.id === 'gemini' ? 'bg-blue-500'
                        : p.id === 'cartesia' ? 'bg-indigo-500'
                        : p.id === 'deepgram' ? 'bg-purple-500'
                        : 'bg-emerald-500'
                    }`}></span>
                    <span>{p.label}</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-normal">
                        {p.badge}
                    </span>
                </button>
            ))}
        </div>

        {/* Header / Controls */}
        <div className="p-4 flex flex-col sm:flex-row gap-4 items-center justify-between bg-white dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
            
            {/* Voice Selector + key button */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative group flex-1 sm:flex-none">
                    <select
                        value={currentVoiceId}
                        onChange={(e) => setCurrentVoiceId(e.target.value)}
                        className="appearance-none w-full sm:w-60 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 py-2 pl-3 pr-10 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:focus:ring-zinc-600 cursor-pointer transition-all hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-wait"
                        disabled={isLoading || isPlaying || voicesLoading}
                    >
                        {voicesLoading && <option value="">{t.ttsVoicesLoading}</option>}
                        {!voicesLoading && voiceOptions.length === 0 && <option value="">—</option>}
                        {voiceOptions.map(v => (
                            <option key={v.id} value={v.id}>
                                {v.label}
                            </option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
                        <ChevronDown size={14} />
                    </div>
                </div>

                {adapter.needsKey && (
                    <button
                        onClick={() => { setKeyInput(getStoredKey(adapter.id)); setShowKeyForm(v => !v); setKeySaved(false); }}
                        className={`p-2 rounded-lg border transition-colors ${
                            showKeyForm
                                ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                                : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                        title={t.ttsNeedsKey}
                        aria-label={t.ttsNeedsKey}
                    >
                        <Key size={14} />
                    </button>
                )}
            </div>

            {/* Play Button */}
            <button
                onClick={handlePlay}
                disabled={playDisabled}
                className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 transform active:scale-95 ${
                    isPlaying 
                    ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-600' 
                    : 'bg-zinc-900 dark:bg-indigo-600 text-white hover:bg-zinc-800 dark:hover:bg-indigo-500 shadow-md'
                } ${playDisabled ? 'cursor-not-allowed opacity-70' : ''}`}
            >
                {isLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                ) : isPlaying ? (
                    <Square size={16} className="fill-current" />
                ) : (
                    <Play size={16} className="fill-current" />
                )}
                <span>
                    {isLoading ? t.ttsGenerating : isPlaying ? t.ttsStopPreview : `${t.ttsListen} (${adapter.label})`}
                </span>
            </button>
        </div>

        {/* API key form */}
        {needsKeyNow && (
            <form onSubmit={handleSaveKey} className="p-4 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900/50 space-y-2">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <Key size={12} />
                    <span>{t.ttsNeedsKey} — {adapter.label}</span>
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                    {t.ttsKeyHint}
                </p>
                <div className="flex gap-2">
                    <input
                        type="password"
                        value={keyInput}
                        onChange={(e) => setKeyInput(e.target.value)}
                        placeholder={t.ttsKeyPlaceholder}
                        className="flex-1 min-w-0 px-3 py-2 bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-800"
                    />
                    <button
                        type="submit"
                        disabled={!keyInput.trim()}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                        <Check size={12} />
                        <span>{t.ttsSaveKey}</span>
                    </button>
                </div>
            </form>
        )}

        {keySaved && !needsKeyNow && (
            <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/40 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <Check size={12} />
                <span>{t.ttsKeySaved}</span>
            </div>
        )}

        {/* Visualizer Area */}
        <div 
            className={`h-24 relative flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 overflow-hidden group ${playDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`} 
            onClick={playDisabled ? undefined : handlePlay}
            role="button"
            tabIndex={playDisabled ? -1 : 0}
            onKeyDown={(e) => { if (!playDisabled && (e.key === 'Enter' || e.key === ' ')) handlePlay(); }}
            aria-label={isPlaying ? t.ttsStopPreview : t.ttsListen}
        >
             {/* Grid Background */}
             <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.1]" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '8px 8px' }}></div>
            
             {/* Icon or Visualizer */}
             <div className="w-full h-full absolute inset-0 flex items-center justify-center pointer-events-none">
                 {isPlaying ? (
                     <div className="w-full h-full opacity-80">
                         <AudioVisualizer isPlaying={true} color={document.documentElement.classList.contains('dark') ? '#a5b4fc' : '#18181b'} />
                     </div>
                 ) : (
                     <div className="flex flex-col items-center gap-2 text-zinc-300 dark:text-zinc-600 px-4 text-center">
                         <Volume2 size={24} />
                         <span className="text-xs font-medium">
                             {isLoading ? t.ttsGenerating : `${t.ttsClickToPreview} ${adapter.label}`}
                         </span>
                     </div>
                 )}
             </div>

             {/* Error Message */}
             {error && (
                 <div className="absolute inset-0 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-red-500 dark:text-red-400 gap-2 text-sm z-20 px-4 text-center">
                     <AlertCircle size={16} className="shrink-0" />
                     <span>{error}</span>
                 </div>
             )}
        </div>
    </div>
  );
};

export default AiTtsPreview;
