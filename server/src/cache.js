import { createHash } from 'node:crypto';
import { config } from './config.js';

// Caching plan (Rule 6: browsing lab equipment is the most frequent read).
//
//  1. Cache-aside in the API: GET /api/equipment and GET /api/equipment/:id are
//     served from memory; the database is only hit on a MISS.
//  2. Write-invalidate: any change to equipment or to units left (book, cancel,
//     complete, quantity edit, delete) clears the "equipment:" keys at once,
//     so a cached list is never stale. A TTL is a safety net.
//  3. HTTP revalidation: responses carry an ETag; the browser sends
//     If-None-Match and gets 304 Not Modified (no body) when nothing changed.
//  4. Nginx caches the built static files (JS/CSS) for a year (hashed names).

const store = new Map();
const stats = { hits: 0, misses: 0, invalidations: 0 };

export const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  },

  set(key, body) {
    const json = JSON.stringify(body);
    const entry = {
      json,
      etag: `"${createHash('sha1').update(json).digest('base64url')}"`,
      expiresAt: Date.now() + config.cacheTtlSeconds * 1000,
    };
    store.set(key, entry);
    return entry;
  },

  invalidate(prefix) {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
    stats.invalidations++;
  },

  clear() {
    store.clear();
  },

  stats() {
    return { ...stats, keys: [...store.keys()], ttlSeconds: config.cacheTtlSeconds };
  },
};

export const invalidateEquipmentCache = () => cache.invalidate('equipment:');

// Serve a cached JSON response (loading it on a miss), with ETag / 304 support.
export async function sendCached(req, res, key, loader) {
  let entry = cache.get(key);
  if (entry) {
    stats.hits++;
    res.set('X-Cache', 'HIT');
  } else {
    stats.misses++;
    entry = cache.set(key, await loader());
    res.set('X-Cache', 'MISS');
  }

  res.set('ETag', entry.etag);
  res.set('Cache-Control', 'private, no-cache');

  if (req.headers['if-none-match'] === entry.etag) {
    return res.status(304).end();
  }
  res.type('application/json').send(entry.json);
}
