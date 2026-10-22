/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { themeScript } from '@hyprsh/design'
import { defineConfig, type Plugin } from 'vite'

// The pre-paint theme script comes from the design system, so it applies the stored choice exactly as
// the ThemeSwitcher does. index.html is static, so it is injected here, ahead of everything else.
const prePaintTheme = (): Plugin => ({
  name: 'kestrel-pre-paint-theme',
  transformIndexHtml: () => [
    { tag: 'script', children: themeScript({ storageKey: 'kestrel.theme', attribute: 'class' }), injectTo: 'head-prepend' },
  ],
})

// The built index.html uses relative asset URLs and a <base href> that the Go
// server rewrites to KESTREL_BASE_URL, so the same build works under any prefix.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), prePaintTheme()],
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
