import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        galaxy: resolve(import.meta.dirname, 'galaxy.html'),
        localgroup: resolve(import.meta.dirname, 'localgroup.html'),
      },
    },
  },
  worker: { format: 'es' },
});
