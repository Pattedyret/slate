/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/slate/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Slate',
        short_name: 'Slate',
        background_color: '#15171c',
        theme_color: '#15171c',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  // Vitest runs only unit tests (*.test.ts). The Playwright e2e specs (tests/e2e/*.spec.ts)
  // are excluded so `npx vitest run` in CI never tries to load @playwright/test.
  test: { environment: 'jsdom', globals: true, include: ['tests/**/*.test.ts'] },
})
