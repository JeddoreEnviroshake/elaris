import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Build identity, surfaced in the About/Diagnostics panel and used to detect
 * updates. Falls back gracefully when git is unavailable (fresh clone / CI
 * shallow checkout without history).
 */
function resolveBuildInfo(): { commit: string; builtAt: string } {
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    commit = 'local';
  }
  return { commit, builtAt: new Date().toISOString() };
}

const build = resolveBuildInfo();

export default defineConfig({
  // Stable origin is a root domain (elaris-abb6d.web.app), so base/scope/start_url all agree at '/'.
  base: '/',
  define: {
    __APP_COMMIT__: JSON.stringify(build.commit),
    __APP_BUILT_AT__: JSON.stringify(build.builtAt),
  },
  plugins: [
    VitePWA({
      // Manual registration + prompt flow so we control the "Update ready" UX
      // and never call skipWaiting()/clients.claim() unconditionally.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Elaris',
        short_name: 'Elaris',
        description: 'A top-down creature-taming survival-builder.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Rotation is never forced; both orientations are supported.
        orientation: 'any',
        background_color: '#0f1512',
        theme_color: '#1f6f43',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        cleanupOutdatedCaches: true,
        // Keep the previous build serving old clients until the user consents.
        clientsClaim: false,
        skipWaiting: false,
        navigateFallback: 'index.html',
      },
      devOptions: {
        // Keep the SW out of `vite dev` so HMR isn't fighting a cache.
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    // Vitest config lives here so a single tsconfig covers app + tests.
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    globals: true,
  },
});
