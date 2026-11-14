// The review API as one Web-standard handler: (Request) => Promise<Response>.
// Works in Netlify Functions, Deno, Bun, Cloudflare Workers or Node 20+.
//
//   GET   {base}/session                 -> { role }
//   GET   {base}/items[?page=/x/]        -> { items, comments, statuses }
//   POST  {base}/items                   -> create an item and its first comment
//   POST  {base}/items/:id/comments      -> reply (seed ids allowed)
//   PATCH {base}/items/:id               -> { status } (admin only)
//
// Auth: `Authorization: Bearer <passcode>`. The admin passcode works wherever
// the reviewer one does. Store keys: items/<id>, comments/<itemId>/<iso>-<rand>,
// status/<id>. Items and comments are written once, so concurrent reviewers
// can't overwrite each other; only the admin writes status.
import { createHash, timingSafeEqual } from 'node:crypto';
import * as m from '../model.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const digest = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(digest(a), digest(b));

/** 'admin' | 'reviewer' | null for the request's bearer passcode. */
export function roleFor(req, { reviewerPasscode, adminPasscode }) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  if (adminPasscode && same(token, adminPasscode)) return 'admin';
  if (reviewerPasscode && same(token, reviewerPasscode)) return 'reviewer';
  return null;
}

async function readAll(store, prefix) {
  const keys = await store.list(prefix);
  return (await Promise.all(keys.map((k) => store.get(k)))).filter(Boolean);
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    throw new m.ValidationError('the request body must be JSON');
  }
}

/**
 * @param {object} options
 * @param {{get: Function, set: Function, list: Function}} options.store
 * @param {string} [options.reviewerPasscode]
 * @param {string} [options.adminPasscode]
 * @param {boolean} [options.enabled] false makes every route 404 (the go-live kill switch)
 * @param {string} [options.basePath] defaults to '/api/review'
 * @param {() => Date} [options.now]
 */
export function createHandler({ store, reviewerPasscode, adminPasscode, enabled = true, basePath = '/api/review', now = () => new Date() }) {
  const base = basePath.replace(/\/$/, '');

  return async function handle(req) {
    // Off, or not configured: behave as if the API doesn't exist.
    if (!enabled || !reviewerPasscode) return json({ error: 'not found' }, 404);

    const url = new URL(req.url);
    if (!url.pathname.startsWith(base + '/')) return json({ error: 'not found' }, 404);
    const parts = url.pathname.slice(base.length + 1).split('/').filter(Boolean).map(decodeURIComponent);

    const role = roleFor(req, { reviewerPasscode, adminPasscode });
    if (!role) return json({ error: 'wrong or missing passcode' }, 401);

    try {
      const [root, itemId, sub] = parts;

      if (req.method === 'GET' && root === 'session' && parts.length === 1) return json({ role });

      if (root === 'items' && parts.length === 1) {
        if (req.method === 'GET') {
          const pageFilter = url.searchParams.get('page');
          let [items, comments, statuses] = await Promise.all([
            readAll(store, 'items/'),
            readAll(store, 'comments/'),
            readAll(store, 'status/'),
          ]);
          if (pageFilter) items = items.filter((i) => i.page === pageFilter);
          comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return json({ items, comments, statuses });
        }
        if (req.method === 'POST') {
          const b = await body(req);
          const at = now();
          const author = m.text(b.author, 'author', m.LIMITS.author);
          const text = m.text(b.body, 'body', m.LIMITS.body);
          const item = {
            id: m.newId('r_', at),
            source: 'reviewer',
            page: m.page(b.page),
            kind: m.kind(b.kind),
            title: m.text(b.title, 'title', m.LIMITS.title, { optional: true }) ?? text.slice(0, 80),
            anchor: m.anchor(b.anchor),
            author,
            createdAt: at.toISOString(),
          };
          const comment = { id: m.newId('c_', at), itemId: item.id, author, role, body: text, createdAt: item.createdAt };
          await store.set(`items/${item.id}`, item);
          await store.set(`comments/${item.id}/${item.createdAt}-${comment.id}`, comment);
          return json({ item, comment }, 201);
        }
      }

      if (root === 'items' && itemId && sub === 'comments' && parts.length === 3 && req.method === 'POST') {
        const id = m.id(itemId);
        const b = await body(req);
        const at = now();
        const comment = {
          id: m.newId('c_', at),
          itemId: id,
          author: m.text(b.author, 'author', m.LIMITS.author),
          role,
          body: m.text(b.body, 'body', m.LIMITS.body),
          createdAt: at.toISOString(),
        };
        await store.set(`comments/${id}/${comment.createdAt}-${comment.id}`, comment);
        return json({ comment }, 201);
      }

      if (root === 'items' && itemId && parts.length === 2 && req.method === 'PATCH') {
        if (role !== 'admin') return json({ error: 'only the admin can change status' }, 403);
        const id = m.id(itemId);
        const b = await body(req);
        const prev = (await store.get(`status/${id}`)) ?? {};
        const next = {
          id,
          status: b.status === undefined ? prev.status ?? 'open' : m.status(b.status),
          by: m.text(b.author, 'author', m.LIMITS.author, { optional: true }) ?? 'admin',
          at: now().toISOString(),
          ...(typeof b.anchorLost === 'boolean' ? { anchorLost: b.anchorLost } : prev.anchorLost !== undefined && { anchorLost: prev.anchorLost }),
        };
        await store.set(`status/${id}`, next);
        return json({ status: next });
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      if (err instanceof m.ValidationError) return json({ error: err.message }, 400);
      throw err;
    }
  };
}
