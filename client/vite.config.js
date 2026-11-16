import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development Vite forwards /api to the Node API (Nginx does this in production).
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 }, // Firebase SDK is large; fine for this app
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
