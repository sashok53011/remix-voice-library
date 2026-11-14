/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { Voice } from '../types';
import { X, FileText, Upload, Sparkles, Play, Square, Loader2, Download, Plus, Check, Volume2 } from 'lucide-react';
import { GoogleGenAI, Modality } from "../genaiProxy";
import AudioVisualizer from './AudioVisualizer';

interface TextStudioModalProps {
  voices: Voice[];
  onClose: () => void;
}

interface IntonationMode {
  id: string;
  name: string;
  emoji: string;
  promptInstruction: string;
}

interface BatchLineResult {
  index: number;
  text: string;
  audioBuffer?: AudioBuffer;
  wavBlob?: Blob;
  status: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
}

const INITIAL_INTONATION_MODES: IntonationMode[] = [
  { id: 'normal', name: 'Normal / Standard', emoji: '😐', promptInstruction: 'Neutral, natural, clear professional delivery.' },
  { id: 'angry', name: 'Angry / Злой', emoji: '😠', promptInstruction: 'Angry, aggressive, forceful, and tense tone.' },
  { id: 'annoyed', name: 'Annoyed / Раздраженный', emoji: '🙄', promptInstruction: 'Annoyed, frustrated, impatient, and bothered tone.' },
  { id: 'joyful', name: 'Joyful / Радостный', emoji: '😄', promptInstruction: 'Joyful, cheerful, upbeat, energetic, and happy tone.' },
  { id: 'calm', name: 'Calm / Спокойный', emoji: '😌', promptInstruction: 'Calm, serene, peaceful, soothing, and relaxed tone.' },
  { id: 'tired', name: 'Tired / Уставший', emoji: '🥱', promptInstruction: 'Tired, exhausted, weary, and low-energy tone.' },
  { id: 'hysterical', name: 'Hysterical / Истеричный', emoji: '😱', promptInstruction: 'Hysterical, frantic, panicky, and overexcited tone.' },
  { id: 'whispering', name: 'Whispering / Шепотом', emoji: '🤫', promptInstruction: 'Soft whispering, hushed, mysterious and secret tone.' },
  { id: 'smile', name: 'With a smile / С ухмылкой', emoji: '😏', promptInstruction: 'Speaking with a warm smile, playful, amused and cheeky tone.' }
];

const PRESET_TEXTS = [
  {
    label: "Welcome Announcement",
    text: "Welcome to our platform.\nWe are thrilled to have you here.\nDiscover the power of next-generation AI voices tailored for your creative projects."
  },
  {
    label: "Podcast Intro Script",
    text: "You are listening to Tech Horizons.\nThe podcast where we explore artificial intelligence.\nAnd the innovations shaping our world."
  },
  {
    label: "Narrative Story Snippet",
    text: "The old clock struck midnight.\nShadows stretched across the hardwood floor.\nThe wind whispered ancient secrets through the windowpane."
  }
];

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Create Mono WAV Blob from raw PCM Int16 bytes
function createMonoWavBlob(pcmData: Uint8Array, sampleRate: number = 24000): Blob {
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, chunkSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);           // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);  // SampleRate
  view.setUint32(28, byteRate, true);    // ByteRate
  view.setUint16(32, blockAlign, true);  // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);     // DataSize

  return new Blob([header, pcmData], { type: 'audio/wav' });
}

const TextStudioModal: React.FC<TextStudioModalProps> = ({ voices, onClose }) => {
  const [text, setText] = useState(PRESET_TEXTS[0].text);
  const [selectedVoiceName, setSelectedVoiceName] = useState(voices[0]?.name || 'Zephyr');
  const [intonationModes, setIntonationModes] = useState<IntonationMode[]>(INITIAL_INTONATION_MODES);
  const [selectedIntonationId, setSelectedIntonationId] = useState<string>('normal');
  
  // Custom mode creation state
  const [showNewModeForm, setShowNewModeForm] = useState(false);
  const [newModeName, setNewModeName] = useState('');
  const [newModeEmoji, setNewModeEmoji] = useState('✨');
  const [newModeInstruction, setNewModeInstruction] = useState('');

  // Manual emoji override for the next generation (empty = preset emoji).
  // Fish-style TTS endpoints read emotion from emoji in the input text.
  const [customEmoji, setCustomEmoji] = useState('');

  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Currently selected preset (for emoji placeholder/hints outside the handler)
  const activeMode =
    intonationModes.find(m => m.id === selectedIntonationId) || intonationModes[0];

  // Batch line-by-line generation state
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchResults, setBatchResults] = useState<BatchLineResult[]>([]);
  const [playingLineIndex, setPlayingLineIndex] = useState<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

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
      stopAudio();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, [onClose]);

  const stopAudio = () => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch (e) {}
      activeSourceRef.current = null;
    }
    setPlayingLineIndex(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (typeof content === 'string') {
        setText(content);
        setBatchResults([]);
      } else {
        setError("Could not read file contents as text.");
      }
    };
    reader.onerror = () => {
      setError("Error reading file.");
    };
    reader.readAsText(file);
  };

  const handleAddCustomMode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModeName.trim() || !newModeInstruction.trim()) return;

    const newId = `custom_${Date.now()}`;
    const customMode: IntonationMode = {
      id: newId,
      name: newModeName.trim(),
      emoji: newModeEmoji || '✨',
      promptInstruction: newModeInstruction.trim()
    };

    setIntonationModes(prev => [...prev, customMode]);
    setSelectedIntonationId(newId);
    setNewModeName('');
    setNewModeInstruction('');
    setShowNewModeForm(false);
  };

  // Run line-by-line batch generation
  const handleGenerateBatch = async () => {
    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      setError("Please enter or load some text lines to generate.");
      return;
    }

    setError(null);
    setIsBatchRunning(true);
    stopAudio();

    const selectedMode = intonationModes.find(m => m.id === selectedIntonationId) || intonationModes[0];
    
    const initialResults: BatchLineResult[] = lines.map((l, idx) => ({
      index: idx,
      text: l,
      status: 'pending'
    }));
    setBatchResults(initialResults);
    setBatchProgress({ current: 0, total: lines.length });

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const updatedResults = [...initialResults];

    for (let i = 0; i < lines.length; i++) {
      setBatchProgress({ current: i + 1, total: lines.length });
      updatedResults[i].status = 'generating';
      setBatchResults([...updatedResults]);

      try {
        const lineText = lines[i];
        const promptText = `[Delivery Style / Intonation: ${selectedMode.promptInstruction}]\nRead the following sentence naturally:\n${lineText}`;

        const ai = new GoogleGenAI({ apiKey: "server-side" });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-pro-preview-tts",
          contents: { parts: [{ text: promptText }] },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoiceName } },
            },
          },
          // OpenAI-compatible TTS endpoints (Fish & co) express emotion via
          // emoji embedded in the input text. Top-level fields: the server
          // feeds them to a custom TTS (emoji + clean line), while Gemini
          // keeps using the instruction prompt above and ignores them.
          ttsInput: lineText,
          ttsEmoji: customEmoji.trim() || selectedMode.emoji,
        });

        const audioDataBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioDataBase64) {
          throw new Error("No audio returned from API");
        }

        const rawBytes = decodeBase64(audioDataBase64);
        const wavBlob = createMonoWavBlob(rawBytes, 24000);
        const audioBuffer = await decodeAudioData(rawBytes, audioContextRef.current, 24000, 1);

        updatedResults[i] = {
          ...updatedResults[i],
          status: 'success',
          audioBuffer,
          wavBlob
        };
      } catch (err: any) {
        console.error(`Error generating line ${i + 1}:`, err);
        updatedResults[i] = {
          ...updatedResults[i],
          status: 'error',
          error: err?.message || "Generation failed"
        };
      }

      setBatchResults([...updatedResults]);
    }

    setIsBatchRunning(false);
  };

  const handlePlayLine = async (result: BatchLineResult) => {
    if (!result.audioBuffer) return;

    if (playingLineIndex === result.index) {
      stopAudio();
      return;
    }

    stopAudio();

    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = result.audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      setPlayingLineIndex(null);
    };

    activeSourceRef.current = source;
    source.start();
    setPlayingLineIndex(result.index);
  };

  const handleDownloadLine = (result: BatchLineResult, lineNum: number) => {
    if (!result.wavBlob) return;
    const url = URL.createObjectURL(result.wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice_${selectedVoiceName}_line_${lineNum}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div 
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-zinc-900/70 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="text-studio-title"
    >
      <div className="absolute inset-0" onClick={onClose}></div>
      
      <div 
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] outline-none animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-md">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <h2 id="text-studio-title" className="text-sm sm:text-lg font-bold text-zinc-900 dark:text-white truncate">Batch Line-by-Line & Intonation Studio</h2>
              <p className="hidden sm:block text-xs text-zinc-500 dark:text-zinc-400">Read line-by-line, export mono WAV files, and customize voice intonation</p>
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
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Top Controls: Voice Selector & File Upload */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                Select Voice
              </label>
              <select
                value={selectedVoiceName}
                onChange={(e) => setSelectedVoiceName(e.target.value)}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 py-2 px-3 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {voices.map(v => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.analysis.gender}, {v.pitch})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                Load Text File (.txt, .md, ...)
              </label>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".txt,.md,.json,.csv,.srt,.log,.html" 
                className="hidden" 
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shadow-sm"
              >
                <Upload size={16} className="text-indigo-500" />
                <span>{fileName ? `File: ${fileName}` : 'Choose Text File'}</span>
              </button>
            </div>
          </div>

          {/* Intonation / Emotion Modes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-indigo-500" />
                <span>Intonation & Emotion Mode</span>
              </label>
              <button
                onClick={() => setShowNewModeForm(!showNewModeForm)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium"
              >
                <Plus size={14} />
                <span>Add Custom Mode</span>
              </button>
            </div>

            {/* Intonation Mode Buttons */}
            <div className="flex flex-wrap gap-2">
              {intonationModes.map(mode => {
                const isSelected = selectedIntonationId === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedIntonationId(mode.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-zinc-900 dark:bg-indigo-600 text-white shadow-md scale-105'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200/60 dark:border-zinc-700/60'
                    }`}
                  >
                    <span>{mode.emoji}</span>
                    <span>{mode.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Manual emoji override for this run */}
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <label
                htmlFor="custom-emoji"
                className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap"
              >
                Свой эмодзи / Custom emoji
              </label>
              <input
                id="custom-emoji"
                type="text"
                value={customEmoji}
                onChange={(e) => setCustomEmoji(e.target.value)}
                placeholder={activeMode.emoji}
                title="Переопределяет эмодзи пресета для этой генерации / Overrides the preset emoji for this run"
                className="w-16 px-2 py-1.5 text-center text-base leading-none bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-900"
              />
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                пусто = пресет / empty = preset ({activeMode.emoji})
              </span>
            </div>

            {/* Custom Mode Form */}
            {showNewModeForm && (
              <form onSubmit={handleAddCustomMode} className="p-4 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl mt-3 space-y-3 animate-fade-in">
                <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">Create Custom Intonation Mode</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">Mode Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Sarcastic"
                      value={newModeName}
                      onChange={(e) => setNewModeName(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">Emoji Icon</label>
                    <input
                      type="text"
                      placeholder="e.g. 😏"
                      value={newModeEmoji}
                      onChange={(e) => setNewModeEmoji(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 dark:text-zinc-400 mb-1">Prompt Instruction</label>
                    <input
                      type="text"
                      placeholder="e.g. Sarcastic, mocking, witty tone"
                      value={newModeInstruction}
                      onChange={(e) => setNewModeInstruction(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-xs"
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewModeForm(false)}
                    className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500"
                  >
                    Save Mode
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Text Area & Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="batch-input-text" className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                Source Text (One line = One request & WAV file)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 font-medium">Presets:</span>
                {PRESET_TEXTS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setText(p.text);
                      setBatchResults([]);
                      setFileName(null);
                    }}
                    className="text-[10px] px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              id="batch-input-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setBatchResults([]);
              }}
              placeholder="Enter text, each line will be processed into a separate Mono WAV file..."
              rows={6}
              className="w-full p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Action Button: Generate Batch */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Total lines to process: <strong className="text-zinc-800 dark:text-zinc-200">{text.split('\n').filter(l => l.trim().length > 0).length}</strong>
            </div>

            <button
              onClick={handleGenerateBatch}
              disabled={isBatchRunning}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium shadow-lg transition-all ${
                isBatchRunning
                  ? 'bg-zinc-400 dark:bg-zinc-700 text-white cursor-not-allowed opacity-80'
                  : 'bg-zinc-900 dark:bg-indigo-600 hover:bg-zinc-800 dark:hover:bg-indigo-500 text-white hover:scale-105 active:scale-95'
              }`}
            >
              {isBatchRunning ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing Line {batchProgress.current} / {batchProgress.total}...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Generate Line-by-Line Mono WAVs</span>
                </>
              )}
            </button>
          </div>

          {/* Batch Results List */}
          {batchResults.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 flex items-center justify-between">
                <span>Generated Audio Files (Mono WAV 24kHz)</span>
                <span className="text-xs font-normal text-zinc-400">
                  {batchResults.filter(r => r.status === 'success').length} / {batchResults.length} completed
                </span>
              </h3>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                {batchResults.map((result) => {
                  const isPlaying = playingLineIndex === result.index;
                  return (
                    <div 
                      key={result.index}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
                        result.status === 'success'
                          ? 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700'
                          : result.status === 'error'
                          ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800/50'
                          : 'bg-zinc-50/30 dark:bg-zinc-900/30 border-zinc-200/50 dark:border-zinc-800'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-300 shrink-0 mt-0.5">
                          {result.index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">{result.text}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            {result.status === 'pending' && 'Waiting in queue...'}
                            {result.status === 'generating' && 'Generating speech...'}
                            {result.status === 'success' && 'Ready (Mono WAV)'}
                            {result.status === 'error' && `Error: ${result.error}`}
                          </p>
                        </div>
                      </div>

                      {/* Line actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        {result.status === 'generating' && (
                          <Loader2 size={16} className="animate-spin text-indigo-500" />
                        )}

                        {result.status === 'success' && (
                          <>
                            <button
                              onClick={() => handlePlayLine(result)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                isPlaying
                                  ? 'bg-amber-500 text-white'
                                  : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-white'
                              }`}
                            >
                              {isPlaying ? <Square size={12} /> : <Play size={12} />}
                              <span>{isPlaying ? 'Stop' : 'Play'}</span>
                            </button>

                            <button
                              onClick={() => handleDownloadLine(result, result.index + 1)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 rounded-lg text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                            >
                              <Download size={12} />
                              <span>Download .wav</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full text-xs font-medium hover:bg-zinc-800 dark:hover:bg-white transition-colors"
          >
            Close Studio
          </button>
        </div>
      </div>
    </div>
  );
};

export default TextStudioModal;
