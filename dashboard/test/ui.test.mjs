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
test('ToDo isolated CSS uses official controls without adding a second dialog or persistence controller',async()=>{
 const css=await load('shared/ui/todo-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.todo-bootstrap'),selector);});
 const presentation=await load('shared/ui/todo-presentation.mjs');
 assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(presentation));
 assert.ok(!css.includes('@view-transition'));
});
test('KDP isolates official CSS and preserves its own data, upload and native dialog controllers',async()=>{
 const css=await load('shared/ui/kdp-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.kdp-bootstrap'),selector);});
 const source=await load('shared/ui/kdp-presentation.mjs');
 assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));
 assert.ok(source.includes(':not([type="file"])'));
 assert.ok(!css.includes('@view-transition'));
});
test('Wiki CSS is isolated and presentation explicitly excludes readonly Markdown content',async()=>{
 const css=await load('shared/ui/wiki-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.wiki-bootstrap'),selector);});
 const source=await load('shared/ui/wiki-presentation.mjs');
 assert.ok(source.includes("el.closest('#body,#editor-preview,.wiki-markdown')"));
 assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));
 assert.ok(!css.includes('@view-transition'));
});

test('Memo CSS is scoped and utility-hidden/private overlays keep their original controller',async()=>{
 const css=await load('shared/ui/memo-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.memo-bootstrap'),selector);});
 const source=await load('shared/ui/memo-presentation.mjs');
 assert.ok(source.includes("el.closest('#view-body-container,#modal-tags-list')"));
 assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));
 assert.match(await load('shared/ui/memo-tokens.css'),/\.hidden.*display: none !important/);
 assert.match(await load('memo/index.html'),/Segoe UI/);
});

test('Admission CSS and projector leave calendar, filters, native dialog and printing in the original owner',async()=>{
 const css=await load('shared/ui/admission-bootstrap.css');
 postcss.parse(css).walkRules(rule=>{for(const selector of rule.selectors)assert.ok(selector.startsWith('.admission-bootstrap'),selector);});
 const source=await load('shared/ui/admission-presentation.mjs');
 assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));
 assert.ok(!css.includes('@view-transition'));
});

test('Material CSS and SVG projection preserve native file, preview, drag and persistence owners',async()=>{
 const css=await load('shared/ui/material-bootstrap.css');postcss.parse(css).walkRules(r=>{for(const s of r.selectors)assert.ok(s.startsWith('.material-bootstrap'),s);});
 const source=await load('shared/ui/material-presentation.mjs');assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));assert.ok(source.includes('#material-preview-body'));assert.ok(source.includes(':not([type="file"])'));
});

test('Workflow projection leaves run cards, native dialogs, authorization and state owners unchanged',async()=>{
 const css=await load('shared/ui/workflow-bootstrap.css');postcss.parse(css).walkRules(r=>{for(const s of r.selectors)assert.ok(s.startsWith('.workflow-bootstrap'),s);});
 const source=await load('shared/ui/workflow-presentation.mjs');assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));assert.ok(source.includes("el.matches('.wf-run')"));
});

test('Tutor scoped UI keeps record autosizing and native attribution/save/print owners',async()=>{
 const css=await load('shared/ui/tutor-bootstrap.css');postcss.parse(css).walkRules(r=>{for(const s of r.selectors)assert.ok(s.startsWith('.tutor-bootstrap'),s);});
 const source=await load('shared/ui/tutor-presentation.mjs');assert.ok(!/fetch\(|localStorage|showModal\(|\.value\s*=|\.disabled\s*=/.test(source));assert.ok(source.includes('.record-student-link,.schedule-day-btn,.schedule-event'));
 assert.match(await load('shared/ui/tutor-tokens.css'),/white-space: normal/);
 assert.ok(!css.includes('@view-transition'));
});

test('Material SVG keeps decorative layout/state classes without retaining icon-font identities',async()=>{
 const source=await load('shared/ui/material-presentation.mjs');assert.ok(source.includes("svg.classList.add(name)"));assert.ok(source.includes("classList.contains('bx-spin')"));
 const css=await load('shared/ui/material-tokens.css');assert.ok(css.includes('prefers-reduced-motion: no-preference'));assert.ok(css.includes('reduce), print'));assert.ok(css.includes('works-material-spin'));
});
