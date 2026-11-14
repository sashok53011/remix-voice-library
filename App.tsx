/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useMemo, useEffect } from 'react';
import { VOICE_DATA } from './constants';
import Carousel3D from './components/Carousel3D';
import GridView from './components/GridView';
import FilterBar from './components/FilterBar';
import VoiceFinder from './components/VoiceFinder';
import AiResultCard from './components/AiResultCard';
import TextStudioModal from './components/TextStudioModal';
import VoiceInfoModal from './components/VoiceInfoModal';
import OpenAiProviderModal from './components/OpenAiProviderModal';
import { FilterState, AiRecommendation, Voice } from './types';
import { TRANSLATIONS, Language } from './translations';
import { Info } from 'lucide-react';
import JSZip from 'jszip';

function createMonoWavBlob(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, chunkSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // SubChunk1Size
  view.setUint16(20, 1, true);           // AudioFormat (PCM)
  view.setUint16(22, numChannels, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);  // SampleRate
  view.setUint32(28, byteRate, true);    // ByteRate
  view.setUint16(32, blockAlign, true);  // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);     // DataSize

  return new Blob([header, pcmData], { type: 'audio/wav' });
}

const App: React.FC = () => {
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiRecommendation | null>(null);
  const [isAiCardVisible, setIsAiCardVisible] = useState(false);
  const [showVoiceFinder, setShowVoiceFinder] = useState(false);
  const [showTextStudio, setShowTextStudio] = useState(false);
  const [showOpenAiModal, setShowOpenAiModal] = useState(false);
  const [selectedVoiceForInfo, setSelectedVoiceForInfo] = useState<Voice | null>(null);
  const [viewMode, setViewMode] = useState<'carousel' | 'grid'>('carousel');
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  // Language state (en, ru, de)
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('gemini_voice_lang');
      return (saved as Language) || 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('gemini_voice_lang', lang);
    } catch (e) {}
  }, [lang]);

  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

  // Carousel state
  const [activeIndex, setActiveIndex] = useState(0);

  // Favorites State with localStorage persistence
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('gemini_voice_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('gemini_voice_favorites', JSON.stringify(favorites));
    } catch (e) {
      console.error("Failed to save favorites", e);
    }
  }, [favorites]);

  const toggleFavorite = (voiceName: string) => {
    setFavorites(prev => 
      prev.includes(voiceName) ? prev.filter(n => n !== voiceName) : [...prev, voiceName]
    );
  };

  const [filters, setFilters] = useState<FilterState>({
    gender: 'All',
    pitch: 'All',
    search: '',
    favoritesOnly: false,
  });

  // Batch ZIP Download State
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [zipProgress, setZipProgress] = useState({ current: 0, total: 0 });

  const handleDownloadZip = async () => {
    if (filteredVoices.length === 0 || isDownloadingZip) return;

    setIsDownloadingZip(true);
    setZipProgress({ current: 0, total: filteredVoices.length });

    try {
      const zip = new JSZip();
      const folder = zip.folder("filtered_voices_mono_wav");

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      for (let i = 0; i < filteredVoices.length; i++) {
        const voice = filteredVoices[i];
        setZipProgress({ current: i + 1, total: filteredVoices.length });

        try {
          const resp = await fetch(voice.audioSampleUrl);
          const arrayBuffer = await resp.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const channelData = audioBuffer.getChannelData(0);
          const sampleRate = audioBuffer.sampleRate || 24000;

          const pcm16 = new Int16Array(channelData.length);
          for (let s = 0; s < channelData.length; s++) {
            const val = Math.max(-1, Math.min(1, channelData[s]));
            pcm16[s] = val < 0 ? val * 0x8000 : val * 0x7FFF;
          }

          const wavBlob = createMonoWavBlob(new Uint8Array(pcm16.buffer), sampleRate);
          folder?.file(`${voice.name}_mono.wav`, wavBlob);
        } catch (e) {
          console.error(`Failed to process voice ${voice.name} for ZIP:`, e);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini_voices_${filters.favoritesOnly ? 'favorites' : 'filtered'}_mono.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ZIP creation failed:", e);
    } finally {
      setIsDownloadingZip(false);
    }
  };

  // Theme Management
  useEffect(() => {
    if (isDarkMode) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  const uniqueGenders = useMemo(() => Array.from(new Set(VOICE_DATA.map(v => v.analysis.gender))).sort(), []);
  const uniquePitches = useMemo(() => Array.from(new Set(VOICE_DATA.map(v => v.analysis.pitch))).sort(), []);

  const filteredVoices = useMemo(() => {
    let baseData = VOICE_DATA;
    if (aiResult) {
       const recommended = aiResult.voiceNames
          .map(name => VOICE_DATA.find(v => v.name === name))
          .filter((v): v is typeof VOICE_DATA[0] => !!v);
       return recommended.length > 0 ? recommended : baseData;
    }

    return baseData.filter(voice => {
      const matchGender = filters.gender === 'All' || voice.analysis.gender === filters.gender;
      const matchPitch = filters.pitch === 'All' || voice.analysis.pitch === filters.pitch;
      const matchFavorites = !filters.favoritesOnly || favorites.includes(voice.name);
      
      const searchLower = filters.search.toLowerCase();
      const matchSearch = filters.search === '' || 
        voice.name.toLowerCase().includes(searchLower) || 
        voice.characteristics.some(c => c.toLowerCase().includes(searchLower)) ||
        voice.analysis.characteristics.some(c => c.toLowerCase().includes(searchLower)) ||
        voice.analysis.gender.toLowerCase().startsWith(searchLower) ||
        voice.pitch.toLowerCase().includes(searchLower) ||
        voice.analysis.pitch.toLowerCase().includes(searchLower);

      return matchGender && matchPitch && matchFavorites && matchSearch;
    });
  }, [filters, aiResult, favorites]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filteredVoices.length]);

  const handlePlayToggle = (voiceName: string) => {
    setPlayingVoice(current => current === voiceName ? null : voiceName);
  };

  const clearAiResult = () => {
    setAiResult(null);
    setIsAiCardVisible(false);
    setFilters({ ...filters, search: '' });
  };

  const isModalOpen = showVoiceFinder || showTextStudio || showOpenAiModal || selectedVoiceForInfo !== null || (aiResult && isAiCardVisible);

  return (
    <div className="h-[100dvh] w-full bg-[#FDFDFD] dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 font-sans overflow-hidden flex flex-col relative transition-colors duration-300">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-blue-50 dark:bg-blue-900/20 blur-3xl opacity-60"></div>
          <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-purple-50 dark:bg-purple-900/20 blur-3xl opacity-50"></div>
      </div>

      {/* Main App Content - aria-hidden and inert when modal is open */}
      <div 
        className="flex flex-col flex-1 overflow-hidden" 
        aria-hidden={isModalOpen}
        // @ts-ignore - 'inert' is a standard attribute but might not be in all TS types yet
        inert={isModalOpen ? '' : undefined}
        style={isModalOpen ? { pointerEvents: 'none' } : {}}
      >
        <FilterBar 
          filters={filters}
          onFilterChange={setFilters}
          uniqueGenders={uniqueGenders}
          uniquePitches={uniquePitches}
          onOpenAiCasting={() => setShowVoiceFinder(true)}
          onOpenTextStudio={() => setShowTextStudio(true)}
          onOpenOpenAi={() => setShowOpenAiModal(true)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          favoritesCount={favorites.length}
          onDownloadZip={handleDownloadZip}
          isDownloadingZip={isDownloadingZip}
          zipProgress={zipProgress}
          lang={lang}
          onLangChange={setLang}
        />

        <main className="flex-1 relative flex flex-col overflow-hidden">
              {filteredVoices.length > 0 ? (
                  viewMode === 'carousel' ? (
                    <div className="w-full flex-1 flex items-center justify-center pb-8 min-h-0">
                         <Carousel3D 
                            voices={filteredVoices}
                            activeIndex={activeIndex}
                            onChange={setActiveIndex}
                            playingVoice={playingVoice}
                            onPlayToggle={handlePlayToggle}
                            disabled={isModalOpen}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            onOpenInfo={setSelectedVoiceForInfo}
                         />
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <GridView 
                          voices={filteredVoices}
                          playingVoice={playingVoice}
                          onPlayToggle={handlePlayToggle}
                          favorites={favorites}
                          onToggleFavorite={toggleFavorite}
                          onOpenInfo={setSelectedVoiceForInfo}
                      />
                    </div>
                  )
              ) : (
                  <div className="w-full h-full flex items-center justify-center pb-24">
                      <div className="text-center animate-fade-in">
                          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 mb-6 shadow-sm">
                              <Info size={32} className="text-zinc-300 dark:text-zinc-500" />
                          </div>
                          <h3 className="text-xl font-serif text-zinc-900 dark:text-white mb-2">{t.noVoicesFound}</h3>
                          <p className="text-zinc-500 dark:text-zinc-400 mb-6">{t.noVoicesDesc}</p>
                          <button 
                              onClick={() => setShowVoiceFinder(true)}
                              className="px-4 py-2 bg-zinc-900 dark:bg-indigo-600 text-white rounded-full text-sm font-medium hover:bg-zinc-800 dark:hover:bg-indigo-500 transition-colors"
                          >
                              {t.openAiCasting}
                          </button>
                      </div>
                  </div>
              )}
              
              {!aiResult && filteredVoices.length > 0 && viewMode === 'carousel' && (
                  <div className="absolute bottom-6 left-0 right-0 text-center pointer-events-none">
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium tracking-widest uppercase bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm inline-block px-3 py-1 rounded-full border border-white/50 dark:border-zinc-800">
                          {activeIndex + 1} / {filteredVoices.length}
                      </p>
                  </div>
              )}
        </main>
      </div>

      {/* Modals are rendered outside the aria-hidden container */}
      {showVoiceFinder && (
        <VoiceFinder 
            voices={VOICE_DATA}
            onRecommendation={(rec) => {
                if (rec) {
                    setAiResult(rec);
                    setIsAiCardVisible(true);
                    setFilters(prev => ({ ...prev, search: '' })); 
                }
                setShowVoiceFinder(false);
            }}
            onClose={() => setShowVoiceFinder(false)}
        />
      )}

      {showTextStudio && (
        <TextStudioModal 
            voices={VOICE_DATA}
            onClose={() => setShowTextStudio(false)}
        />
      )}

      {showOpenAiModal && (
        <OpenAiProviderModal 
            onClose={() => setShowOpenAiModal(false)}
            lang={lang}
        />
      )}

      {selectedVoiceForInfo && (
        <VoiceInfoModal 
            voice={selectedVoiceForInfo}
            onClose={() => setSelectedVoiceForInfo(null)}
            lang={lang}
        />
      )}

      {aiResult && isAiCardVisible && (
          <div 
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-900/60 backdrop-blur-sm animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-result-title"
          >
             <div className="absolute inset-0" onClick={clearAiResult}></div>
             <div className="relative w-full max-w-5xl animate-slide-up max-h-[90dvh] overflow-hidden rounded-2xl">
                 <AiResultCard 
                    result={aiResult} 
                    voices={filteredVoices} 
                    onClose={clearAiResult} 
                    lang={lang}
                 />
             </div>
          </div>
      )}

    </div>
  );
};

export default App;