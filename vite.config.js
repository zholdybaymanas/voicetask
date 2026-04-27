import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.svg'],
      manifest: {
        name: 'VoiceTask',
        short_name: 'VoiceTask',
        description: 'Голосовой таск-менеджер для команды',
        theme_color: '#2D5BE3',
        background_color: '#2D5BE3',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ru',
        start_url: '/',
        icons: [
          { src: '/icons/icon-72x72.svg',   sizes: '72x72',   type: 'image/svg+xml' },
          { src: '/icons/icon-96x96.svg',   sizes: '96x96',   type: 'image/svg+xml' },
          { src: '/icons/icon-128x128.svg', sizes: '128x128', type: 'image/svg+xml' },
          { src: '/icons/icon-144x144.svg', sizes: '144x144', type: 'image/svg+xml' },
          { src: '/icons/icon-152x152.svg', sizes: '152x152', type: 'image/svg+xml' },
          { src: '/icons/icon-192x192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icons/icon-384x384.svg', sizes: '384x384', type: 'image/svg+xml' },
          { src: '/icons/icon-512x512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Новая задача голосом',
            short_name: 'Голос',
            url: '/?action=voice',
            icons: [{ src: '/icons/icon-96x96.svg', sizes: '96x96' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-framer':   ['framer-motion'],
        },
      },
    },
  },
})
