/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef } from 'react';

interface VoiceWaveformPreviewProps {
  audioUrl: string;
  isPlaying: boolean;
  color?: string;
}

const DEFAULT_BARS = 32;

export const VoiceWaveformPreview: React.FC<VoiceWaveformPreviewProps> = ({ audioUrl, isPlaying, color = '#71717a' }) => {
  const [amplitudes, setAmplitudes] = useState<number[]>(() => 
    Array.from({ length: DEFAULT_BARS }, () => 0.2 + Math.random() * 0.6)
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;

    // Fetch and analyze audio buffer for waveform amplitude
    const analyzeAudio = async () => {
      try {
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        if (!isMounted) return;

        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / DEFAULT_BARS);
        const filteredData: number[] = [];

        for (let i = 0; i < DEFAULT_BARS; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[i * blockSize + j]);
          }
          const avg = sum / blockSize;
          filteredData.push(Math.max(0.15, Math.min(1.0, avg * 3.5)));
        }

        setAmplitudes(filteredData);
        setIsLoaded(true);
        if (audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      } catch (e) {
        // Fallback to pseudo-random amplitudes if fetch/decode fails (CORS or network)
        if (isMounted) {
          setAmplitudes(Array.from({ length: DEFAULT_BARS }, () => 0.25 + Math.random() * 0.55));
          setIsLoaded(true);
        }
      }
    };

    analyzeAudio();

    return () => {
      isMounted = false;
    };
  }, [audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    let frame = 0;
    const render = () => {
      frame++;
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      const barWidth = width / amplitudes.length;
      const gap = 2;

      amplitudes.forEach((amp, idx) => {
        const x = idx * barWidth;
        const currentAmp = isPlaying ? Math.min(1.0, amp * (0.8 + 0.4 * Math.sin(frame * 0.1 + idx))) : amp;
        const barHeight = currentAmp * (height * 0.75);
        const y = (height - barHeight) / 2;

        ctx.fillStyle = isPlaying ? '#3186FF' : color;
        ctx.globalAlpha = isPlaying ? 0.9 : 0.4;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x + gap / 2, y, barWidth - gap, barHeight, 3);
        } else {
          ctx.rect(x + gap / 2, y, barWidth - gap, barHeight);
        }
        ctx.fill();
      });

      if (isPlaying) {
        animRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [amplitudes, isPlaying, color]);

  return (
    <div className="w-full h-full relative flex items-center justify-center px-4">
      <canvas 
        ref={canvasRef} 
        className="w-full h-10"
        style={{ width: '100%', height: '40px' }}
      />
    </div>
  );
};

export default VoiceWaveformPreview;
