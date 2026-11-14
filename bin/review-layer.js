#!/usr/bin/env node
// review-layer CLI: read and act on a site's review to-do list.
//
//   review-layer list [--open|--done] [--page /x/] [--json]
//   review-layer show <id>
//   review-layer comment <id> "text"
//   review-layer close <id>     (admin passcode)
//   review-layer reopen <id>    (admin passcode)
//
// Environment:
//   REVIEW_URL        site origin, e.g. https://ogc-website.netlify.app
//   REVIEW_PASSCODE   reviewer passcode, or REVIEW_ADMIN_PASSCODE for close/reopen
//   REVIEW_API        API path (default /api/review)
//   REVIEW_SEEDS      seed list path (default /review/seed.json; "none" to skip)
//   REVIEW_AUTHOR     name on comments (default "Claude")
import { mergeItems } from '../src/merge.js';

const env = process.env;
const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--page'));

function die(msg) {
  console.error(`review-layer: ${msg}`);
  process.exit(1);
}

const origin = env.REVIEW_URL?.replace(/\/$/, '');
const passcode = env.REVIEW_ADMIN_PASSCODE || env.REVIEW_PASSCODE;
const api = (env.REVIEW_API || '/api/review').replace(/\/$/, '');
const author = env.REVIEW_AUTHOR || 'Claude';

async function call(method, path, body) {
  const res = await fetch(origin + api + path, {
    method,
    headers: { authorization: `Bearer ${passcode}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) die(`${method} ${path}: ${res.status} ${data.error ?? res.statusText}`);
  return data;
}

async function seeds() {
  const path = env.REVIEW_SEEDS || '/review/seed.json';
  if (path === 'none') return [];
  const res = await fetch(origin + path);
  if (!res.ok) return [];
  return res.json();
}

async function everything() {
  const [stored, seedList] = await Promise.all([call('GET', '/items'), seeds()]);
  return mergeItems({ seeds: seedList, ...stored });
}

const line = (i) =>
  `${i.status === 'done' ? '[x]' : '[ ]'} ${i.id}  ${i.page ?? '(gone)'}  ${i.title}` +
  `${i.comments.length ? `  (${i.comments.length} comment${i.comments.length > 1 ? 's' : ''})` : ''}` +
  `${i.anchorLost ? '  [anchor lost]' : ''}${i.orphan ? '  [no longer flagged]' : ''}`;

const usage = `usage: review-layer <list|show|comment|close|reopen> …  (see the header of bin/review-layer.js)`;

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(usage);
  process.exit(0);
}
if (!origin) die('set REVIEW_URL (the site origin)');
if (!passcode) die('set REVIEW_PASSCODE or REVIEW_ADMIN_PASSCODE');

switch (cmd) {
  case 'list': {
    let items = await everything();
    if (flag('--open')) items = items.filter((i) => i.status === 'open');
    if (flag('--done')) items = items.filter((i) => i.status === 'done');
    const page = option('--page');
    if (page) items = items.filter((i) => i.page === page);
    if (flag('--json')) console.log(JSON.stringify(items, null, 2));
    else console.log(items.map(line).join('\n') || 'No items.');
    break;
  }
  case 'show': {
    const id = positional[0] ?? die('show needs an id');
    const item = (await everything()).find((i) => i.id === id) ?? die(`no item ${id}`);
    console.log(line(item));
    if (item.detail) console.log(`\n${item.detail}`);
    for (const c of item.comments) console.log(`\n${c.author}${c.role === 'admin' ? ' (admin)' : ''}, ${c.createdAt}:\n${c.body}`);
    break;
  }
  case 'comment': {
    const [id, text] = positional;
    if (!id || !text) die('comment needs an id and the text');
    await call('POST', `/items/${encodeURIComponent(id)}/comments`, { author, body: text });
    console.log(`Commented on ${id}.`);
    break;
  }
  case 'close':
  case 'reopen': {
    const id = positional[0] ?? die(`${cmd} needs an id`);
    await call('PATCH', `/items/${encodeURIComponent(id)}`, { status: cmd === 'close' ? 'done' : 'open', author });
    console.log(`${cmd === 'close' ? 'Closed' : 'Reopened'} ${id}.`);
    break;
  }
  default:
    die(`unknown command "${cmd}"\n${usage}`);
}
