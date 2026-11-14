// Shapes and validation shared by the server, the CLI and the client.
//
// Item     { id, source: 'seed'|'reviewer', page, kind, title, anchor, author, createdAt, group? }
// Comment  { id, itemId, author, role: 'reviewer'|'admin', body, createdAt }
// Status   { id, status: 'open'|'done', by, at, anchorLost? }

export const KINDS = /** @type {const} */ (['page', 'section', 'heading', 'text', 'image', 'button', 'element', 'meta']);
export const STATUSES = /** @type {const} */ (['open', 'done']);

export const LIMITS = { page: 300, title: 200, body: 2000, author: 80, anchor: 4000, id: 120 };

/** Ids: seed ids are chosen by the site (`needs:about:…`), reviewer ids are `r_…`. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_#./-]*$/;

export class ValidationError extends Error {}

const fail = (msg) => {
  throw new ValidationError(msg);
};

/** A trimmed, non-empty string no longer than `max`, without angle brackets. */
export function text(value, field, max, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    fail(`${field} is required`);
  }
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const s = value.trim();
  if (!s && !optional) fail(`${field} is required`);
  if (s.length > max) fail(`${field} is longer than ${max} characters`);
  return s || undefined;
}

export function id(value, field = 'id') {
  const s = text(value, field, LIMITS.id);
  if (!ID_PATTERN.test(s)) fail(`${field} has characters that aren't allowed`);
  return s;
}

export function page(value) {
  const s = text(value, 'page', LIMITS.page);
  if (!s.startsWith('/') || s.startsWith('//')) fail('page must be a path starting with /');
  return s;
}

export function kind(value) {
  if (!KINDS.includes(value)) fail(`kind must be one of ${KINDS.join(', ')}`);
  return value;
}

export function status(value) {
  if (!STATUSES.includes(value)) fail(`status must be one of ${STATUSES.join(', ')}`);
  return value;
}

/** Anchors are opaque to the server: any JSON object up to LIMITS.anchor characters, or null. */
export function anchor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('anchor must be an object');
  if (JSON.stringify(value).length > LIMITS.anchor) fail(`anchor is larger than ${LIMITS.anchor} characters`);
  return value;
}

/** A seed item as a site publishes it (seed.json). Throws on a bad one. */
export function seed(value) {
  if (!value || typeof value !== 'object') fail('seed must be an object');
  return {
    id: id(value.id),
    source: 'seed',
    page: page(value.page),
    kind: kind(value.kind),
    title: text(value.title, 'title', LIMITS.title),
    detail: text(value.detail, 'detail', LIMITS.body, { optional: true }),
    group: text(value.group, 'group', 40, { optional: true }),
    anchor: anchor(value.anchor),
  };
}

/** Sortable, unique enough for a demo-scale store: time then randomness. */
export function newId(prefix, now = new Date()) {
  return `${prefix}${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
