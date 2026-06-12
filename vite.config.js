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

// Dev-only /api proxy target. Defaults to a LOCAL `wrangler dev` instance so
// local testing can never write production data or send real emails by accident.
// Opt in to the live backend explicitly with: VITE_API_PROXY=prod npm run dev
const apiTarget =
  process.env.VITE_API_PROXY === 'prod'
    ? 'https://fitframe.store'
    : 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cleanUrlPages],
  // No effect on the production build.
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: apiTarget.startsWith('https'),
      },
    },
  },
})
