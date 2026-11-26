const FALLBACK_PATCH = '16.1.1';

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

export function getChampionIconUrl(championKey: string, patch = cachedPatch): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${championKey}.png`;
}

export function getItemIconUrl(itemId: number, patch = cachedPatch): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${itemId}.png`;
}
