import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import postcss from '../../shared/ui/node_modules/postcss/lib/postcss.mjs';
import {icon} from '../../shared/ui/icons.mjs';
const load=p=>fs.readFile(new URL('../../'+p,import.meta.url),'utf8');
test('fixed scoped official v6 bundle has no Reboot, global rules, JS, keyframes or remote assets',async()=>{
 const css=await load('shared/ui/menu-bootstrap.css');
 const tree=postcss.parse(css);let rules=0;
 tree.walkRules(rule=>{rules++;for(const selector of rule.selectors)assert.ok(selector.startsWith('.dashboard-home'),selector);});
 assert.ok(rules>100);
 assert.ok(!css.includes('@layer'));
 assert.ok(!css.includes('https://'));
 assert.ok(!css.includes('box-sizing: border-box'));
 for(const name of ['.btn-solid','.card {','.alert {','.nav-link','.check {'])assert.ok(css.includes(name));
 const pkg=JSON.parse(await load('shared/ui/package.json'));
 assert.equal(pkg.devDependencies.bootstrap,'6.0.0-alpha.1');
 const html=await load('index.html');
 assert.ok(!html.includes('boxicons'));
 assert.ok(!html.includes('bootstrap.bundle'));
 assert.ok(!html.includes('data-bs-toggle'));
});
test('SVG allowlist is decorative, named fallback IDs hydrate safely and unknown keys fail closed',()=>{
 assert.match(icon('bx-book-reader'),/aria-hidden="true"/);
 assert.match(icon('bx-book-reader'),/viewBox="0 0 16 16"/);
 assert.throws(()=>icon('<script>'));
 assert.throws(()=>icon('__proto__'));
});
test('SS bundle is isolated; no page transition or save capability introduced',async()=>{
 const css=await load('shared/ui/ss-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.ss-bootstrap'),selector);});
 const source=await load('ss/app.js');
 assert.ok(!source.includes('startViewTransition'));
 assert.ok(!source.includes('method:'));
 assert.ok(!css.includes('@view-transition'));
 assert.match(await load('ss/index.html'),/ss-sort-button btn btn-text/);
});
