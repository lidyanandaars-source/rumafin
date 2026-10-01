import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'RumaFin AI',
        short_name: 'RumaFin',
        description: 'Pencatatan dan analisis keuangan rumah tangga dengan bantuan AI.',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: []
      }
    })
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: { port: 5173 },
  build: { sourcemap: true }
})
