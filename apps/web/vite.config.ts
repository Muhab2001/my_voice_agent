import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) },
  },
  server: {
    proxy: {
      '/v1': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
      },
      '/health': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
      },
    },
  },
})
