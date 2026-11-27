import { DIVISION_BENCHMARKS, KPI_META, parseTargetTier } from './climbLadderEngine';
import { formatClock } from './liveCoachEngine';
import { analyzePostGameMatch, isJungleMatch } from './postGameReviewEngine';
import type {
  InsightConfidenceStatus,
  JungleKpiKey,
  MistakeDetectorId,
  MistakeSignatureInsight,
  MultiSessionTiltSummary,
  PersonalBaselineMetric,
  PersonalLearningSnapshot,
  ProposedFocusGoal,
  SqlPersonalLearningSummary,
} from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';

export const NULL_BASE_RATE = 0.15;
export const WILSON_Z_95 = 1.96;
export const WILSON_Z_80 = 1.28;
export const MIN_VALID_MATCH_SECONDS = 300;
export const EWMA_HALF_LIFE_GAMES = 8;
export const PRIOR_SHRINKAGE_GAMES = 6;
export const SESSION_GAP_MS = 2 * 60 * 60 * 1000;

interface DetectorMeta {
  label: string;
  category: MistakeSignatureInsight['category'];
  metric: JungleKpiKey;
  baseRate: number;
  drill: string;
}

export const DETECTOR_CATALOG: Record<MistakeDetectorId, DetectorMeta> = {
  pre_obj_death: {
    label: 'Pre-Objective Deaths (<55s Out)',
    category: 'objectives',
    metric: 'preObjectiveDeaths',
    baseRate: NULL_BASE_RATE,
    drill: 'Reset 65s before Dragon/Baron spawns and escort Support with Oracle Lens.',
  },
  early_death_before_10: {
    label: 'Early Tempo Deaths (2+ Before 10:00)',
    category: 'fighting',
    metric: 'earlyDeaths',
    baseRate: NULL_BASE_RATE,
    drill: 'Verify adjacent lane priority before contesting 3:30 Scuttle or level-4 invades.',
  },
  midgame_farm_drop: {
    label: 'Mid-Game Farm Drop (<5.7 CS/min)',
    category: 'farming',
    metric: 'csPerMin',
    baseRate: NULL_BASE_RATE,
    drill: 'Sequence your strong-side camp quadrant on respawn before hovering mid/bot waves.',
  },
  blind_river_vision: {
    label: 'Low Pit & River Vision (<2 Controls or <0.70/min)',
    category: 'vision',
    metric: 'visionPerMin',
    baseRate: NULL_BASE_RATE,
    drill: 'Purchase 1 Control Ward every objective reset and sweep river choke points at T-45s.',
  },
  early_gold_deficit_15: {
    label: 'Early Gold Deficit @15 (-400g+ Behind)',
    category: 'pathing',
    metric: 'goldDiffAt15',
    baseRate: NULL_BASE_RATE,
    drill: 'Trade opposite-side quadrant camps immediately whenever enemy jungler shows cross-map.',
  },
};

function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/**
 * Wilson score lower confidence bound for Binomial proportion p = hits / n.
 */
export function computeWilsonLowerBound(hits: number, n: number, z = WILSON_Z_95): number {
  if (n <= 0 || hits <= 0) return 0;
  const clampedHits = Math.min(n, Math.max(0, hits));
  const p = clampedHits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

/**
 * Linear-interpolated empirical quantile in p in [0..1].
 */
export function computePercentile(values: number[], p: number): number {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  if (finite.length === 1) return finite[0]!;
  const clampedP = Math.max(0, Math.min(1, p));
  const pos = clampedP * (finite.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return finite[lo]!;
  const frac = pos - lo;
  return finite[lo]! * (1 - frac) + finite[hi]! * frac;
}

/**
 * Computes exponentially weighted moving average (`halfLife = 8` games) shrunk smoothly
 * toward the target division prior so early samples remain grounded.
 */
export function computeEwmBaseline(
  valuesNewestFirst: number[],
  priorValue: number,
  halfLife = EWMA_HALF_LIFE_GAMES,
  priorStrength = PRIOR_SHRINKAGE_GAMES
): { ewm: number; shrunk: number; effectiveN: number; recentDelta: number } {
  const clean = valuesNewestFirst.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { ewm: priorValue, shrunk: priorValue, effectiveN: 0, recentDelta: 0 };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let weightSqTotal = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const w = Math.pow(0.5, i / Math.max(1, halfLife));
    weightedSum += clean[i]! * w;
    weightTotal += w;
    weightSqTotal += w * w;
  }

  const ewm = weightTotal > 0 ? weightedSum / weightTotal : priorValue;
  const shrunk =
    (weightedSum + priorStrength * priorValue) / Math.max(1e-6, weightTotal + priorStrength);
  const kishEffectiveN = weightSqTotal > 0 ? (weightTotal * weightTotal) / weightSqTotal : 0;

  let recentDelta = 0;
  if (clean.length >= 6) {
    const recentAvg = clean.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const olderSlice = clean.slice(5);
    const olderAvg = olderSlice.reduce((a, b) => a + b, 0) / olderSlice.length;
    recentDelta = recentAvg - olderAvg;
  }

  return {
    ewm,
    shrunk,
    effectiveN: kishEffectiveN,
    recentDelta,
  };
}

/**
 * Classifies a detector hit frequency into Confirmed / Emerging / Monitoring
 * so normal variance never surfaces false "confirmed leak" claims.
 */
export function classifyMistakeConfidence(
  hits: number,
  totalMatches: number,
  baseRate = NULL_BASE_RATE
): InsightConfidenceStatus {
  if (totalMatches <= 0 || hits <= 0) return 'monitoring';
  const wilson95 = computeWilsonLowerBound(hits, totalMatches, WILSON_Z_95);
  const minConfirmedHits =
    totalMatches >= 19 ? 7 : totalMatches >= 12 && totalMatches < 19 ? 6 : 5;
  if (hits >= minConfirmedHits && wilson95 > baseRate) {
    return 'confirmed';
  }
  const wilson80 = computeWilsonLowerBound(hits, totalMatches, WILSON_Z_80);
  if (hits >= 3 && wilson80 > baseRate) {
    return 'emerging';
  }
  return 'monitoring';
}

export interface MatchMistakeHit {
  detectorId: MistakeDetectorId;
  timestampSec: number;
}

/**
 * Evaluates all 5 deterministic mistake signatures for a single completed Jungle match.
 * Thresholds mirror `src-tauri/src/storage.rs::upsert_match_facts_inner`.
 */
export function detectMatchMistakeSignatures(
  match: MatchV5Detail,
  targetDivision = 'PLATINUM IV',
  precomputedReport?: ReturnType<typeof analyzePostGameMatch>
): MatchMistakeHit[] {
  if (!isJungleMatch(match) || match.durationSeconds < MIN_VALID_MATCH_SECONDS) {
    return [];
  }
  const report = precomputedReport ?? analyzePostGameMatch(match, targetDivision);
  const hits: MatchMistakeHit[] = [];
  const myTeamId = match.mapSide === 'red' ? 200 : 100;
  const enemyMonsterTs = match.events
    .filter(
      (e) =>
        e.type === 'ELITE_MONSTER_KILL' &&
        typeof e.killerTeamId === 'number' &&
        e.killerTeamId !== myTeamId
    )
    .map((e) => e.timestampSec);
  const playerDeathTs = match.events
    .filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === match.playerParticipantId)
    .map((e) => e.timestampSec)
    .sort((a, b) => a - b);
  const spawnWindows = [300, 360, 840, 1500];
  const preObjDeathTs = playerDeathTs.filter(
    (dTs) =>
      enemyMonsterTs.some((oTs) => dTs <= oTs && oTs - dTs <= 55) ||
      spawnWindows.some((sp) => dTs <= sp && sp - dTs <= 45)
  );

  if (preObjDeathTs.length > 0 || report.kpis.preObjectiveDeaths > 0) {
    const firstPre = report.markers.find((m) => m.kind === 'pre_obj_death');
    hits.push({
      detectorId: 'pre_obj_death',
      timestampSec: preObjDeathTs[0] ?? firstPre?.timestampSec ?? Math.min(300, match.durationSeconds),
    });
  }

  if (report.kpis.earlyDeaths >= 2) {
    const earlyPlayerDeaths = playerDeathTs.filter((ts) => ts < 600);
    hits.push({
      detectorId: 'early_death_before_10',
      timestampSec: earlyPlayerDeaths[1] ?? earlyPlayerDeaths[0] ?? 540,
    });
  }

  if (match.durationSeconds >= 900 && report.kpis.csPerMin < 5.7) {
    hits.push({
      detectorId: 'midgame_farm_drop',
      timestampSec: 900,
    });
  }

  if (
    match.durationSeconds >= 720 &&
    (match.controlWardsBought <= 1 || report.kpis.visionPerMin < 0.7)
  ) {
    hits.push({
      detectorId: 'blind_river_vision',
      timestampSec: 720,
    });
  }

  const exactFrame15 = match.frames.find((f) => f.minute === 15);
  if (
    match.durationSeconds >= 900 &&
    exactFrame15 &&
    exactFrame15.totalGold - exactFrame15.enemyJunglerGold <= -400
  ) {
    hits.push({
      detectorId: 'early_gold_deficit_15',
      timestampSec: 900,
    });
  }

  return hits;
}

/**
 * Groups completed matches into discrete play sessions separated by `sessionGapMs` (2h default)
 * to measure stamina fade (games 1-2 vs 3+) and post-loss requeue tilt.
 */
export function analyzeMultiSessionTilt(
  matches: ReadonlyArray<{ win: boolean; playedAt: string; durationSeconds?: number }>,
  sessionGapMs = SESSION_GAP_MS
): MultiSessionTiltSummary {
  const dated = matches
    .filter(
      (m) =>
        typeof m.durationSeconds !== 'number' || m.durationSeconds >= MIN_VALID_MATCH_SECONDS
    )
    .map((m) => ({ win: m.win, ts: Date.parse(m.playedAt) }))
    .filter((m) => Number.isFinite(m.ts))
    .sort((a, b) => a.ts - b.ts); // chronological oldest -> newest

  if (dated.length === 0) {
    return {
      sessionCount: 0,
      avgGamesPerSession: 0,
      freshWrPct: 0,
      freshGames: 0,
      extendedWrPct: null,
      extendedGames: 0,
      postLossWrPct: null,
      postLossGames: 0,
      postWinWrPct: null,
      postWinGames: 0,
      advisory: 'Sync ranked matches to analyze multi-session stamina and requeue win rates.',
    };
  }

  const sessions: Array<Array<{ win: boolean; ts: number }>> = [];
  for (const item of dated) {
    const current = sessions[sessions.length - 1];
    if (!current || item.ts - current[current.length - 1]!.ts > sessionGapMs) {
      sessions.push([item]);
    } else {
      current.push(item);
    }
  }

  let freshGames = 0;
  let freshWins = 0;
  let extendedGames = 0;
  let extendedWins = 0;
  let postLossGames = 0;
  let postLossWins = 0;
  let postWinGames = 0;
  let postWinWins = 0;

  for (const session of sessions) {
    session.forEach((game, idx) => {
      if (idx < 2) {
        freshGames += 1;
        if (game.win) freshWins += 1;
      } else {
        extendedGames += 1;
        if (game.win) extendedWins += 1;
      }

      if (idx > 0) {
        const prev = session[idx - 1]!;
        if (prev.win) {
          postWinGames += 1;
          if (game.win) postWinWins += 1;
        } else {
          postLossGames += 1;
          if (game.win) postLossWins += 1;
        }
      }
    });
  }

  const freshWrPct = freshGames > 0 ? Math.round((freshWins / freshGames) * 100) : 0;
  const extendedWrPct = extendedGames > 0 ? Math.round((extendedWins / extendedGames) * 100) : null;
  const postLossWrPct = postLossGames > 0 ? Math.round((postLossWins / postLossGames) * 100) : null;
  const postWinWrPct = postWinGames > 0 ? Math.round((postWinWins / postWinGames) * 100) : null;

  let advisory =
    dated.length < 3
      ? 'Play 3+ completed games to evaluate multi-session stamina and requeue composure.'
      : 'Composure across blocks looks steady — keep 2–3 game focused sets with 5m resets.';
  if (postLossGames >= 3 && postLossWrPct !== null && postLossWrPct <= 35) {
    advisory = `Post-loss requeue tilt signal (${postLossWrPct}% WR across ${postLossGames} immediate requeues). Take a 10m break after any loss.`;
  } else if (
    extendedGames >= 3 &&
    extendedWrPct !== null &&
    freshWrPct - extendedWrPct >= 15
  ) {
    advisory = `Block fatigue detected: Games 1–2 win ${freshWrPct}% vs ${extendedWrPct}% in Game 3+. Cap ranked blocks at 2–3 games.`;
  }

  return {
    sessionCount: sessions.length,
    avgGamesPerSession: roundTo(dated.length / sessions.length, 1),
    freshWrPct,
    freshGames,
    extendedWrPct,
    extendedGames,
    postLossWrPct,
    postLossGames,
    postWinWrPct,
    postWinGames,
    advisory,
  };
}

function decimalsForMetric(metric: JungleKpiKey): number {
  if (metric === 'visionPerMin' || metric === 'preObjectiveDeaths' || metric === 'earlyDeaths') {
    return 2;
  }
  if (metric === 'csPerMin') return 1;
  return 0;
}

const SQL_BASELINE_KEY_MAP: Record<JungleKpiKey, string> = {
  csPerMin: 'cs_per_min',
  goldDiffAt15: 'gold_diff_at_15',
  objectiveSharePct: 'objective_share_pct',
  preObjectiveDeaths: 'pre_obj_deaths',
  earlyDeaths: 'early_deaths',
  visionPerMin: 'vision_per_min',
  killParticipationPct: 'kill_participation_pct',
};

function safePlayedAtMs(playedAt: string): number {
  const ts = Date.parse(playedAt);
  return Number.isFinite(ts) ? ts : 0;
}

export function computePersonalLearningSnapshot(
  jungleMatches: MatchV5Detail[],
  allMatchesForSessions: MatchV5Detail[],
  targetDivision = 'PLATINUM IV',
  sqlSummary?: SqlPersonalLearningSummary | null
): PersonalLearningSnapshot {
  const orderedNewest = [...jungleMatches]
    .filter((m) => isJungleMatch(m) && m.durationSeconds >= MIN_VALID_MATCH_SECONDS)
    .sort((a, b) => safePlayedAtMs(b.playedAt) - safePlayedAtMs(a.playedAt));

  const tier = parseTargetTier(targetDivision);
  const bench = DIVISION_BENCHMARKS[tier];

  const perMatchReports = orderedNewest.map((m) => ({
    match: m,
    report: analyzePostGameMatch(m, targetDivision),
  }));

  const metricValueExtractors: Record<
    JungleKpiKey,
    (entry: { match: MatchV5Detail; report: ReturnType<typeof analyzePostGameMatch> }) => number | null
  > = {
    csPerMin: ({ report }) => report.kpis.csPerMin,
    goldDiffAt15: ({ match }) => {
      if (match.durationSeconds < 900) return null;
      const frame15 = match.frames.find((f) => f.minute === 15);
      return frame15 ? frame15.totalGold - frame15.enemyJunglerGold : null;
    },
    objectiveSharePct: ({ match, report }) =>
      match.teamObjectives + match.enemyObjectives > 0 ? report.kpis.objectiveSharePct : null,
    preObjectiveDeaths: ({ report }) => report.kpis.preObjectiveDeaths,
    earlyDeaths: ({ report }) => report.kpis.earlyDeaths,
    visionPerMin: ({ report }) => report.kpis.visionPerMin,
    killParticipationPct: ({ report }) => report.kpis.killParticipationPct,
  };

  const decayRatio = Math.pow(0.5, 1 / EWMA_HALF_LIFE_GAMES);
  const baselines = {} as Record<JungleKpiKey, PersonalBaselineMetric>;
  for (const metric of Object.keys(metricValueExtractors) as JungleKpiKey[]) {
    const decimals = decimalsForMetric(metric);
    const values = perMatchReports
      .map((entry) => metricValueExtractors[metric](entry))
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const prior = bench[metric];
    const ewma = computeEwmBaseline(values, prior);

    let ewmVal = ewma.ewm;
    let shrunkVal = ewma.shrunk;
    let effN = ewma.effectiveN;

    // When SQLite holds deeper match history than in-memory `matches`, blend SQL EWM baseline with tier prior
    const sqlRow = sqlSummary?.baselines.find((b) => b.key === SQL_BASELINE_KEY_MAP[metric]);
    if (sqlRow && sqlRow.sampleN > values.length && Number.isFinite(sqlRow.value)) {
      const approxWeightSum = (1 - Math.pow(decayRatio, sqlRow.sampleN)) / (1 - decayRatio);
      const decaySqRatio = decayRatio * decayRatio;
      const approxWeightSqSum =
        (1 - Math.pow(decaySqRatio, sqlRow.sampleN)) / (1 - decaySqRatio);
      const kishSqlN =
        approxWeightSqSum > 0 ? (approxWeightSum * approxWeightSum) / approxWeightSqSum : effN;
      ewmVal = sqlRow.value;
      shrunkVal =
        (sqlRow.value * approxWeightSum + PRIOR_SHRINKAGE_GAMES * prior) /
        Math.max(1e-6, approxWeightSum + PRIOR_SHRINKAGE_GAMES);
      effN = Math.max(effN, kishSqlN);
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

  const hitsByDetector = new Map<
    MistakeDetectorId,
    { matches: Set<string>; timestamps: number[] }
  >();
  for (const { match, report } of perMatchReports) {
    const hits = detectMatchMistakeSignatures(match, targetDivision, report);
    for (const hit of hits) {
      const bucket = hitsByDetector.get(hit.detectorId) ?? {
        matches: new Set<string>(),
        timestamps: [],
      };
      bucket.matches.add(match.matchId);
      bucket.timestamps.push(hit.timestampSec);
      hitsByDetector.set(hit.detectorId, bucket);
    }
  }

  const useSqlDepth = Boolean(sqlSummary && sqlSummary.jungleMatchCount > orderedNewest.length);
  const totalJungle = useSqlDepth ? sqlSummary!.jungleMatchCount : orderedNewest.length;
  const signatures: MistakeSignatureInsight[] = [];

  for (const detectorId of Object.keys(DETECTOR_CATALOG) as MistakeDetectorId[]) {
    const meta = DETECTOR_CATALOG[detectorId];
    const bucket = hitsByDetector.get(detectorId);
    const sqlSig = useSqlDepth
      ? sqlSummary?.mistakeSignatures.find((s) => s.detectorId === detectorId)
      : undefined;
    const hitMatches = useSqlDepth
      ? Math.max(bucket?.matches.size ?? 0, sqlSig?.hitMatches ?? 0)
      : (bucket?.matches.size ?? 0);
    if (hitMatches === 0 || totalJungle === 0) continue;

    const clampedHits = Math.min(totalJungle, hitMatches);
    const status = classifyMistakeConfidence(clampedHits, totalJungle, meta.baseRate);
    const hitRatePct = Math.round((clampedHits / totalJungle) * 100);
    const wilsonLowerPct = Math.round(
      computeWilsonLowerBound(clampedHits, totalJungle, WILSON_Z_95) * 100
    );
    const timestamps =
      bucket && bucket.timestamps.length > 0
        ? bucket.timestamps.slice(0, 3)
        : sqlSig && sqlSig.lastTimestampSec > 0
          ? [sqlSig.lastTimestampSec]
          : [];

    signatures.push({
      detectorId,
      label: meta.label,
      category: meta.category,
      metric: meta.metric,
      status,
      hitMatches: clampedHits,
      totalMatches: totalJungle,
      hitRatePct,
      wilsonLowerBoundPct: wilsonLowerPct,
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

  // Auto-propose a Match Focus goal strictly from Wilson-95 Confirmed leaks whose baseline has room to improve
  let proposedFocus: ProposedFocusGoal | null = null;
  const topConfirmed = signatures.find((s) => {
    if (s.status !== 'confirmed') return false;
    const baseMetric = baselines[s.metric];
    const kpiMeta = KPI_META[s.metric];
    const targetVal = bench[s.metric];
    const alreadyMeets = kpiMeta.lowerIsBetter
      ? baseMetric.shrunkBaseline <= targetVal
      : baseMetric.shrunkBaseline >= targetVal;
    return !alreadyMeets;
  });

  if (topConfirmed) {
    const baseMetric = baselines[topConfirmed.metric];
    const kpiMeta = KPI_META[topConfirmed.metric];
    const targetValue = bench[topConfirmed.metric];
    const lastClock =
      topConfirmed.recentTimestamps[0] !== undefined
        ? ` (e.g. ${formatClock(topConfirmed.recentTimestamps[0])})`
        : '';
    const newestValidIso =
      orderedNewest[0]?.playedAt && Number.isFinite(Date.parse(orderedNewest[0].playedAt))
        ? orderedNewest[0].playedAt
        : '1970-01-01T00:00:00.000Z';

    proposedFocus = {
      sourceDetectorId: topConfirmed.detectorId,
      reason: `Confirmed pattern across ${topConfirmed.hitMatches}/${topConfirmed.totalMatches} jungle games (${topConfirmed.hitRatePct}%)${lastClock}.`,
      goal: {
        id: `m13-${topConfirmed.detectorId}`,
        targetDivision,
        metric: topConfirmed.metric,
        title: kpiMeta.goalTemplate.replace('{target}', String(targetValue)),
        targetValue,
        currentValue: baseMetric.shrunkBaseline,
        unit: kpiMeta.unit,
        lowerIsBetter: kpiMeta.lowerIsBetter,
        status: 'active',
        source: 'auto',
        createdAt: newestValidIso,
        isFocusGoal: true,
      },
    };
  }

  const tiltAnalytics = analyzeMultiSessionTilt(allMatchesForSessions);

  return {
    jungleMatchCount: totalJungle,
    baselines,
    signatures,
    proposedFocus,
    tiltAnalytics,
  };
}
