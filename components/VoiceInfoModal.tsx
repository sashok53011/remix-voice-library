/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useEffect } from 'react';
import { Voice } from '../types';
import { X, Info, Activity, Volume2, Globe, Cpu, Zap, Radio, Play, Pause } from 'lucide-react';
import { TRANSLATIONS, Language } from '../translations';
import AudioVisualizer from './AudioVisualizer';

interface VoiceInfoModalProps {
  voice: Voice;
  onClose: () => void;
  lang: Language;
}

const VoiceInfoModal: React.FC<VoiceInfoModalProps> = ({ voice, onClose, lang }) => {
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
  const modalRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);

  useEffect(() => {
    modalRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [onClose]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(e => console.error("Playback failed", e));
      } else {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
  }, [isPlaying]);

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  return (
    <div 
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-zinc-900/70 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-info-title"
    >
      <div className="absolute inset-0" onClick={onClose}></div>

      <div 
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] outline-none animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Info size={20} />
            </div>
            <div>
              <h2 id="voice-info-title" className="text-lg font-bold text-zinc-900 dark:text-white">{voice.name} — {t.voiceMetadata || "Voice Metadata"}</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Gemini Neural Voice Specification & Specs</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Voice Banner / Quick Preview */}
          <div className="relative bg-zinc-900 dark:bg-zinc-800 rounded-2xl p-6 text-white overflow-hidden flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '12px 12px' }}></div>
            
            <div className="relative z-10 space-y-2 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm">
                  {voice.analysis.gender}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 text-xs font-semibold backdrop-blur-sm border border-indigo-400/30">
                  {voice.pitch} Pitch
                </span>
              </div>
              <h3 className="text-3xl font-serif tracking-tight">{voice.name}</h3>
              <p className="text-xs text-zinc-300 max-w-sm font-light">
                {voice.analysis.characteristics.join(', ')}
              </p>
            </div>

            {/* Play Button / Visualizer Preview */}
            <div className="relative z-10 flex flex-col items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-14 h-14 rounded-full bg-white text-zinc-900 flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
                title={isPlaying ? "Pause Preview" : "Play Preview"}
              >
                {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
              </button>
              <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-medium">
                {isPlaying ? 'Playing sample' : 'Listen sample'}
              </span>
            </div>

            <audio ref={audioRef} src={voice.audioSampleUrl} onEnded={handleAudioEnded} preload="none" />
          </div>

          {/* Detailed Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Sample Rate */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <Radio size={14} className="text-indigo-500" />
                <span>{t.sampleRate || "Sample Rate"}</span>
              </div>
              <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                24,000 Hz (24 kHz) • 16-bit PCM Mono WAV
              </p>
            </div>

            {/* Primary Emotion Style */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <Activity size={14} className="text-emerald-500" />
                <span>{t.primaryEmotion || "Primary Emotion Style"}</span>
              </div>
              <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 capitalize">
                {voice.characteristics[0] || voice.analysis.characteristics[0] || 'Professional / Neutral'}
              </p>
            </div>

            {/* Supported Languages */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl space-y-2 md:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <Globe size={14} className="text-blue-500" />
                <span>{t.supportedLanguages || "Supported Languages"}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["English (US/UK)", "Russian (Русский)", "German (Deutsch)", "Spanish", "French", "Japanese", "Italian", "Portuguese"].map((langName, idx) => (
                  <span key={idx} className="px-2.5 py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium">
                    {langName}
                  </span>
                ))}
              </div>
            </div>

            {/* Technical Compatibility Tags */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 rounded-xl space-y-2 md:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                <Cpu size={14} className="text-purple-500" />
                <span>{t.compatTags || "Technical Compatibility Tags"}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["Gemini TTS v2.5", "WebRTC Compatible", "Mono WAV 16-bit", "Low Latency (<120ms)", "Studio Grade", "API Grounded"].map((tag, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/40 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-semibold">
                    <Zap size={10} />
                    <span>{tag}</span>
                  </span>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full text-xs font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors"
          >
            {t.done || "Close"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceInfoModal;
