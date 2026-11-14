// In-memory store: for tests and local development. Same interface as the
// Netlify Blobs store: get(key) -> object|null, set(key, object), list(prefix) -> keys.
export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  return {
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async list(prefix) {
      return [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    /** Test helper: the raw map. */
    _data: data,
  };
}
