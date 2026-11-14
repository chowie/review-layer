// Combine a site's seed items (from its seed.json) with what reviewers stored,
// into one to-do list. Used by the to-do list page and the CLI.

/**
 * @param {{ seeds?: object[], items?: object[], comments?: object[], statuses?: object[] }} data
 * @returns {object[]} each item with `status`, `comments` and `orphan` (a seed
 *   that has comments or a status but the site no longer lists).
 */
export function mergeItems({ seeds = [], items = [], comments = [], statuses = [] }) {
  const byItem = new Map();
  for (const c of comments) {
    if (!byItem.has(c.itemId)) byItem.set(c.itemId, []);
    byItem.get(c.itemId).push(c);
  }
  for (const list of byItem.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const statusOf = new Map(statuses.map((s) => [s.id, s]));

  const all = new Map();
  for (const s of seeds) all.set(s.id, { ...s, source: 'seed' });
  for (const i of items) all.set(i.id, { ...i, source: 'reviewer' });

  const known = new Set(all.keys());
  for (const id of new Set([...byItem.keys(), ...statusOf.keys()])) {
    if (!known.has(id)) all.set(id, { id, source: 'seed', orphan: true, title: id, page: null, kind: 'page', anchor: null });
  }

  return [...all.values()].map((item) => {
    const st = statusOf.get(item.id);
    return {
      ...item,
      status: st?.status ?? 'open',
      ...(st?.anchorLost !== undefined && { anchorLost: st.anchorLost }),
      comments: byItem.get(item.id) ?? [],
      orphan: Boolean(item.orphan),
    };
  });
}
