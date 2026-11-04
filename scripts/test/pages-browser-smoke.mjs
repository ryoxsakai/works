// Local only: compare static entry points with a fresh browser and no live APIs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium} from '../../worker/node_modules/@playwright/test/index.mjs';

const [source,stage]=process.argv.slice(2).map(path=>resolve(path));
if(!source||!stage||process.argv.length!==4)throw Error('Supply the source and staged site directories.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
async function serve(root){
  const server=createServer(async(req,res)=>{try{let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);return res.end();}let info=await stat(file);if(info.isDirectory()){file=resolve(file,'index.html');info=await stat(file);}if(!info.isFile())throw Error();res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,origin:`http://127.0.0.1:${server.address().port}`};
}
const paths=['/','/app/','/tutor/','/admission/','/kdp/','/material/','/material-print/','/memo/','/ss/','/todo/','/wiki/','/workflow/'];
const hosts=await Promise.all([serve(source),serve(stage)]),browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
  const results=[];
  for(const {origin} of hosts){
    const context=await browser.newContext({viewport:{width:390,height:844}}),missing=new Set();
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,json:{error:'synthetic'}});return route.continue();});
    for(const path of paths){const page=await context.newPage();page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&response.status()===404&&!url.pathname.startsWith('/api/')&&url.pathname!=='/favicon.ico')missing.add(url.pathname);});const response=await page.goto(origin+path,{waitUntil:'domcontentloaded'});assert.equal(response?.status(),200,'local entry point failed');await page.waitForTimeout(500);await page.close();}
    results.push([...missing].sort());await context.close();
  }
  assert.equal(results[1].filter(path=>!results[0].includes(path)).length,0,'staging introduced a missing same-origin request');
  console.log(`Local browser checked ${paths.length} entry points; baseline missing requests: ${results[0].length}; additional staged missing requests: 0.`);
}finally{await browser.close();await Promise.all(hosts.map(({server})=>new Promise(resolve=>server.close(resolve))));}
