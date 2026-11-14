// Pure string logic for anchoring comments to page content. No DOM here, so
// it runs in tests, the CLI and the browser alike.
//
// Anchor (v1), captured when a comment is made:
//   { v: 1, section?, selector?, tag?, quote?: { exact, prefix, suffix }, text?, img?: { src, alt }, meta? }
// Resolving prefers, in order: the selector (if its text still matches), the
// exact quote, a fuzzy match, the section, then the page.

/** Collapse whitespace and fold typographic quotes and dashes. */
export function normalize(s = '') {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (s) => normalize(s).toLowerCase().match(/[a-z0-9']+/g) ?? [];

/** Word-overlap similarity (Dice coefficient on word multisets), 0..1. */
export function similarity(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const counts = new Map();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const n = counts.get(w);
    if (n) {
      shared++;
      counts.set(w, n - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/** Context kept on each side of a quote. */
export const CONTEXT = 32;

/** Build a quote from `text` with the selection at [start, end). */
export function makeQuote(text, start, end) {
  const t = String(text);
  return {
    exact: normalize(t.slice(start, end)),
    prefix: normalize(t.slice(Math.max(0, start - CONTEXT), start)),
    suffix: normalize(t.slice(end, end + CONTEXT)),
  };
}

/**
 * Find a quote in `haystack` (normalized text). Returns the index of the best
 * occurrence, using prefix/suffix to choose among repeats, or -1.
 */
export function findQuote(haystack, quote) {
  const hay = normalize(haystack);
  const exact = normalize(quote?.exact);
  if (!exact) return -1;
  const hits = [];
  for (let i = hay.indexOf(exact); i !== -1; i = hay.indexOf(exact, i + 1)) hits.push(i);
  if (hits.length <= 1) return hits[0] ?? -1;
  const pre = normalize(quote.prefix);
  const suf = normalize(quote.suffix);
  const score = (i) => {
    const before = hay.slice(Math.max(0, i - pre.length - 1), i);
    const after = hay.slice(i + exact.length, i + exact.length + suf.length + 1);
    return (pre && before.trimEnd().endsWith(pre.trimEnd()) ? 1 : 0) + (suf && after.trimStart().startsWith(suf.trimStart()) ? 1 : 0);
  };
  return hits.reduce((best, i) => (score(i) > score(best) ? i : best), hits[0]);
}

/** Thresholds for deciding an anchor still points at the right thing. */
export const MATCH = { selector: 0.8, fuzzy: 0.6 };

/**
 * Pick the best candidate block for an anchor by text alone.
 * @param {{ quote?: {exact: string}, text?: string }} anchor
 * @param {string[]} candidates block texts, in page order
 * @returns {{ index: number, how: 'exact'|'fuzzy' } | null}
 */
export function bestBlock(anchor, candidates) {
  const target = anchor?.quote?.exact || anchor?.text;
  if (!target) return null;
  const exact = candidates.findIndex((c) => normalize(c).includes(normalize(target)));
  if (exact !== -1) return { index: exact, how: 'exact' };
  let best = -1;
  let bestScore = 0;
  candidates.forEach((c, i) => {
    const s = similarity(target, c);
    if (s > bestScore) [best, bestScore] = [i, s];
  });
  return bestScore >= MATCH.fuzzy ? { index: best, how: 'fuzzy' } : null;
}

/**
 * The stable part of an image URL: the file name without a build hash or
 * extension. "/_astro/church-sign.Ab12_cD.webp" -> "church-sign".
 */
export function imageKey(src = '') {
  const file = String(src).split(/[?#]/)[0].split('/').pop() ?? '';
  return file.replace(/\.[a-z0-9]+$/i, '').replace(/\.[A-Za-z0-9_-]{6,}$/, '');
}
