import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./production/',import.meta.url)),
  base:'/app/',publicDir:false,
  build:{target:'es2022',outDir:fileURLToPath(new URL('../app/',import.meta.url)),emptyOutDir:true},
});
