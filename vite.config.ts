import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',   // force plain localhost IPv4 only
    open: false,
    cors: true,
    proxy: {
      // Only the reliable Magic Eden proxy (Tensor domains have caused DNS/CORS hangs before)
      '/me-api': {
        target: 'https://api-mainnet.magiceden.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/me-api/, ''),
      },
    },
    hmr: {
      host: 'localhost',
      port: 5173,
    },
  },
  logLevel: 'info',
  build: {
    outDir: 'dist-binder',
  },
})
