/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The one version of the app: the repository's VERSION file (the server reads the same file).
const appVersion = readFileSync(new URL('../VERSION', import.meta.url), 'utf-8').trim()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    // In development the API runs separately (npm run dev:server, port 8080).
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
