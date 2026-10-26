import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage } from 'node:http'

const DEBUG_USER_ID_QUERY_PARAM = 'pyromind-debug-user-id'
const DEBUG_USER_NAME_QUERY_PARAM = 'pyromind-debug-user-name'
const DEBUG_USER_ID_HEADER = 'X-Pyromind-Debug-User-Id'
const DEBUG_USER_NAME_HEADER = 'X-Pyromind-Debug-User-Name'

function getWebSocketCluster(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '', 'ws://localhost')
  return url.searchParams.get('x-cluster')?.trim() || undefined
}

function getWebSocketDebugUserHeaders(req: IncomingMessage): Record<string, string> {
  const url = new URL(req.url ?? '', 'ws://localhost')
  const userId = url.searchParams.get(DEBUG_USER_ID_QUERY_PARAM)?.trim()
  if (!userId) {
    return {}
  }

  return {
    [DEBUG_USER_ID_HEADER]: userId,
    [DEBUG_USER_NAME_HEADER]:
      url.searchParams.get(DEBUG_USER_NAME_QUERY_PARAM)?.trim() || `debug-user-${userId}`,
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        configure(proxy) {
          proxy.on('proxyRes', (upstream, _req, res) => {
            if (upstream.headers['content-type']?.includes('text/event-stream')) {
              upstream.on('aborted', () => res.destroy())
            }
          })
        },
      },
      '/sockets': {
        target: 'ws://localhost:8000',
        ws: true,
        configure(proxy) {
          proxy.on('proxyReqWs', (proxyReq, req) => {
            const cluster = getWebSocketCluster(req)
            if (cluster) {
              proxyReq.setHeader('x-cluster', cluster)
            }
            for (const [name, value] of Object.entries(getWebSocketDebugUserHeaders(req))) {
              proxyReq.setHeader(name, value)
            }
          })
        },
      },
    },
  },
})
