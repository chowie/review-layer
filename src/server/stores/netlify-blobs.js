// Netlify Blobs store. Inside a Netlify Function the Blobs context is
// provided automatically; elsewhere pass { siteID, token } in options.
import { getStore } from '@netlify/blobs';

/**
 * @param {string} [name] store name, shared by every deploy of the site
 * @param {object} [options] extra getStore options (siteID, token)
 */
export function netlifyBlobsStore(name = 'review-layer', options = {}) {
  const store = getStore({ name, consistency: 'strong', ...options });
  return {
    async get(key) {
      return (await store.get(key, { type: 'json' })) ?? null;
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
  };
}
