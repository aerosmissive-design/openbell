/** Per-instance app_meta read cache. Empty string is a hit; a miss is undefined. */
export const META_READ_TTL_MS = 45_000;

let nowFn = () => Date.now();

export function metaNow() {
  return nowFn();
}

export function setMetaClockForTests(fn: (() => number) | null) {
  nowFn = fn ?? (() => Date.now());
}

export function createMetaReadCache(ttlMs = META_READ_TTL_MS) {
  const rows = new Map<string, { value: string; at: number }>();
  return {
    get(key: string, now = metaNow()): string | undefined {
      const row = rows.get(key);
      if (!row) return undefined;
      if (now - row.at >= ttlMs) {
        rows.delete(key);
        return undefined;
      }
      return row.value;
    },
    set(key: string, value: string, now = metaNow()) {
      rows.set(key, { value, at: now });
    },
    clear() {
      rows.clear();
    },
  };
}
