import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Après le build : injecte dans sw.js la liste de tous les fichiers à précharger (jeu jouable hors ligne dès la 1re visite). */
function precachePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'aif2-precache',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push('./' + relative(outDir, p).split('\\').join('/')); } };
      try { walk(outDir); } catch { return; }
      const list = ['./', ...files.filter((f) => f !== './sw.js')];
      const swPath = join(outDir, 'sw.js');
      try {
        const src = readFileSync(swPath, 'utf8')
          .replace("/*BUILD*/'dev'", JSON.stringify(Date.now().toString(36)))
          .replace("/*PRECACHE*/['./']", JSON.stringify(list));
        writeFileSync(swPath, src);
      } catch { /* pas de sw.js */ }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [precachePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
      '/ideas': { target: 'http://localhost:8787' },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
