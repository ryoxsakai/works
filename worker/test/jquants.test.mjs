import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const f = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport { handleMcp, createMcpAccessToken };').toString('base64')}`);
const env = { ALLOWED_EMAIL: 'owner@example.com', SESSION_SECRET: 'test-session', JQUANTS_API_KEY: 'test-key-never-echo' };
const token = await f.createMcpAccessToken(env, 'schedule:read');
async function call(name, args, auth = true, runtime = env) {
  const url = new URL('https://works.lrnr.jp/mcp');
  const response = await f.handleMcp(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), runtime, url);
  return { status: response.status, body: await response.json() };
}
const args = { code: '7203', start_date: '2026-09-01', end_date: '2026-09-10' };
const row = (date, close, adj = close) => ({ Code: '72030', Date: date, C: close, AdjC: adj, Vo: 123 });

test('J-Quants MCP authentication, paging, values, and failure boundaries', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-09-18T03:00:00Z'));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch'); };
  assert.equal((await call('get_stock_price_history', args, false)).status, 401);
  assert.equal(calls, 0);
  const missing = await call('get_stock_price_history', args, true, { ...env, JQUANTS_API_KEY: undefined });
  assert.equal(missing.body.result.isError, true);
  assert.match(missing.body.result.content[0].text, /JQUANTS_API_KEY/);
  for (const input of [{ ...args, start_date: '2026-02-30' }, { ...args, code: '../secret' }, { ...args, end_date: '2099-01-01' }, { ...args, api_key: 'injected' }]) {
    assert.equal((await call('get_stock_price_history', input)).body.result.isError, true);
  }
  assert.equal(calls, 0);
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.headers['x-api-key'], env.JQUANTS_API_KEY);
    assert.equal(options.redirect, 'error');
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.jquants.com');
    assert.equal(parsed.searchParams.get('code'), '7203');
    return Response.json(parsed.searchParams.has('pagination_key') ? { data: [row('2026-09-01', 2000, 1000)] } : { data: [row('2026-09-02', null)], pagination_key: 'a+b&c' });
  };
  const history = (await call('works_get_stock_price_history', args)).body.result.structuredContent;
  assert.equal(calls, 2);
  assert.deepEqual(history.data.map(r => r.date), ['2026-09-01', '2026-09-02']);
  assert.equal(history.data[0].close, 2000);
  assert.equal(history.data[0].adjusted_close, 1000);
  assert.equal(history.data[1].close, null);
  assert.ok(!JSON.stringify(history).includes(env.JQUANTS_API_KEY));
  globalThis.fetch = async () => Response.json({ data: [row('2026-09-03', null), row('2026-09-02', 1234)] });
  const latest = (await call('get_latest_stock_price', { code: '7203' })).body.result.structuredContent;
  assert.equal(latest.data.date, '2026-09-02');
  assert.equal(latest.latest_record_date, '2026-09-03');
  globalThis.fetch = async () => Response.json({ data: [] });
  assert.equal((await call('get_latest_stock_price', { code: '7203' })).body.result.structuredContent.data, null);
  globalThis.fetch = async () => Response.json({ data: [{ ...row('2026-09-02', 3), Code: '67580' }] });
  assert.equal((await call('get_stock_price_history', args)).body.result.isError, true);
  globalThis.fetch = async () => Response.json({ data: [], pagination_key: 'loop' });
  assert.equal((await call('get_stock_price_history', args)).body.result.isError, true);
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => new Response(env.JQUANTS_API_KEY, { status });
    const failure = (await call('get_stock_price_history', args)).body.result;
    assert.equal(failure.isError, true);
    assert.ok(!JSON.stringify(failure).includes(env.JQUANTS_API_KEY));
  }
  globalThis.fetch = async () => { throw new Error(env.JQUANTS_API_KEY); };
  assert.ok(!JSON.stringify(await call('get_stock_price_history', args)).includes(env.JQUANTS_API_KEY));
  globalThis.fetch = async () => Response.json({ data: [{ Code: '72030', CoName: 'トヨタ自動車', CoNameEn: 'TOYOTA MOTOR', MktNm: 'プライム', Date: '2026-09-18' }] });
  const search = (await call('search_stock_symbols', { query: 'ｔｏｙｏｔａ' })).body.result.structuredContent;
  assert.equal(search.data[0].code, '72030');
  const listed = await f.handleMcp(new Request('https://works.lrnr.jp/mcp', { method: 'POST', body: JSON.stringify({ id: 2, method: 'tools/list' }) }), env, new URL('https://works.lrnr.jp/mcp'));
  const names = (await listed.json()).result.tools.map(tool => tool.name);
  assert.ok(names.includes('get_schedule'));
  assert.ok(names.includes('get_latest_stock_price'));
});
