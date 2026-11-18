import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Fills the CSP placeholders in index.html: dev needs inline scripts and websockets for Vite HMR,
// the production build gets the strict policy.
function cspPlugin(): Plugin {
  return {
    name: 'reader-csp',
    transformIndexHtml(html, ctx) {
      const dev = Boolean(ctx.server)
      return html
        .replaceAll('__SCRIPT_SRC__', dev ? "'self' 'unsafe-inline'" : "'self'")
        .replaceAll('__CONNECT_SRC__', dev ? "'self' ws://localhost:* http://localhost:*" : "'self'")
    }
  }
}

// Dependencies of the main process (better-sqlite3, epub2) are kept external and shipped in node_modules;
// everything the renderer needs (React, epub.js, zustand) is bundled by Vite.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), cspPlugin()]
  }
})
