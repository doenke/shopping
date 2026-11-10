import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.BACKEND_URL ?? 'http://localhost:3000';

export default defineConfig({
  // x.yy.zzz from CI (scripts/version.mjs), "dev" for local builds.
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev') },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      manifest: {
        name: 'Shopping',
        short_name: 'Shopping',
        description: 'Gemeinsame Einkaufslisten – offline und in Echtzeit',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f5f2',
        theme_color: '#2f7d4f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Right click on the taskbar icon / long press on the app icon.
        shortcuts: [
          { name: 'Arbeitsmodus', short_name: 'Arbeit', url: '/?mode=work', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Einkaufslisten', short_name: 'Einkauf', url: '/?mode=home', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
          { name: 'Standort in der Hauptliste merken', short_name: 'Standort merken', url: '/?action=here', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
        ],
        // Links, text and files (photos, PDFs, …); the service worker takes the POST (see sw.ts).
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            text: 'share_text',
            title: 'share_title',
            url: 'share_url',
            files: [{ name: 'share_files', accept: ['image/*', 'video/*', 'audio/*', 'text/*', 'application/*', '*/*'] }],
          },
        },
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
