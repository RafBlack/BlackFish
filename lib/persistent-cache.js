export class PersistentCache {
  constructor({ entries = [], save = async () => {}, now = Date.now, maxBytes = 3 * 1024 * 1024, maxEntries = 5000 } = {}) {
    this.entries = new Map(); this.save = save; this.now = now; this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.writes = Promise.resolve();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry && typeof entry.key === 'string' && entry.key.length <= 200 && Number.isSafeInteger(entry.expiresAt) && Number.isSafeInteger(entry.usedAt) && ['threat','advice','config','cooldown'].includes(entry.kind) && entry.value && typeof entry.value === 'object') this.entries.set(entry.key, entry);
    }
    this.prune();
  }
  sizeOf() { return new TextEncoder().encode(JSON.stringify([...this.entries.values()])).length; }
  prune() {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(key);
    const oldest = [...this.entries.values()].sort((a,b) => a.usedAt - b.usedAt || a.key.localeCompare(b.key));
    const sizes = new Map(oldest.map(entry => [entry.key, new TextEncoder().encode(JSON.stringify(entry)).length]));
    let size = 2 + [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) + Math.max(0, this.entries.size - 1);
    while (this.entries.size > this.maxEntries || size > this.maxBytes) {
      const entry = oldest.shift(); if (!entry) break;
      size -= sizes.get(entry.key) + (this.entries.size > 1 ? 1 : 0); this.entries.delete(entry.key);
    }
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) { this.entries.delete(key); return null; }
    entry.usedAt = this.now(); return structuredClone(entry.value);
  }
  expiry(key) { return this.entries.get(key)?.expiresAt || 0; }
  async put(key, kind, value, expiresAt) {
    if (typeof key !== 'string' || key.length > 200 || !['threat','advice','config','cooldown'].includes(kind) || !Number.isSafeInteger(expiresAt)) throw new Error('Invalid cache entry.');
    const entry = { key, kind, value: structuredClone(value), expiresAt, usedAt: this.now() };
    if (new TextEncoder().encode(JSON.stringify(entry)).length + 2 > this.maxBytes) return;
    this.entries.set(key, entry);
    this.prune(); await this.persist();
  }
  async clear(kind) {
    for (const [key, entry] of this.entries) if (!kind || entry.kind === kind) this.entries.delete(key);
    await this.persist();
  }
  async persist() {
    const entries = structuredClone([...this.entries.values()]);
    const next = this.writes.then(() => this.save(entries));
    this.writes = next.catch(() => {}); await next;
  }
  stats() { this.prune(); return { entries: this.entries.size, bytes: this.sizeOf(), maxBytes: this.maxBytes, maxEntries: this.maxEntries }; }
}
