// The CLI against a real HTTP server running the handler on a memory store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHandler } from '../src/server/handler.js';
import { memoryStore } from '../src/server/stores/memory.js';

const run = promisify(execFile);
const SEEDS = [{ id: 'meta-home', page: '/', kind: 'meta', title: 'Review the Home search description' }];

async function serve() {
  const handle = createHandler({ store: memoryStore(), reviewerPasscode: 'rev', adminPasscode: 'adm' });
  const server = createServer(async (req, res) => {
    if (req.url === '/review/seed.json') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(SEEDS));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
  });
  await new Promise((ok) => server.listen(0, ok));
  return { server, url: `http://localhost:${server.address().port}` };
}

const cli = (url, pass, ...args) =>
  run(process.execPath, ['bin/review-layer.js', ...args], { env: { ...process.env, REVIEW_URL: url, REVIEW_PASSCODE: pass, REVIEW_ADMIN_PASSCODE: '' } });

test('list, comment, close and reopen through the CLI', async () => {
  const { server, url } = await serve();
  try {
    assert.match((await cli(url, 'rev', 'list')).stdout, /\[ \] meta-home {2}\/ {2}Review the Home search description/);
    await cli(url, 'rev', 'comment', 'meta-home', 'Looks good to me.');
    assert.match((await cli(url, 'rev', 'show', 'meta-home')).stdout, /Claude, .*:\nLooks good to me\./);
    await assert.rejects(cli(url, 'rev', 'close', 'meta-home'), /403/);
    await cli(url, 'adm', 'close', 'meta-home');
    assert.match((await cli(url, 'rev', 'list', '--done')).stdout, /\[x\] meta-home/);
    assert.equal((await cli(url, 'rev', 'list', '--open')).stdout.trim(), 'No items.');
    await cli(url, 'adm', 'reopen', 'meta-home');
    const json = JSON.parse((await cli(url, 'rev', 'list', '--json')).stdout);
    assert.equal(json[0].status, 'open');
    assert.equal(json[0].comments.length, 1);
  } finally {
    server.close();
  }
});
