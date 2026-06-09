import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only: serve the static content pages at their clean URLs (/about, /faq,
// /returns, /privacy), matching Cloudflare Pages' clean-URL behavior in prod.
const cleanUrlPages = {
  name: 'clean-url-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const m = req.url && req.url.match(/^\/(about|faq|returns|privacy)(?:\/)?(?:\?.*)?$/)
      if (m) req.url = `/${m[1]}.html`
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cleanUrlPages],
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
