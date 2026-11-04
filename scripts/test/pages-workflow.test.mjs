import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('PR validation uses separate concurrency groups from production deployment',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/pages-safe.yml',import.meta.url),'utf8');
  const group=workflow.match(/^  group: \$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(group,'workflow must declare an explicit concurrency expression');
  const expression=group.match(/^github\.event_name == 'pull_request' && format\('([^']*\{0\}[^']*)', github\.event\.pull_request\.number\) \|\| '([^']+)'$/);
  assert.ok(expression,'group must distinguish PR validation from every non-PR run');
  const [,prTemplate,deployment]=expression;
  const prOne=prTemplate.replace('{0}','1'),prTwo=prTemplate.replace('{0}','2');
  assert.notEqual(prOne,prTwo,'different PRs must not replace each other');
  assert.notEqual(prOne.toLowerCase(),deployment.toLowerCase(),'PR validation must not replace a deployment');
  assert.notEqual(prTwo.toLowerCase(),deployment.toLowerCase(),'PR validation must not replace a deployment');
  const [prefix,suffix]=prTemplate.toLowerCase().split('{0}'),production=deployment.toLowerCase();
  const middle=production.startsWith(prefix)&&production.endsWith(suffix)?production.slice(prefix.length,suffix? -suffix.length:undefined):'';
  assert.doesNotMatch(middle,/^\d+$/,'no numeric PR may share the deployment group');
  assert.match(workflow,/^  cancel-in-progress: false$/m);
});
