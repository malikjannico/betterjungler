// Read-only reuse of the pure Jungle statistics helpers (Wilson bounds, EWM shrinkage).
// Nothing in `../personalLearningEngine` is modified, so Jungle snapshots stay byte-identical.
import {
  EWMA_HALF_LIFE_GAMES,
  NULL_BASE_RATE,
  PRIOR_SHRINKAGE_GAMES,
  WILSON_Z_95,
  classifyMistakeConfidence,
  computeEwmBaseline,
  computePercentile,
  computeWilsonLowerBound,
} from '../personalLearningEngine';
import { formatClock } from '../liveCoachEngine';
import type {
  AdcKpiKey,
  InsightConfidenceStatus,
  MistakeSignatureInsight,
  SqlPersonalLearningSummary,
} from '../../types/coaching';
import type { MatchV5Detail, MatchV5TimelinePosition } from '../../types/riot';
import { ADC_KPI_KEYS, ADC_KPI_META, resolveAdcBenchmark } from './adcBenchmarks';
import {
  ADC_LANE_PHASE_END_SEC,
  ADC_MIN_VALID_MATCH_SECONDS,
  extractAdcMatchKpis,
  getPlayerDeathTimestamps,
  isAdcMatch,
  roundTo,
  safePlayedAtMs,
} from './adcKpis';
import type {
  AdcBenchmarkOverrides,
  AdcMatchKpis,
  AdcMistakeDetectorId,
  AdcMistakeHit,
  AdcMistakeSignatureInsight,
  AdcPersonalBaselineMetric,
  AdcPersonalLearningSnapshot,
  AdcProposedFocusGoal,
} from './adcReviewTypes';

const RIOT_MAP_MAX = 14870;

/** Damage share floor for `adc_low_damage_share` (only judged in games >= 15:00). */
export const ADC_LOW_DAMAGE_SHARE_PCT = 23;
/** Death this many seconds (or fewer) before an enemy Dragon/Baron/Herald take. */
export const ADC_PRE_OBJ_TAKE_WINDOW_SEC = 55;
/** Death this many seconds (or fewer) before a scheduled Dragon/Herald/Baron spawn. */
export const ADC_PRE_OBJ_SPAWN_WINDOW_SEC = 45;
/** First Dragon 5:00, Rift Herald 15:00, Baron 20:00. */
export const ADC_OBJECTIVE_SPAWN_SECONDS = [300, 900, 1200];
const ADC_MAJOR_MONSTERS = new Set(['DRAGON', 'ELDER_DRAGON', 'BARON_NASHOR', 'RIFTHERALD']);
/** Nearest ally further than this (Riot map units, ≈ 2 screens) = isolated. */
export const ADC_ISOLATION_DISTANCE = 2500;
/** Distance past the river diagonal (x + y = 14870) that counts as "in enemy half". */
const RIVER_MARGIN = 1000;
/** Ally frame must be within this many seconds of the death to be trusted. */
const ALLY_FRAME_MAX_GAP_SEC = 60;

interface AdcDetectorMeta {
  label: string;
  category: MistakeSignatureInsight['category'];
  metric: AdcKpiKey;
  baseRate: number;
  drill: string;
}

export const ADC_DETECTOR_CATALOG: Record<AdcMistakeDetectorId, AdcDetectorMeta> = {
  adc_cs_deficit_10: {
    label: 'CS@10 Below Division Floor',
    category: 'farming',
    metric: 'csAt10',
    baseRate: NULL_BASE_RATE,
    drill: 'Last-hit drill: 10 minutes in Practice Tool, then never skip a cannon wave before 10:00.',
  },
  adc_lane_death_pre_14: {
    label: 'Lane Deaths (2+ Before 14:00 Plates Fall)',
    category: 'fighting',
    metric: 'deathsPre14',
    baseRate: NULL_BASE_RATE,
    drill: 'When the enemy jungler is unseen for 30s, step behind your caster minions and stop trading.',
  },
  adc_low_damage_share: {
    label: 'Low Team Damage Share (<23%)',
    category: 'fighting',
    metric: 'damageSharePct',
    baseRate: NULL_BASE_RATE,
    drill: 'In fights, hit the closest safe target every auto window instead of waiting for the carry.',
  },
  adc_pre_obj_death: {
    label: 'Caught Before Dragon / Baron / Herald (<55s Out)',
    category: 'objectives',
    metric: 'killParticipationPct',
    baseRate: NULL_BASE_RATE,
    drill: 'Push the wave, reset and arrive with your support 60s before spawn — never face-check river.',
  },
  adc_isolated_death: {
    label: 'Isolated Death Past River (Mid/Late)',
    category: 'pathing',
    metric: 'damageSharePct',
    baseRate: NULL_BASE_RATE,
    drill: 'After 14:00, only farm side waves past river when 2+ enemies are visible on the map.',
  },
};

const ADC_DETECTOR_IDS = Object.keys(ADC_DETECTOR_CATALOG) as AdcMistakeDetectorId[];

function myTeamId(match: MatchV5Detail): number {
  return match.mapSide === 'red' ? 200 : 100;
}

/** Player deaths within 55s of an enemy Dragon/Baron/Herald take or 45s of a scheduled spawn. */
export function findAdcPreObjectiveDeaths(match: MatchV5Detail): number[] {
  const teamId = myTeamId(match);
  const enemyObjTs = match.events
    .filter(
      (e) =>
        e.type === 'ELITE_MONSTER_KILL' &&
        typeof e.killerTeamId === 'number' &&
        e.killerTeamId !== teamId &&
        ADC_MAJOR_MONSTERS.has((e.monsterType ?? '').toUpperCase())
    )
    .map((e) => e.timestampSec);
  return getPlayerDeathTimestamps(match).filter(
    (dTs) =>
      enemyObjTs.some((oTs) => dTs <= oTs && oTs - dTs <= ADC_PRE_OBJ_TAKE_WINDOW_SEC) ||
      ADC_OBJECTIVE_SPAWN_SECONDS.some(
        (sp) => dTs <= sp && sp - dTs <= ADC_PRE_OBJ_SPAWN_WINDOW_SEC
      )
  );
}

function isPastRiver(match: MatchV5Detail, pos: MatchV5TimelinePosition): boolean {
  const diag = pos.x + pos.y;
  return match.mapSide === 'red'
    ? diag < RIOT_MAP_MAX - RIVER_MARGIN
    : diag > RIOT_MAP_MAX + RIVER_MARGIN;
}

function isFinitePos(p: MatchV5TimelinePosition | null | undefined): p is MatchV5TimelinePosition {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** `true` when at least one frame carries ally positions (required for isolation checks). */
export function hasAllyPositionData(match: MatchV5Detail): boolean {
  return match.frames.some((f) => (f.allyPositions ?? []).some(isFinitePos));
}

/**
 * Deaths after 14:00 in the enemy half of the map where the closest ally (from the nearest
 * timeline frame, ≤60s away) was more than `ADC_ISOLATION_DISTANCE` units away.
 * Returns `[]` when the timeline carries no ally positions — never guesses.
 */
export function findAdcIsolatedDeaths(match: MatchV5Detail): number[] {
  const out: number[] = [];
  for (const ev of match.events) {
    if (ev.type !== 'CHAMPION_KILL' || ev.victimId !== match.playerParticipantId) continue;
    if (ev.timestampSec < ADC_LANE_PHASE_END_SEC || !isFinitePos(ev.position)) continue;
    if (!isPastRiver(match, ev.position)) continue;

    let bestGap = Infinity;
    let allies: MatchV5TimelinePosition[] = [];
    for (const f of match.frames) {
      const framePositions = (f.allyPositions ?? []).filter(isFinitePos);
      if (framePositions.length === 0) continue;
      const gap = Math.abs(f.minute * 60 - ev.timestampSec);
      if (gap <= ALLY_FRAME_MAX_GAP_SEC && gap < bestGap) {
        bestGap = gap;
        allies = framePositions;
      }
    }
    if (allies.length === 0) continue;

    const deathPos = ev.position;
    const nearest = Math.min(
      ...allies.map((a) => Math.hypot(a.x - deathPos.x, a.y - deathPos.y))
    );
    if (nearest > ADC_ISOLATION_DISTANCE) out.push(ev.timestampSec);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Runs all 5 ADC detectors on a single match. Jungle / Off-Role / <5:00 matches return `[]`.
 */
export function detectAdcMatchMistakes(
  match: MatchV5Detail,
  targetDivision = 'PLATINUM IV',
  packOverrides?: AdcBenchmarkOverrides,
  precomputedKpis?: AdcMatchKpis
): AdcMistakeHit[] {
  if (!isAdcMatch(match) || match.durationSeconds < ADC_MIN_VALID_MATCH_SECONDS) return [];
  const kpis = precomputedKpis ?? extractAdcMatchKpis(match);
  const { benchmark } = resolveAdcBenchmark(targetDivision, packOverrides);
  const hits: AdcMistakeHit[] = [];
  const push = (detectorId: AdcMistakeDetectorId, ts: number[], anchorIndex = 0) => {
    if (ts.length === 0) return;
    hits.push({
      detectorId,
      timestampSec: ts[Math.min(anchorIndex, ts.length - 1)]!,
      allTimestampsSec: ts,
    });
  };

  if (kpis.csAt10 !== null && kpis.csAt10 < benchmark.csAt10) {
    push('adc_cs_deficit_10', [600]);
  }

  const laneDeaths = getPlayerDeathTimestamps(match).filter((ts) => ts < ADC_LANE_PHASE_END_SEC);
  if (laneDeaths.length >= 2) {
    // Anchor on the second death (the one that makes it a pattern), mirroring storage.rs.
    push('adc_lane_death_pre_14', laneDeaths, 1);
  }

  if (
    match.durationSeconds >= 900 &&
    kpis.damageSharePct !== null &&
    kpis.damageSharePct < ADC_LOW_DAMAGE_SHARE_PCT
  ) {
    push('adc_low_damage_share', [900]);
  }

  push('adc_pre_obj_death', findAdcPreObjectiveDeaths(match));
  push('adc_isolated_death', findAdcIsolatedDeaths(match));

  return hits;
}

// ---------------------------------------------------------------------------
// Personal learning snapshot
// ---------------------------------------------------------------------------

/** Keys written by `storage.rs::load_personal_learning_summary_for_role(…, "BOTTOM")`. */
const ADC_SQL_BASELINE_KEY_MAP: Record<AdcKpiKey, string> = {
  csAt10: 'cs_at_10',
  csPerMin: 'cs_per_min',
  goldDiffAt15: 'gold_diff_at_15',
  damageSharePct: 'damage_share_pct',
  deathsPre14: 'deaths_pre_14',
  turretPlates: 'turret_plates',
  killParticipationPct: 'kill_participation_pct',
};

const JUNGLE_ONLY_SQL_KEYS = new Set([
  'objective_share_pct',
  'pre_obj_deaths',
  'early_deaths',
  'vision_per_min',
]);

/**
 * The SQL summary must come from `getPersonalLearningSummary(…, 'BOTTOM')` (whose
 * `jungleMatchCount` then holds the ADC match count). A Jungle-scoped summary is detected
 * and ignored so Jungle history can never leak into ADC baselines or hit counts.
 */
function isAdcScopedSqlSummary(summary: SqlPersonalLearningSummary): boolean {
  if (summary.mistakeSignatures.some((s) => !s.detectorId.startsWith('adc_'))) return false;
  if (summary.baselines.some((b) => JUNGLE_ONLY_SQL_KEYS.has(b.key))) return false;
  return true;
}

function kpiValue(kpis: AdcMatchKpis, metric: AdcKpiKey): number | null {
  const v = kpis[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeAdcPersonalLearningSnapshot(
  allMatches: ReadonlyArray<MatchV5Detail>,
  targetDivision = 'PLATINUM IV',
  sqlSummary?: SqlPersonalLearningSummary | null,
  packOverrides?: AdcBenchmarkOverrides
): AdcPersonalLearningSnapshot {
  const adcMatches = allMatches
    .filter((m) => isAdcMatch(m) && m.durationSeconds >= ADC_MIN_VALID_MATCH_SECONDS)
    .sort((a, b) => safePlayedAtMs(b.playedAt) - safePlayedAtMs(a.playedAt));
  const excludedMatchCount = allMatches.length - adcMatches.length;

  const resolved = resolveAdcBenchmark(targetDivision, packOverrides);
  const bench = resolved.benchmark;
  const sql = sqlSummary && isAdcScopedSqlSummary(sqlSummary) ? sqlSummary : null;

  const perMatch = adcMatches.map((match) => {
    const kpis = extractAdcMatchKpis(match);
    return {
      match,
      kpis,
      hits: detectAdcMatchMistakes(match, targetDivision, packOverrides, kpis),
    };
  });

  const decayRatio = Math.pow(0.5, 1 / EWMA_HALF_LIFE_GAMES);
  const baselines = {} as Record<AdcKpiKey, AdcPersonalBaselineMetric>;
  for (const metric of ADC_KPI_KEYS) {
    const decimals = ADC_KPI_META[metric].decimals;
    const values = perMatch
      .map(({ kpis }) => kpiValue(kpis, metric))
      .filter((v): v is number => v !== null);
    const prior = bench[metric];
    const ewma = computeEwmBaseline(values, prior);

    let ewmVal = ewma.ewm;
    let shrunkVal = ewma.shrunk;
    let effN = ewma.effectiveN;

    // Deeper BOTTOM-scoped SQLite history wins over the in-memory window (same blend as Jungle).
    const sqlRow = sql?.baselines.find((b) => b.key === ADC_SQL_BASELINE_KEY_MAP[metric]);
    if (sqlRow && sqlRow.sampleN > values.length && Number.isFinite(sqlRow.value)) {
      const wSum = (1 - Math.pow(decayRatio, sqlRow.sampleN)) / (1 - decayRatio);
      const sqRatio = decayRatio * decayRatio;
      const wSqSum = (1 - Math.pow(sqRatio, sqlRow.sampleN)) / (1 - sqRatio);
      ewmVal = sqlRow.value;
      shrunkVal =
        (sqlRow.value * wSum + PRIOR_SHRINKAGE_GAMES * prior) /
        Math.max(1e-6, wSum + PRIOR_SHRINKAGE_GAMES);
      effN = Math.max(effN, wSqSum > 0 ? (wSum * wSum) / wSqSum : effN);
    }

    baselines[metric] = {
      metric,
      ewmValue: roundTo(ewmVal, decimals),
      shrunkBaseline: roundTo(shrunkVal, decimals),
      priorTarget: prior,
      effectiveN: roundTo(effN, 1),
      p25: roundTo(computePercentile(values, 0.25), decimals),
      p50: roundTo(computePercentile(values, 0.5), decimals),
      p75: roundTo(computePercentile(values, 0.75), decimals),
      trendDelta: roundTo(ewma.recentDelta, decimals),
    };
  }

  const buckets = new Map<AdcMistakeDetectorId, { matches: Set<string>; timestamps: number[] }>();
  for (const { match, hits } of perMatch) {
    for (const hit of hits) {
      const bucket = buckets.get(hit.detectorId) ?? { matches: new Set<string>(), timestamps: [] };
      bucket.matches.add(match.matchId);
      bucket.timestamps.push(hit.timestampSec);
      buckets.set(hit.detectorId, bucket);
    }
  }

  const usedSqlDepth = Boolean(sql && sql.jungleMatchCount > adcMatches.length);
  const total = usedSqlDepth ? sql!.jungleMatchCount : adcMatches.length;

  const signatures: AdcMistakeSignatureInsight[] = [];
  for (const detectorId of ADC_DETECTOR_IDS) {
    const meta = ADC_DETECTOR_CATALOG[detectorId];
    const bucket = buckets.get(detectorId);
    const sqlSig = usedSqlDepth
      ? sql!.mistakeSignatures.find((s) => s.detectorId === detectorId)
      : undefined;
    const hitMatches = Math.max(bucket?.matches.size ?? 0, sqlSig?.hitMatches ?? 0);
    if (hitMatches === 0 || total === 0) continue;

    const clampedHits = Math.min(total, hitMatches);
    const timestamps =
      bucket && bucket.timestamps.length > 0
        ? bucket.timestamps.slice(0, 3)
        : sqlSig && sqlSig.lastTimestampSec > 0
          ? [sqlSig.lastTimestampSec]
          : [];

    signatures.push({
      role: 'bottom',
      detectorId,
      label: meta.label,
      category: meta.category,
      metric: meta.metric,
      status: classifyMistakeConfidence(clampedHits, total, meta.baseRate),
      hitMatches: clampedHits,
      totalMatches: total,
      hitRatePct: Math.round((clampedHits / total) * 100),
      wilsonLowerBoundPct: Math.round(computeWilsonLowerBound(clampedHits, total, WILSON_Z_95) * 100),
      baseRatePct: Math.round(meta.baseRate * 100),
      drill: meta.drill,
      recentTimestamps: timestamps,
    });
  }

  const statusRank: Record<InsightConfidenceStatus, number> = {
    confirmed: 3,
    emerging: 2,
    monitoring: 1,
  };
  signatures.sort(
    (a, b) =>
      statusRank[b.status] - statusRank[a.status] ||
      b.wilsonLowerBoundPct - a.wilsonLowerBoundPct ||
      b.hitMatches - a.hitMatches
  );

  // Only a Wilson-95 confirmed leak whose shrunk baseline still misses the target becomes a focus.
  let proposedFocus: AdcProposedFocusGoal | null = null;
  const topConfirmed = signatures.find((s) => {
    if (s.status !== 'confirmed') return false;
    const base = baselines[s.metric].shrunkBaseline;
    const target = bench[s.metric];
    return ADC_KPI_META[s.metric].lowerIsBetter ? base > target : base < target;
  });

  if (topConfirmed) {
    const meta = ADC_KPI_META[topConfirmed.metric];
    const targetValue = bench[topConfirmed.metric];
    const firstTs = topConfirmed.recentTimestamps[0];
    const lastClock = firstTs !== undefined ? ` (e.g. ${formatClock(firstTs)})` : '';
    const newest = adcMatches[0]?.playedAt;
    proposedFocus = {
      sourceDetectorId: topConfirmed.detectorId,
      reason: `Confirmed pattern across ${topConfirmed.hitMatches}/${topConfirmed.totalMatches} ADC games (${topConfirmed.hitRatePct}%)${lastClock}.`,
      goal: {
        id: `adc-m13-${topConfirmed.detectorId}`,
        role: 'bottom',
        targetDivision,
        metric: topConfirmed.metric,
        title: meta.goalTemplate.replace('{target}', String(targetValue)),
        targetValue,
        currentValue: baselines[topConfirmed.metric].shrunkBaseline,
        unit: meta.unit,
        lowerIsBetter: meta.lowerIsBetter,
        status: 'active',
        source: 'auto',
        createdAt:
          newest && Number.isFinite(Date.parse(newest)) ? newest : '1970-01-01T00:00:00.000Z',
        isFocusGoal: true,
      },
    };
  }

  return {
    role: 'bottom',
    adcMatchCount: total,
    excludedMatchCount,
    isProvisional: resolved.isProvisional,
    usedSqlDepth,
    baselines,
    signatures,
    proposedFocus,
  };
}
