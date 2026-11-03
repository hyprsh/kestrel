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
  build: {
    rolldownOptions: {
      output: {
        // Vendor code is split out by library: it changes far less often than the app, so a browser that cached it keeps
        // it across releases, and the design system (one 430 kB file that cannot be tree-shaken) does not ride in the app's chunk.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'design', test: /node_modules[\\/]@hyprsh[\\/]design[\\/]/, priority: 20 },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    // Tests read the server's Go source to check the SPA has words for every kind and code.
    fs: { allow: ['..'] },
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
    // A test is ~0.1-1 s alone but 5-10x that while `make check` runs every package's tests at once; the default 5 s timed out the first test of a file.
    testTimeout: 20_000,
  },
})
