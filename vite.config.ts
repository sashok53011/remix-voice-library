import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    // Deployed behind the portal proxy under /remix-voice-library/ — set
    // VITE_BASE at build time; local dev stays at "/".
    base: process.env.VITE_BASE || '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    build: {
      target: 'esnext',
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
