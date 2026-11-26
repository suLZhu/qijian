import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.AI_HOME_DEV_API || 'http://127.0.0.1:4180'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.trycloudflare.com', 'attendance-lamps-ist-unavailable.trycloudflare.com', 'rhythm-repeated-start-prices.trycloudflare.com'],
    // Keep the original Host header: the backend's same-origin CSRF check compares
    // Origin against Host, and changeOrigin:true rewrites Host to 127.0.0.1:4180,
    // which made every proxied POST/PUT/DELETE fail with 403 跨站请求已拒绝.
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    allowedHosts: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
})
