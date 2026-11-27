import type { LiveActivePlayer } from '../types/riot';

export type SkillKey = 'Q' | 'W' | 'E' | 'R';
export type BasicSkillKey = 'Q' | 'W' | 'E';

export interface ChampionSkillSpec {
  firstThree: [BasicSkillKey, BasicSkillKey, BasicSkillKey];
  maxOrder: [BasicSkillKey, BasicSkillKey, BasicSkillKey];
}

export interface SkillOrderAdvice {
  championName: string;
  nextSkill: SkillKey | null;
  unspentPoints: number;
  currentLevels: Record<SkillKey, number>;
  maxOrderLabel: string;
  priorityList: SkillKey[];
  promptLabel: string;
}

const DEFAULT_SPEC: ChampionSkillSpec = {
  firstThree: ['Q', 'W', 'E'],
  maxOrder: ['Q', 'E', 'W'],
};

const norm = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Verified Season 2026 skill priorities covering all Jungle & ADC champions in the packs.
 */
const SKILL_SPEC_MAP: Record<string, ChampionSkillSpec> = {
  // ---- Junglers ----
  viego: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  leesin: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  jarvaniv: { firstThree: ['E', 'Q', 'W'], maxOrder: ['Q', 'E', 'W'] },
  nocturne: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  amumu: { firstThree: ['W', 'E', 'Q'], maxOrder: ['E', 'Q', 'W'] },
  diana: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  lillia: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  vi: { firstThree: ['W', 'E', 'Q'], maxOrder: ['Q', 'E', 'W'] },
  xinzhao: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'W', 'E'] },
  khazix: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  kayn: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'W', 'E'] },
  graves: { firstThree: ['E', 'Q', 'W'], maxOrder: ['Q', 'E', 'W'] },
  kindred: { firstThree: ['W', 'Q', 'E'], maxOrder: ['Q', 'W', 'E'] },
  sejuani: { firstThree: ['E', 'W', 'Q'], maxOrder: ['W', 'E', 'Q'] },
  maokai: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  volibear: { firstThree: ['E', 'W', 'Q'], maxOrder: ['W', 'Q', 'E'] },
  evelynn: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  hecarim: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  elise: { firstThree: ['W', 'Q', 'E'], maxOrder: ['Q', 'W', 'E'] },
  wukong: { firstThree: ['E', 'Q', 'W'], maxOrder: ['Q', 'E', 'W'] },
  skarner: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  karthus: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  udyr: { firstThree: ['Q', 'R', 'W'] as unknown as [BasicSkillKey, BasicSkillKey, BasicSkillKey], maxOrder: ['Q', 'E', 'W'] },
  shyvana: { firstThree: ['E', 'Q', 'W'], maxOrder: ['E', 'Q', 'W'] },
  briar: { firstThree: ['W', 'Q', 'E'], maxOrder: ['W', 'Q', 'E'] },
  masteryi: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  warwick: { firstThree: ['Q', 'W', 'E'], maxOrder: ['W', 'Q', 'E'] },
  ekko: { firstThree: ['W', 'Q', 'E'], maxOrder: ['Q', 'E', 'W'] },
  zac: { firstThree: ['W', 'Q', 'E'], maxOrder: ['E', 'W', 'Q'] },
  nunuwillump: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  nunu: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  shaco: { firstThree: ['W', 'Q', 'E'], maxOrder: ['E', 'Q', 'W'] },
  fiddlesticks: { firstThree: ['W', 'E', 'Q'], maxOrder: ['W', 'Q', 'E'] },
  rammus: { firstThree: ['W', 'Q', 'E'], maxOrder: ['Q', 'E', 'W'] },
  belveth: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  reksai: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  poppy: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  taliyah: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  brand: { firstThree: ['E', 'Q', 'W'], maxOrder: ['W', 'E', 'Q'] },
  zyra: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },

  // ---- ADCs ----
  jinx: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  kaisa: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'E', 'W'] },
  caitlyn: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  ezreal: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  jhin: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  ashe: { firstThree: ['W', 'Q', 'E'], maxOrder: ['W', 'Q', 'E'] },
  missfortune: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  lucian: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  vayne: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  draven: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  xayah: { firstThree: ['Q', 'E', 'W'], maxOrder: ['E', 'Q', 'W'] },
  tristana: { firstThree: ['E', 'W', 'Q'], maxOrder: ['E', 'Q', 'W'] },
  sivir: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  varus: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'W', 'E'] },
  aphelios: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  zeri: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  samira: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  kogmaw: { firstThree: ['W', 'Q', 'E'], maxOrder: ['W', 'Q', 'E'] },
  twitch: { firstThree: ['E', 'Q', 'W'], maxOrder: ['E', 'Q', 'W'] },
  smolder: { firstThree: ['Q', 'W', 'E'], maxOrder: ['Q', 'W', 'E'] },
  corki: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
  yunara: { firstThree: ['Q', 'E', 'W'], maxOrder: ['Q', 'E', 'W'] },
};

export function resolveChampionSkillSpec(championName: string): ChampionSkillSpec {
  const key = norm(championName);
  const spec = SKILL_SPEC_MAP[key];
  if (!spec) return DEFAULT_SPEC;
  // Normalize Udyr's R -> E safe fallback for standard 4-ability R tracking
  const cleanFirstThree = spec.firstThree.map((k) => (k === 'Q' || k === 'W' || k === 'E' ? k : 'E')) as [
    BasicSkillKey,
    BasicSkillKey,
    BasicSkillKey,
  ];
  return {
    firstThree: cleanFirstThree,
    maxOrder: spec.maxOrder,
  };
}

function canLevelUltimate(champLevel: number, rLevel: number): boolean {
  if (rLevel >= 3) return false;
  if (champLevel >= 16) return rLevel < 3;
  if (champLevel >= 11) return rLevel < 2;
  if (champLevel >= 6) return rLevel < 1;
  return false;
}

function canLevelBasic(champLevel: number, abilityLevel: number): boolean {
  if (abilityLevel >= 5) return false;
  const rankCap = Math.min(5, Math.max(1, Math.ceil(champLevel / 2)));
  return abilityLevel < rankCap;
}

/**
 * Determines which ability to skill next from Live Client `activePlayer.level`
 * and `activePlayer.abilities.{Q,W,E,R}.abilityLevel`.
 */
export function computeSkillOrderAdvice(
  championName: string,
  level: number,
  abilities?: LiveActivePlayer['abilities']
): SkillOrderAdvice {
  const safeLevel = Math.max(1, Math.min(18, Math.floor(level || 1)));
  const currentLevels: Record<SkillKey, number> = {
    Q: Math.max(0, Math.min(5, Math.floor(abilities?.Q?.abilityLevel ?? 0))),
    W: Math.max(0, Math.min(5, Math.floor(abilities?.W?.abilityLevel ?? 0))),
    E: Math.max(0, Math.min(5, Math.floor(abilities?.E?.abilityLevel ?? 0))),
    R: Math.max(0, Math.min(3, Math.floor(abilities?.R?.abilityLevel ?? 0))),
  };
  const spentPoints = currentLevels.Q + currentLevels.W + currentLevels.E + currentLevels.R;
  const unspentPoints = Math.max(0, safeLevel - spentPoints);
  const effectiveTargetLevel = Math.min(18, Math.max(safeLevel, spentPoints + 1));

  const spec = resolveChampionSkillSpec(championName);
  const priorityList: SkillKey[] = ['R', ...spec.maxOrder];
  const maxOrderLabel = `R > ${spec.maxOrder.join(' > ')}`;

  let nextSkill: SkillKey | null = null;

  if (spentPoints < 18) {
    if (canLevelUltimate(effectiveTargetLevel, currentLevels.R)) {
      nextSkill = 'R';
    } else if (spentPoints < 3) {
      // Ranks 1..3: unlock all three basic abilities in verified clear/lane order first
      for (const basic of spec.firstThree) {
        if (currentLevels[basic] === 0 && canLevelBasic(effectiveTargetLevel, currentLevels[basic])) {
          nextSkill = basic;
          break;
        }
      }
    }

    if (!nextSkill) {
      for (const basic of spec.maxOrder) {
        if (canLevelBasic(effectiveTargetLevel, currentLevels[basic])) {
          nextSkill = basic;
          break;
        }
      }
    }
  }

  const promptLabel = !nextSkill
    ? 'MAXED'
    : unspentPoints > 0
      ? `LEVEL ${nextSkill} NOW`
      : `NEXT: ${nextSkill}`;

  return {
    championName,
    nextSkill,
    unspentPoints,
    currentLevels,
    maxOrderLabel,
    priorityList,
    promptLabel,
  };
}
