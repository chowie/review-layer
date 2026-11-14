import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeItems } from '../src/merge.js';
import { normalize, similarity, makeQuote, findQuote, bestBlock, imageKey } from '../src/anchor.js';
import { seed, ValidationError } from '../src/model.js';

test('merge: seeds and reviewer items get status and comments; unknown ids become orphans', () => {
  const merged = mergeItems({
    seeds: [{ id: 'meta-home', page: '/', kind: 'meta', title: 'Home description' }],
    items: [{ id: 'r_1', page: '/about/', kind: 'text', title: 'Typo' }],
    comments: [
      { itemId: 'meta-home', body: 'second', createdAt: '2026-11-14T02:00:00Z' },
      { itemId: 'meta-home', body: 'first', createdAt: '2026-11-14T01:00:00Z' },
      { itemId: 'needs:old', body: 'still here', createdAt: '2026-11-14T01:00:00Z' },
    ],
    statuses: [{ id: 'r_1', status: 'done', anchorLost: true }],
  });
  const by = Object.fromEntries(merged.map((i) => [i.id, i]));
  assert.deepEqual(by['meta-home'].comments.map((c) => c.body), ['first', 'second']);
  assert.equal(by['meta-home'].status, 'open');
  assert.equal(by['r_1'].status, 'done');
  assert.equal(by['r_1'].anchorLost, true);
  assert.equal(by['needs:old'].orphan, true);
  assert.equal(by['meta-home'].orphan, false);
});

test('seed validation', () => {
  assert.equal(seed({ id: 'meta-home', page: '/', kind: 'meta', title: 'x' }).source, 'seed');
  assert.throws(() => seed({ id: 'has space', page: '/', kind: 'meta', title: 'x' }), ValidationError);
  assert.throws(() => seed({ id: 'a', page: 'nope', kind: 'meta', title: 'x' }), ValidationError);
});

test('normalize folds whitespace, quotes and dashes', () => {
  assert.equal(normalize('  We’re   here — “now”\n'), 'We\'re here - "now"');
});

test('similarity is 1 for the same words and drops as text changes', () => {
  assert.equal(similarity('Sunday worship at 10:30', 'sunday WORSHIP at 10:30'), 1);
  assert.ok(similarity('Sunday worship is at 10:30 a.m.', 'Sunday worship is at 11 a.m.') > 0.6);
  assert.ok(similarity('Sunday worship', 'Pickleball night') < 0.2);
});

test('findQuote uses prefix and suffix to pick among repeats', () => {
  const text = 'Come as you are. We meet Sundays. Come as you are, and bring a friend.';
  const second = text.lastIndexOf('Come as you are');
  const q = makeQuote(text, second, second + 'Come as you are'.length);
  assert.equal(q.exact, 'Come as you are');
  assert.equal(findQuote(text, q), second);
  assert.equal(findQuote(text, { exact: 'not there' }), -1);
});

test('bestBlock: exact, then fuzzy above the threshold, else null', () => {
  const blocks = ['Our story began in 1848.', 'Sunday worship is at 10:30 a.m. in the sanctuary.', 'Give online.'];
  assert.deepEqual(bestBlock({ quote: { exact: 'worship is at 10:30' } }, blocks), { index: 1, how: 'exact' });
  assert.deepEqual(bestBlock({ text: 'Sunday worship is at 11:00 a.m. in the sanctuary.' }, blocks), { index: 1, how: 'fuzzy' });
  assert.equal(bestBlock({ text: 'Pickleball on Mondays' }, blocks), null);
});

test('imageKey drops the build hash and extension', () => {
  assert.equal(imageKey('/_astro/aaron-lonsway.Cw2n_1Jx_ZUBDyP.webp'), 'aaron-lonsway');
  assert.equal(imageKey('/images/photo_2024.jpg?w=400'), 'photo_2024');
  assert.equal(imageKey('church.png'), 'church');
});
