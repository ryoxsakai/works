import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  cacheDir:fileURLToPath(new URL('./node_modules/.vite',import.meta.url)),
  root:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'127.0.0.1',port:4173,strictPort:true},
  build:{outDir:'prototype/dist',emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('./index.html',import.meta.url))}},
});
