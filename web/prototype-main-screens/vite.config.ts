import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PROTOTYPE, throwaway. See README.md.
export default defineConfig({ plugins: [react(), tailwindcss()] })
