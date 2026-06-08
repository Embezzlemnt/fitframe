import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev-only: proxy /api to the live worker so the real scan count (and other
  // endpoints) work locally. No effect on the production build.
  server: {
    proxy: {
      '/api': {
        target: 'https://fitframe.store',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
