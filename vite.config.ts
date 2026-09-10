import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

const conduit = process.env.LIVE_CONDUIT_URL ?? 'https://conduit.app.kopelke.online'

export default defineConfig({
  base: '/commander-decks/',
  root: 'site',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  // Conduit only allows the Pages origin, so dev reads bins through
  // /live/?c=http://localhost:5173/commander-decks.
  server: {
    proxy: {
      '/commander-decks/v1': {
        target: conduit,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace('/commander-decks', ''),
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'site/index.html'),
        live: resolve(rootDir, 'site/live/index.html'),
      },
    },
  },
})
