/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The built index.html uses relative asset URLs and a <base href> that the Go
// server rewrites to KESTREL_BASE_URL, so the same build works under any prefix.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    // `make dev-api` runs the Go server on 7676.
    proxy: {
      '/api': 'http://localhost:7676',
      '/ping': 'http://localhost:7676',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
