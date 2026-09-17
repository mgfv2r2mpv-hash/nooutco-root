import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served at /cpr/dist/. /CPRAnalyzer/ still redirects there for old links.
  base: '/cpr/dist/',
})
