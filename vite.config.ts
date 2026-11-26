import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        configure(proxy) {
          proxy.on('proxyRes', (upstream, _req, res) => {
            if (upstream.headers['content-type']?.includes('text/event-stream')) {
              upstream.on('aborted', () => res.destroy())
            }
          })
        },
      },
    },
  },
})
