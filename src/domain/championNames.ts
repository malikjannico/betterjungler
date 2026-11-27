import {
  CHAMPION_META_TABLE,
  JUNGLE_CHAMPIONS,
  getHydratedDdragonCatalog,
} from '../data/jungleKnowledgePack';

const INTERNAL_CHAMPION_NAME_MAP: Record<string, string> = {
  aurelionsol: 'Aurelion Sol',
  belveth: "Bel'Veth",
  chogath: "Cho'Gath",
  drmundo: 'Dr. Mundo',
  fiddlesticks: 'Fiddlesticks',
  jarvaniv: 'Jarvan IV',
  jarvan4: 'Jarvan IV',
  kaisa: "Kai'Sa",
  khazix: "Kha'Zix",
  kogmaw: "Kog'Maw",
  ksante: "K'Sante",
  leblanc: 'LeBlanc',
  leesin: 'Lee Sin',
  masteryi: 'Master Yi',
  missfortune: 'Miss Fortune',
  monkeyking: 'Wukong',
  nunu: 'Nunu & Willump',
  nunuwillump: 'Nunu & Willump',
  reksai: "Rek'Sai",
  renata: 'Renata Glasc',
  renataglasc: 'Renata Glasc',
  tahmkench: 'Tahm Kench',
  twistedfate: 'Twisted Fate',
  velkoz: "Vel'Koz",
  wukong: 'Wukong',
  xinzhao: 'Xin Zhao',
};

function normalizeLookupKey(raw: string): string {
  return raw
    .replace(/^game_character_displayname_/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves internal Riot/Data Dragon champion IDs or keys (e.g. `MonkeyKing`, `LeeSin`, `Khazix`)
 * into canonical player-facing champion names (`Wukong`, `Lee Sin`, `Kha'Zix`).
 */
export function formatChampionName(
  rawName: string | null | undefined,
  championId?: number
): string {
  const ddragon = getHydratedDdragonCatalog();

  if (typeof championId === 'number' && championId > 0) {
    const ddById = ddragon?.championsById[championId];
    if (ddById?.name) return ddById.name;
    const jgById = JUNGLE_CHAMPIONS.find((c) => c.championId === championId);
    if (jgById?.name) return jgById.name;
    const metaById = CHAMPION_META_TABLE[championId];
    if (metaById?.name) return metaById.name;
  }

  const trimmed = (rawName ?? '').trim();
  if (!trimmed) return 'Unknown';

  const lookup = normalizeLookupKey(trimmed);
  if (!lookup) return trimmed;

  const known = INTERNAL_CHAMPION_NAME_MAP[lookup];
  if (known) return known;

  const jgByName = JUNGLE_CHAMPIONS.find(
    (c) => normalizeLookupKey(c.key) === lookup || normalizeLookupKey(c.name) === lookup
  );
  if (jgByName) return jgByName.name;

  for (const meta of Object.values(CHAMPION_META_TABLE)) {
    if (normalizeLookupKey(meta.key) === lookup || normalizeLookupKey(meta.name) === lookup) {
      return meta.name;
    }
  }

  if (ddragon) {
    for (const dd of Object.values(ddragon.championsById)) {
      if (normalizeLookupKey(dd.key) === lookup || normalizeLookupKey(dd.name) === lookup) {
        return dd.name;
      }
    }
  }

  // Fallback for multi-word PascalCase Riot IDs when offline (e.g. "TwistedFate" -> "Twisted Fate")
  const cleaned = trimmed.replace(/^game_character_displayname_/i, '');
  if (!cleaned.includes(' ') && /[a-z][A-Z]/.test(cleaned)) {
    return cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  return cleaned;
}
