import { hydrateDdragonCatalog } from '../data/jungleKnowledgePack';
import type {
  DdragonChampionLite,
  DdragonHydratedCatalog,
  DdragonItemLite,
} from '../types/coaching';

const FALLBACK_PATCH = '16.23.1';
const CATALOG_STORAGE_KEY = 'betterjungler_ddragon_catalog';

let cachedPatch = FALLBACK_PATCH;

export async function fetchLatestPatchVersion(): Promise<string> {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (!res.ok) return cachedPatch;
    const versions = (await res.json()) as string[];
    if (Array.isArray(versions) && versions[0]) {
      cachedPatch = versions[0];
    }
    return cachedPatch;
  } catch {
    return cachedPatch;
  }
}

export function getProfileIconUrl(profileIconId?: number, patch = cachedPatch): string | null {
  if (!profileIconId || profileIconId <= 0) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/profileicon/${profileIconId}.png`;
}

export function getChampionIconUrl(championKey: string, patch = cachedPatch): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${championKey}.png`;
}

export function getItemIconUrl(itemId: number, patch = cachedPatch): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${itemId}.png`;
}

export function getOfficialMapUrl(patch = cachedPatch): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/map/map11.png`;
}

export function loadCachedDdragonCatalog(): DdragonHydratedCatalog | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DdragonHydratedCatalog;
    if (parsed && parsed.patch && parsed.championsById && parsed.itemsById) {
      cachedPatch = parsed.patch;
      hydrateDdragonCatalog(parsed);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

interface RawDdragonChampionJson {
  data: Record<
    string,
    {
      key: string;
      id: string;
      name: string;
      tags?: string[];
    }
  >;
}

interface RawDdragonItemJson {
  data: Record<
    string,
    {
      name: string;
      gold?: { total?: number };
    }
  >;
}

export async function syncFullDdragonCatalog(
  preferredPatch?: string
): Promise<DdragonHydratedCatalog> {
  const existing = loadCachedDdragonCatalog();
  try {
    const patch = preferredPatch ?? (await fetchLatestPatchVersion());
    const [champRes, itemRes] = await Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`),
    ]);

    if (!champRes.ok || !itemRes.ok) {
      throw new Error('DDragon JSON fetch failed');
    }

    const champJson = (await champRes.json()) as RawDdragonChampionJson;
    const itemJson = (await itemRes.json()) as RawDdragonItemJson;

    const championsById: Record<number, DdragonChampionLite> = {};
    for (const champ of Object.values(champJson.data ?? {})) {
      const id = Number(champ.key);
      if (Number.isFinite(id) && id > 0) {
        championsById[id] = {
          id,
          key: champ.id,
          name: champ.name,
          tags: champ.tags ?? [],
        };
      }
    }

    const itemsById: Record<number, DdragonItemLite> = {};
    for (const [idStr, item] of Object.entries(itemJson.data ?? {})) {
      const id = Number(idStr);
      if (Number.isFinite(id) && id > 0) {
        itemsById[id] = {
          id,
          name: item.name,
          cost: item.gold?.total ?? 0,
        };
      }
    }

    const catalog: DdragonHydratedCatalog = { patch, championsById, itemsById };
    cachedPatch = patch;
    hydrateDdragonCatalog(catalog);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
    }
    return catalog;
  } catch {
    if (existing) return existing;
    return {
      patch: cachedPatch,
      championsById: {},
      itemsById: {},
    };
  }
}
