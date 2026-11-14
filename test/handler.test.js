import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/server/handler.js';
import { memoryStore } from '../src/server/stores/memory.js';

const REV = 'reviewer-pass';
const ADMIN = 'admin-pass';

function setup(opts = {}) {
  const store = memoryStore();
  let t = Date.parse('2026-11-14T12:00:00Z');
  const handle = createHandler({ store, reviewerPasscode: REV, adminPasscode: ADMIN, now: () => new Date(t++), ...opts });
  const call = (method, path, { pass = REV, body } = {}) =>
    handle(
      new Request(`https://site.test/api/review${path}`, {
        method,
        headers: { ...(pass && { authorization: `Bearer ${pass}` }), ...(body && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  return { store, call };
}

const newItem = { page: '/about/', kind: 'section', anchor: { v: 1, section: 'who-we-are' }, body: 'Typo in the second line.', author: 'Martha' };

test('turned off or missing a passcode: everything is 404', async () => {
  for (const opts of [{ enabled: false }, { reviewerPasscode: undefined }]) {
    const { call } = setup(opts);
    assert.equal((await call('GET', '/session')).status, 404);
  }
});

test('no passcode or a wrong one: 401', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/session', { pass: null })).status, 401);
  assert.equal((await call('GET', '/session', { pass: 'nope' })).status, 401);
});

test('session reports the role', async () => {
  const { call } = setup();
  assert.deepEqual(await (await call('GET', '/session')).json(), { role: 'reviewer' });
  assert.deepEqual(await (await call('GET', '/session', { pass: ADMIN })).json(), { role: 'admin' });
});

test('a reviewer creates an item with its first comment, and lists it', async () => {
  const { call } = setup();
  const res = await call('POST', '/items', { body: newItem });
  assert.equal(res.status, 201);
  const { item, comment } = await res.json();
  assert.match(item.id, /^r_/);
  assert.equal(item.source, 'reviewer');
  assert.equal(item.title, 'Typo in the second line.');
  assert.equal(comment.itemId, item.id);
  assert.equal(comment.role, 'reviewer');

  const list = await (await call('GET', '/items')).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.comments.length, 1);
  const filtered = await (await call('GET', '/items?page=/give/')).json();
  assert.equal(filtered.items.length, 0);
});

test('replies to a seed id are allowed, and two replies at once both survive', async () => {
  const { call } = setup();
  const reply = (author) => call('POST', '/items/meta-home/comments', { body: { author, body: `From ${author}` } });
  const results = await Promise.all([reply('Ann'), reply('Bob')]);
  assert.deepEqual(results.map((r) => r.status), [201, 201]);
  const { comments } = await (await call('GET', '/items')).json();
  assert.deepEqual(comments.map((c) => c.author).sort(), ['Ann', 'Bob']);
});

test('only the admin can change status', async () => {
  const { call } = setup();
  assert.equal((await call('PATCH', '/items/meta-home', { body: { status: 'done' } })).status, 403);
  const res = await call('PATCH', '/items/meta-home', { pass: ADMIN, body: { status: 'done', author: 'Chris' } });
  assert.equal(res.status, 200);
  const { statuses } = await (await call('GET', '/items')).json();
  assert.deepEqual(statuses.map((s) => [s.id, s.status, s.by]), [['meta-home', 'done', 'Chris']]);
});

test('bad input is a 400 with a reason', async () => {
  const { call } = setup();
  const cases = [
    { ...newItem, page: 'about' },
    { ...newItem, page: '//evil.test/' },
    { ...newItem, kind: 'nonsense' },
    { ...newItem, body: '' },
    { ...newItem, body: 'x'.repeat(2001) },
    { ...newItem, anchor: { blob: 'x'.repeat(5000) } },
  ];
  for (const body of cases) {
    const res = await call('POST', '/items', { body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.ok((await res.json()).error);
  }
  assert.equal((await call('POST', '/items', { body: '{not json' })).status, 400);
  assert.equal((await call('POST', '/items/bad%20id/comments', { body: { author: 'A', body: 'b' } })).status, 400);
});

test('unknown routes are 404', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('DELETE', '/items/x')).status, 404);
});
