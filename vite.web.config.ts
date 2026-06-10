import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Browser-only dev server for previewing the renderer UI WITHOUT launching Electron.
// The real app still builds via electron.vite.config.ts; this is a dev convenience only.
// It strips the production CSP <meta> so Vite's dev/HMR inline scripts run in a plain
// browser. window.electron / window.api are absent here, so renderer code that uses them
// must feature-detect (e.g. `if (window.electron) ...`).
//
// Paths are anchored to this file's directory (__dirname) so it works no matter what the
// caller's cwd is (the preview tooling launches it from elsewhere).
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Relative base so the same build works at any subpath (e.g. nrs2013.github.io/decor-studio/).
  base: './',
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true },
  resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
  plugins: [
    react(),
    {
      name: 'decor-strip-csp-dev',
      transformIndexHtml(html: string): string {
        return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
      }
    }
  ],
  server: { port: 5174, strictPort: true }
})
