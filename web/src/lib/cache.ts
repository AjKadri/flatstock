// Small stale-while-revalidate cache for chain data so switching tabs or reloading shows data at once
// while a background refresh runs. BigInts are stored as {"__b": "123"}. Storage is best effort.
const memory = new Map<string, unknown>();
const PREFIX = "flatstock-cache-v1:";

export function cacheGet<T>(key: string): T | null {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const value = JSON.parse(raw, (_k, v) => (v && typeof v === "object" && "__b" in v ? BigInt(v.__b) : v)) as T;
    memory.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T) {
  memory.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { __b: v.toString() } : v)));
  } catch { /* storage unavailable or full: the memory copy still works */ }
}
