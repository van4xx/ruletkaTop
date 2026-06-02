import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite config for the ruletka.top ADMIN SPA (admin.ruletka.top).
 *
 * Standalone React app — separate from the public web (apps/web) — that reuses
 * the shared design system (@ruletka/ui) + contract (@ruletka/shared-types) and
 * talks to the API at `VITE_API_URL` (api.ruletka.top in prod, :4000 in dev).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: { port: 5174, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
});
