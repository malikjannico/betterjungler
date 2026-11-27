import {
  ADC_CHAMPIONS,
  ADC_TANK_SHRED_ITEM_IDS,
  FLEX_ADC_IDS,
  FLEX_SUPPORT_IDS,
  SUPPORT_ARCHETYPES,
  findAdcChampionById,
  getAdcSupportComboNote,
  type AdcArchetype,
  type AdcChampionProfile,
  type SupportArchetype,
} from '../../data/adcKnowledgePack';
// Read-only reuse: the Jungle meta table classifies non-bot allies/enemies and the shrinkage
// helpers are pure. Neither module is modified, so Jungle scoring stays byte-identical.
import { getChampionMeta } from '../../data/jungleKnowledgePack';
import { computePersonalBaselineWinRate, shrinkWinRate } from '../champSelectEngine';
import type { AdcKpiKey } from '../../types/coaching';
import type {
  AdcBotMatchupInsight,
  AdcDraftRecommendation,
  AdcPersonalChampRecord,
  AdcSupportSynergy,
  AdcTeamNeedsAnalysis,
  BotLaneConfidence,
  InferredEnemyBotLane,
  RecommendAdcInput,
} from './types';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const NEUTRAL_SUPPORT_POINTS = 8;
const NEUTRAL_MATCHUP_POINTS = 10;
const BASE_TEAM_NEED_POINTS = 7;

// ---------------------------------------------------------------------------
// Inference (Ranked Solo/Duo anonymity-safe)
// ---------------------------------------------------------------------------

/**
 * Picks the single most plausible bot-laner from visible picks. Flex picks (e.g. Lux, Corki)
 * only win when they are the sole candidate; true ambiguity returns `undefined`.
 */
function pickBotCandidate(
  ids: number[],
  isInPool: (id: number) => boolean,
  flexIds: ReadonlySet<number>
): number | undefined {
  const candidates = ids.filter((id) => id > 0 && isInPool(id));
  const dedicated = candidates.filter((id) => !flexIds.has(id));
  if (dedicated.length === 1) return dedicated[0];
  if (dedicated.length === 0 && candidates.length === 1) return candidates[0];
  return undefined;
}

function championName(id: number): string {
  return findAdcChampionById(id)?.name ?? SUPPORT_ARCHETYPES[id]?.name ?? getChampionMeta(id).name;
}

export function inferAllySupportId(allyChampionIds: number[]): number | undefined {
  return pickBotCandidate(allyChampionIds, (id) => id in SUPPORT_ARCHETYPES, FLEX_SUPPORT_IDS);
}

/**
 * Infers the enemy bot duo. Riot hides enemy positions in Ranked Solo/Duo champ select, so any
 * inferred duo — and any duo while `isRankedSoloDuo` is true — is labelled `likely`.
 */
export function inferEnemyBotLane(
  enemyChampionIds: number[],
  options: {
    explicit?: { adcId?: number; supportId?: number };
    isRankedSoloDuo?: boolean;
  } = {}
): InferredEnemyBotLane | null {
  const isRankedSoloDuo = options.isRankedSoloDuo ?? true;
  const explicit = options.explicit;
  const hasExplicit = Boolean(explicit && ((explicit.adcId ?? 0) > 0 || (explicit.supportId ?? 0) > 0));

  const adcId =
    explicit?.adcId && explicit.adcId > 0
      ? explicit.adcId
      : pickBotCandidate(enemyChampionIds, (id) => findAdcChampionById(id) !== undefined, FLEX_ADC_IDS);
  const supportId =
    explicit?.supportId && explicit.supportId > 0
      ? explicit.supportId
      : pickBotCandidate(enemyChampionIds, (id) => id in SUPPORT_ARCHETYPES, FLEX_SUPPORT_IDS);

  if (!adcId && !supportId) return null;

  const confidence: BotLaneConfidence = hasExplicit && !isRankedSoloDuo ? 'confirmed' : 'likely';
  const adcName = adcId ? championName(adcId) : undefined;
  const supportName = supportId ? championName(supportId) : undefined;
  const prefix = confidence === 'likely' ? 'Likely enemy bot lane' : 'Enemy bot lane';

  return {
    adcId,
    adcName,
    supportId,
    supportName,
    supportArchetype: supportId ? SUPPORT_ARCHETYPES[supportId]?.archetype : undefined,
    confidence,
    label: `${prefix}: ${adcName ?? 'Unknown ADC'} + ${supportName ?? 'Unknown support'}`,
  };
}

// ---------------------------------------------------------------------------
// Team needs (self-contained; independent of winConditionEngine / champSelectEngine)
// ---------------------------------------------------------------------------

const PEEL_SUPPORT_IDS: ReadonlySet<number> = new Set([201, 412, 223]);

interface ChampTraits {
  ad: number;
  ap: number;
  frontline: boolean;
  peel: boolean;
  dive: boolean;
}

function classifyChampion(id: number): ChampTraits | null {
  const adc = findAdcChampionById(id);
  if (adc) {
    return {
      ad: 1,
      ap: adc.damageProfile === 'hybrid' ? 1 : 0,
      frontline: false,
      peel: false,
      dive: false,
    };
  }

  const support = SUPPORT_ARCHETYPES[id];
  if (support) {
    return {
      ad: support.damageProfile === 'ad' ? 1 : 0,
      ap: support.damageProfile === 'ap' ? 1 : 0,
      frontline: support.damageProfile === 'tank' && support.archetype === 'engage',
      peel: support.archetype === 'enchanter' || PEEL_SUPPORT_IDS.has(id),
      dive: support.archetype === 'engage' || support.archetype === 'catcher',
    };
  }

  const meta = getChampionMeta(id);
  // Unknown champions fall back to a generic placeholder; skip them rather than guess.
  if (meta.name.startsWith('Champion #')) return null;
  return {
    ad: meta.damageProfile === 'ad' || meta.damageProfile === 'hybrid' ? 1 : 0,
    ap: meta.damageProfile === 'ap' || meta.damageProfile === 'hybrid' ? 1 : 0,
    frontline: meta.frontlineScore >= 7,
    peel: false,
    dive: meta.championClass === 'assassin' || meta.engageScore >= 8,
  };
}

export function analyzeAdcTeamNeeds(
  allyChampionIds: number[],
  enemyChampionIds: number[]
): AdcTeamNeedsAnalysis {
  const allies = allyChampionIds
    .filter((id) => id > 0)
    .map(classifyChampion)
    .filter((t): t is ChampTraits => t !== null);
  const enemies = enemyChampionIds
    .filter((id) => id > 0)
    .map(classifyChampion)
    .filter((t): t is ChampTraits => t !== null);

  const adThreats = allies.reduce((sum, t) => sum + t.ad, 0);
  const apThreats = allies.reduce((sum, t) => sum + t.ap, 0);
  const frontlineCount = allies.filter((t) => t.frontline).length;
  const peelCount = allies.filter((t) => t.peel).length;
  const enemyFrontlineCount = enemies.filter((t) => t.frontline).length;
  const enemyDiveCount = enemies.filter((t) => t.dive).length;

  const gaps: string[] = [];
  if (allies.length >= 2 && adThreats === 0) gaps.push('Needs primary AD threat');
  if (allies.length >= 2 && apThreats === 0) gaps.push('Full AD risk — no magic damage yet');
  if (allies.length >= 2 && frontlineCount === 0) gaps.push('No frontline to protect the carry');
  if (allies.length >= 2 && peelCount === 0) gaps.push('No dedicated peel');

  return {
    adThreats,
    apThreats,
    frontlineCount,
    peelCount,
    enemyFrontlineCount,
    enemyDiveCount,
    gaps,
  };
}

function scoreTeamNeeds(
  adc: AdcChampionProfile,
  needs: AdcTeamNeedsAnalysis,
  allyCount: number,
  reasons: string[],
  warnings: string[]
): number {
  let points = BASE_TEAM_NEED_POINTS;

  if (allyCount >= 2 && needs.adThreats === 0 && needs.apThreats >= 2) {
    points += adc.damageProfile === 'ad' ? 5 : 3;
    reasons.push('Supplies the primary AD threat for an AP-heavy draft');
  } else if (needs.adThreats >= 3 && needs.apThreats === 0) {
    if (adc.damageProfile === 'hybrid') {
      points += 4;
      reasons.push('Hybrid damage softens a full-AD draft');
    } else {
      points -= 2;
      warnings.push('Adds more AD to an already full-AD draft');
    }
  }

  const isScalingCarry = adc.archetype === 'hypercarry' || adc.scalingProfile === 'late';
  if (needs.frontlineCount >= 1 && isScalingCarry) {
    points += 3;
    reasons.push('Ally frontline buys time for late-game scaling');
  } else if (allyCount >= 2 && needs.frontlineCount === 0 && adc.rangeTier === 'short') {
    points -= 3;
    warnings.push('Short range with no ally frontline to fight behind');
  }

  if (needs.peelCount >= 1 && adc.archetype === 'hypercarry') {
    points += 2;
    reasons.push('Ally peel protects an immobile hypercarry');
  }

  if (needs.enemyFrontlineCount >= 2 && adc.coreItemIds.some((id) => ADC_TANK_SHRED_ITEM_IDS.has(id))) {
    points += 3;
    reasons.push('Core build shreds the tanky enemy frontline');
  }

  if (needs.enemyDiveCount >= 2 && needs.peelCount === 0 && adc.archetype === 'hypercarry') {
    points -= 3;
    warnings.push('Heavy enemy dive and no peel for a hypercarry');
  }

  return clamp(points, 0, 15);
}

// ---------------------------------------------------------------------------
// Support synergy
// ---------------------------------------------------------------------------

const AFFINITY_POINTS = [13, 9, 7] as const;
const UNPREFERRED_AFFINITY_POINTS = 3;
const EXPLICIT_COMBO_POINTS = 7;

export function computeSupportSynergy(
  adc: AdcChampionProfile,
  supportId: number
): AdcSupportSynergy | null {
  const support = SUPPORT_ARCHETYPES[supportId];
  if (!support) return null;

  const affinityRank = adc.preferredSupports.indexOf(support.archetype);
  const affinityPoints =
    affinityRank < 0
      ? UNPREFERRED_AFFINITY_POINTS
      : (AFFINITY_POINTS[Math.min(affinityRank, AFFINITY_POINTS.length - 1)] ?? UNPREFERRED_AFFINITY_POINTS);
  const isExplicitCombo = adc.synergizesWithIds.includes(supportId);
  const comboNote = isExplicitCombo
    ? getAdcSupportComboNote(adc.championId, supportId) ??
      `${adc.name} + ${support.name} is a proven bot-lane combo`
    : undefined;

  return {
    supportId,
    supportName: support.name,
    supportArchetype: support.archetype,
    points: clamp(affinityPoints + (isExplicitCombo ? EXPLICIT_COMBO_POINTS : 0), 0, 20),
    affinityRank,
    isExplicitCombo,
    comboNote,
  };
}

// ---------------------------------------------------------------------------
// 2v2 bot matchup
// ---------------------------------------------------------------------------

/** How each ADC archetype fares against an enemy support archetype (-3..+3). */
const ARCHETYPE_VS_SUPPORT: Record<AdcArchetype, Record<SupportArchetype, number>> = {
  hypercarry: { engage: -3, catcher: -3, poke: -2, enchanter: 1 },
  lane_bully: { engage: 0, catcher: 1, poke: 1, enchanter: 3 },
  caster_poke: { engage: -1, catcher: -1, poke: 1, enchanter: 2 },
  skirmisher: { engage: 2, catcher: 0, poke: -2, enchanter: 1 },
  utility: { engage: 1, catcher: 0, poke: 0, enchanter: 1 },
};

export function computeBotMatchup(
  adc: AdcChampionProfile,
  enemy: InferredEnemyBotLane
): AdcBotMatchupInsight {
  let points = NEUTRAL_MATCHUP_POINTS;
  const notes: string[] = [];
  const qualifier = enemy.confidence === 'likely' ? 'likely ' : '';

  let versusAdc: AdcBotMatchupInsight['versusAdc'] = 'unknown';
  const enemyAdc = enemy.adcId ? findAdcChampionById(enemy.adcId) : undefined;
  if (enemy.adcId) {
    if (adc.strongIntoIds.includes(enemy.adcId)) {
      versusAdc = 'favored';
      points += 5;
      notes.push(`Favored into ${qualifier}enemy ADC ${enemy.adcName}`);
    } else if (adc.weakIntoIds.includes(enemy.adcId)) {
      versusAdc = 'unfavored';
      points -= 5;
      notes.push(`Unfavored into ${qualifier}enemy ADC ${enemy.adcName}`);
    } else {
      versusAdc = 'even';
    }
  }
  if (enemyAdc) {
    const level2Delta = clamp(Math.round((adc.level2Strength - enemyAdc.level2Strength) / 2), -3, 3);
    points += level2Delta;
    if (level2Delta >= 2) notes.push(`Wins the level-2 race vs ${enemyAdc.name}`);
    else if (level2Delta <= -2) notes.push(`Loses the level-2 race vs ${enemyAdc.name} — give up early trades`);
  }

  if (enemy.supportArchetype) {
    let supportDelta = ARCHETYPE_VS_SUPPORT[adc.archetype][enemy.supportArchetype];
    if (adc.rangeTier === 'short' && enemy.supportArchetype === 'poke') supportDelta -= 2;
    points += supportDelta;
    if (supportDelta >= 2) {
      notes.push(`Punishes ${qualifier}${enemy.supportArchetype} support ${enemy.supportName}`);
    } else if (supportDelta <= -2) {
      notes.push(`Struggles vs ${qualifier}${enemy.supportArchetype} support ${enemy.supportName}`);
    }
  }

  return { enemy, points: clamp(points, 0, 20), versusAdc, notes };
}

// ---------------------------------------------------------------------------
// Personal mastery & match focus
// ---------------------------------------------------------------------------

function focusFit(adc: AdcChampionProfile, metric: AdcKpiKey): { points: number; note: string } | null {
  switch (metric) {
    case 'deathsPre14':
      return adc.rangeTier === 'long'
        ? { points: 3, note: 'Long range supports your low early-deaths focus' }
        : null;
    case 'csAt10':
    case 'csPerMin':
      return adc.rangeTier === 'long' || adc.archetype === 'utility' || adc.archetype === 'caster_poke'
        ? { points: 3, note: 'Safe ranged farming supports your CS focus' }
        : null;
    case 'goldDiffAt15':
    case 'turretPlates':
      return adc.archetype === 'lane_bully' || adc.level2Strength >= 8
        ? { points: 3, note: 'Lane pressure supports your early-lead focus' }
        : null;
    case 'damageSharePct':
      return adc.archetype === 'hypercarry' || adc.scalingProfile === 'late'
        ? { points: 3, note: 'Scaling DPS supports your damage-share focus' }
        : null;
    case 'killParticipationPct':
      return adc.archetype === 'skirmisher' || adc.archetype === 'utility'
        ? { points: 3, note: 'Fight-oriented kit supports your kill-participation focus' }
        : null;
    default:
      return null;
  }
}

function scoreMastery(
  adc: AdcChampionProfile,
  ctx: {
    masterySet: Set<number>;
    personalStats?: Record<number, AdcPersonalChampRecord>;
    baselinePersonalWr: number;
    focusMetric?: AdcKpiKey | null;
  },
  reasons: string[],
  warnings: string[]
): number {
  let points = 0;
  if (ctx.masterySet.has(adc.championId)) {
    points += 6;
    reasons.push('One of your highest-mastery ADCs');
  }

  const record = ctx.personalStats?.[adc.championId];
  if (record && record.games >= 3) {
    const rawWrPct = (record.wins / record.games) * 100;
    const priorMean = ctx.baselinePersonalWr;
    const shrunkPct = shrinkWinRate(record.wins, record.games, priorMean, 12) * 100;
    points += clamp(Math.round((shrunkPct - priorMean * 100) / 3), -6, 6);
    if (rawWrPct >= 55) {
      reasons.push(`Your ${Math.round(rawWrPct)}% WR (${record.games}G · ${Math.round(shrunkPct)}% shrunk)`);
    } else if (rawWrPct < 42) {
      warnings.push(`Low personal WR: ${Math.round(rawWrPct)}% (${record.games}G)`);
    }
  }

  if (ctx.focusMetric) {
    const fit = focusFit(adc, ctx.focusMetric);
    if (fit) {
      points += fit.points;
      reasons.push(fit.note);
    }
  }

  return clamp(points, -6, 16);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreAdcContext {
  allyIds: number[];
  enemyIds: number[];
  allySupportId?: number;
  enemyBotLane: InferredEnemyBotLane | null;
  teamNeeds: AdcTeamNeedsAnalysis;
  masterySet: Set<number>;
  personalStats?: Record<number, AdcPersonalChampRecord>;
  baselinePersonalWr: number;
  metaTierOverrides?: RecommendAdcInput['metaTierOverrides'];
  highEloMeta?: RecommendAdcInput['highEloMeta'];
  focusMetric?: AdcKpiKey | null;
}

export function scoreAdcChampion(adc: AdcChampionProfile, ctx: ScoreAdcContext): AdcDraftRecommendation {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Meta (0..35): base 0..30 from (signed override ?? curated) score, High-Elo blend ±5.
  const override = ctx.metaTierOverrides?.find((ov) => ov.championId === adc.championId);
  const effectiveMetaScore = override ? override.metaScore : adc.metaScore;
  let metaPoints = clamp(Math.round(((effectiveMetaScore - 75) / 25) * 30), 0, 30);
  if (override) {
    reasons.push(`Signed Patch Pack ${override.metaTier}-tier override (${override.metaScore.toFixed(1)})`);
  }
  const highEloStat = ctx.highEloMeta?.champions.find(
    (c) => c.championId === adc.championId && c.games >= 5
  );
  if (highEloStat) {
    const shrunkPct = shrinkWinRate(highEloStat.wins, highEloStat.games, 0.5, 10) * 100;
    metaPoints = clamp(metaPoints + clamp(Math.round((shrunkPct - 50) / 3), -5, 5), 0, 35);
    reasons.push(`High-Elo Sample: ${highEloStat.winRate.toFixed(0)}% WR (${highEloStat.games} games)`);
  }

  // 2. Allied support synergy (0..20).
  const supportSynergy = ctx.allySupportId ? computeSupportSynergy(adc, ctx.allySupportId) : null;
  const supportPoints = supportSynergy?.points ?? NEUTRAL_SUPPORT_POINTS;
  if (supportSynergy) {
    if (supportSynergy.isExplicitCombo && supportSynergy.comboNote) {
      reasons.push(`Combo: ${supportSynergy.comboNote}`);
    } else if (supportSynergy.affinityRank === 0) {
      reasons.push(`Ideal ${supportSynergy.supportArchetype} partner in ${supportSynergy.supportName}`);
    }
    if (supportSynergy.affinityRank < 0) {
      warnings.push(
        `${supportSynergy.supportName} (${supportSynergy.supportArchetype}) doesn't fit ${adc.name}'s lane style`
      );
    }
  }

  // 3. 2v2 bot matchup (0..20).
  const botMatchup = ctx.enemyBotLane ? computeBotMatchup(adc, ctx.enemyBotLane) : null;
  const matchupPoints = botMatchup?.points ?? NEUTRAL_MATCHUP_POINTS;
  if (botMatchup) {
    for (const note of botMatchup.notes) {
      if (note.startsWith('Unfavored') || note.startsWith('Loses') || note.startsWith('Struggles')) {
        warnings.push(note);
      } else {
        reasons.push(note);
      }
    }
  }

  // 4. Team needs (0..15).
  const allyCount = ctx.allyIds.filter((id) => id > 0).length;
  const teamNeedPoints = scoreTeamNeeds(adc, ctx.teamNeeds, allyCount, reasons, warnings);

  // 5. Personal mastery & match focus (-6..+16).
  const masteryPoints = scoreMastery(adc, ctx, reasons, warnings);

  if (reasons.length === 0) {
    reasons.push(`${adc.metaTier}-tier meta reliability in bot lane`);
  }

  const totalScore = clamp(
    metaPoints + supportPoints + matchupPoints + teamNeedPoints + masteryPoints,
    0,
    100
  );

  return {
    champion: adc,
    totalScore,
    breakdown: {
      meta: metaPoints,
      supportSynergy: supportPoints,
      botMatchup: matchupPoints,
      teamNeed: teamNeedPoints,
      mastery: masteryPoints,
    },
    supportSynergy,
    botMatchup,
    reasons,
    warnings,
  };
}

export function recommendAdcPicks(input: RecommendAdcInput): AdcDraftRecommendation[] {
  const allySupportId = input.allySupportId ?? inferAllySupportId(input.allyChampionIds);
  const unavailable = new Set<number>(
    [
      ...input.allyChampionIds,
      ...input.enemyChampionIds,
      ...input.bannedChampionIds,
      allySupportId ?? 0,
    ].filter((id) => id > 0)
  );

  const ctx: ScoreAdcContext = {
    allyIds: input.allyChampionIds,
    enemyIds: input.enemyChampionIds,
    allySupportId,
    enemyBotLane: inferEnemyBotLane(input.enemyChampionIds, {
      explicit: input.enemyBotLane,
      isRankedSoloDuo: input.isRankedSoloDuo,
    }),
    teamNeeds: analyzeAdcTeamNeeds(input.allyChampionIds, input.enemyChampionIds),
    masterySet: new Set(input.masteryChampionIds ?? []),
    personalStats: input.personalStats,
    baselinePersonalWr: computePersonalBaselineWinRate(input.personalStats),
    metaTierOverrides: input.metaTierOverrides,
    highEloMeta: input.highEloMeta,
    focusMetric: input.focusMetric,
  };

  return ADC_CHAMPIONS.filter((adc) => !unavailable.has(adc.championId))
    .map((adc) => scoreAdcChampion(adc, ctx))
    .sort((a, b) => b.totalScore - a.totalScore || b.champion.metaScore - a.champion.metaScore)
    .slice(0, Math.max(0, input.limit ?? 5));
}
