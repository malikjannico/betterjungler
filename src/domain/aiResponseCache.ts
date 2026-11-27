import type { AiProvider } from '../types/coaching';

export type AiCacheKind = 'post_game' | 'win_con';

export interface CachedAiResponseEntry {
  text: string;
  verified: boolean;
  cachedAt: string;
}

const STORAGE_KEY = 'betterjungler.ai_cache.v1';
const MAX_CACHE_ENTRIES = 30;

function makeCacheKey(
  kind: AiCacheKind,
  targetId: string,
  provider: AiProvider,
  model: string
): string {
  return `${kind}::${targetId}::${provider}::${model.trim()}`;
}

function readCacheMap(): Record<string, CachedAiResponseEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, CachedAiResponseEntry>;
  } catch {
    return {};
  }
}

function writeCacheMap(map: Record<string, CachedAiResponseEntry>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota or restricted storage environments
  }
}

export function getCachedAiResponse(
  kind: AiCacheKind,
  targetId: string,
  provider: AiProvider,
  model: string
): CachedAiResponseEntry | null {
  if (provider === 'off' || !targetId.trim()) return null;
  const map = readCacheMap();
  const entry = map[makeCacheKey(kind, targetId, provider, model)];
  if (!entry || typeof entry.text !== 'string' || entry.verified !== true) {
    return null;
  }
  return entry;
}

export function setCachedAiResponse(
  kind: AiCacheKind,
  targetId: string,
  provider: AiProvider,
  model: string,
  entry: { text: string; verified: boolean; cachedAt?: string }
): void {
  if (provider === 'off' || !targetId.trim() || !entry.verified || !entry.text.trim()) {
    return;
  }
  const map = readCacheMap();
  const key = makeCacheKey(kind, targetId, provider, model);
  map[key] = {
    text: entry.text,
    verified: true,
    cachedAt: entry.cachedAt ?? new Date().toISOString(),
  };

  const keys = Object.keys(map);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys.sort((a, b) =>
      String(map[a]?.cachedAt ?? '').localeCompare(String(map[b]?.cachedAt ?? ''))
    );
    const excess = keys.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
      const k = keys[i];
      if (k) delete map[k];
    }
  }
  writeCacheMap(map);
}

export function hashAiContext(contextJson: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < contextJson.length; i++) {
    hash ^= contextJson.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function clearAiResponseCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
