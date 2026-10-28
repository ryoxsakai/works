import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./production/',import.meta.url)),
  base:'/app/',publicDir:false,
  plugins:[{name:'retain-boxicons-license',generateBundle(){this.emitFile({type:'asset',fileName:'licenses/boxicons.txt',source:readFileSync(new URL('./vendor/boxicons/LICENSE',import.meta.url),'utf8')});}}],
  build:{target:'es2022',outDir:fileURLToPath(new URL('../app/',import.meta.url)),emptyOutDir:true},
});
