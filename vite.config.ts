import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// The public address of the site. Canonical links, Open Graph URLs and the sitemap all need
// it absolute. Override per deploy with `SITE_URL=https://example.com npm run build`.
const SITE_URL = (process.env.SITE_URL ?? 'https://dreiibot.github.io/my-portfolio').replace(/\/$/, '')

function seo(): Plugin {
  let ssr = false
  return {
    name: 'seo',
    configResolved: (config) => {
      ssr = Boolean(config.build.ssr)
    },
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    generateBundle() {
      if (ssr) return
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>
</urlset>
`,
      })
    },
  }
}

// Serve assets from the site's sub-path (e.g. /my-portfolio/ on GitHub Pages) so they don't 404.
const base = new URL(SITE_URL).pathname.replace(/\/?$/, '/')

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), seo()],
})
