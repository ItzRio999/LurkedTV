import { defineConfig } from 'vite'

// Vite config — used only for the dev server (npm run dev).
// The production build is handled by scripts/build.cjs (npm run build).
export default defineConfig({
  // Treat public/ as the web root so all existing asset paths (/css, /js, /img) work unchanged.
  root: 'public',
  publicDir: false,

  server: {
    port: 5173,
    // Proxy all /api/* requests to the Express backend running on port 3000.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
