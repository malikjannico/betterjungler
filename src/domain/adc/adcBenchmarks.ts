// Read-only reuse of the Jungle tier parser; Jungle benchmark tables are never touched.
import { parseTargetTier } from '../climbLadderEngine';
import type {
  AdcDivisionBenchmark,
  AdcKpiKey,
  ClimbGoal,
  DivisionTier,
} from '../../types/coaching';
import type { MatchV5Detail } from '../../types/riot';
import {
  ADC_MIN_VALID_MATCH_SECONDS,
  isAdcMatch,
  roundTo,
  safePlayedAtMs,
  toAdcMatchSummary,
} from './adcKpis';
import type {
  AdcBenchmarkComparison,
  AdcBenchmarkOverrides,
  AdcDivisionEvaluation,
  AdcMatchSummary,
  ResolvedAdcBenchmark,
} from './adcReviewTypes';

/**
 * PROVISIONAL ADC benchmarks (not yet calibrated against a ranked sample). SILVER..MASTER follow
 * the agreed ranges; IRON/BRONZE are extrapolated below SILVER. Patch packs can replace any value
 * via `roleBenchmarks.bottom`; output stays `isProvisional: true` until all 7 KPIs are calibrated.
 *
 * `goldDiffAt15` is the expected lane gold diff vs the opposing ADC at 15:00.
 */
export const ADC_BENCHMARKS_PROVISIONAL: Record<DivisionTier, AdcDivisionBenchmark> = {
  IRON: { csAt10: 52, csPerMin: 5.4, goldDiffAt15: -420, damageSharePct: 21, deathsPre14: 2.4, turretPlates: 0.6, killParticipationPct: 50 },
  BRONZE: { csAt10: 57, csPerMin: 5.9, goldDiffAt15: -320, damageSharePct: 22, deathsPre14: 2.1, turretPlates: 0.8, killParticipationPct: 52 },
  SILVER: { csAt10: 62, csPerMin: 6.3, goldDiffAt15: -220, damageSharePct: 23, deathsPre14: 1.9, turretPlates: 1.0, killParticipationPct: 54 },
  GOLD: { csAt10: 66, csPerMin: 6.8, goldDiffAt15: -90, damageSharePct: 24.5, deathsPre14: 1.7, turretPlates: 1.3, killParticipationPct: 57 },
  PLATINUM: { csAt10: 70, csPerMin: 7.2, goldDiffAt15: 30, damageSharePct: 26, deathsPre14: 1.5, turretPlates: 1.6, killParticipationPct: 60 },
  EMERALD: { csAt10: 74, csPerMin: 7.7, goldDiffAt15: 160, damageSharePct: 27, deathsPre14: 1.3, turretPlates: 1.9, killParticipationPct: 62 },
  DIAMOND: { csAt10: 78, csPerMin: 8.1, goldDiffAt15: 290, damageSharePct: 28.5, deathsPre14: 1.1, turretPlates: 2.1, killParticipationPct: 65 },
  MASTER: { csAt10: 82, csPerMin: 8.6, goldDiffAt15: 420, damageSharePct: 30, deathsPre14: 0.9, turretPlates: 2.4, killParticipationPct: 68 },
};

export const ADC_KPI_KEYS: AdcKpiKey[] = [
  'csAt10',
  'csPerMin',
  'goldDiffAt15',
  'damageSharePct',
  'deathsPre14',
  'turretPlates',
  'killParticipationPct',
];

export const ADC_KPI_META: Record<
  AdcKpiKey,
  { label: string; unit: string; lowerIsBetter: boolean; decimals: number; goalTemplate: string }
> = {
  csAt10: {
    label: 'CS @ 10:00',
    unit: 'CS',
    lowerIsBetter: false,
    decimals: 0,
    goalTemplate: 'Reach >= {target} CS by 10:00 in lane',
  },
  csPerMin: {
    label: 'Farm Tempo',
    unit: 'CS/m',
    lowerIsBetter: false,
    decimals: 1,
    goalTemplate: 'Maintain >= {target} CS/min across ranked ADC games',
  },
  goldDiffAt15: {
    label: 'Lane Gold Diff @15',
    unit: 'g',
    lowerIsBetter: false,
    decimals: 0,
    goalTemplate: 'Average >= {target}g Gold Diff vs lane opponent @ 15m',
  },
  damageSharePct: {
    label: 'Team Damage Share',
    unit: '%',
    lowerIsBetter: false,
    decimals: 1,
    goalTemplate: "Deal >= {target}% of your team's champion damage",
  },
  deathsPre14: {
    label: 'Lane Deaths (<14m)',
    unit: '/game',
    lowerIsBetter: true,
    decimals: 2,
    goalTemplate: 'Keep deaths before 14:00 <= {target}/game',
  },
  turretPlates: {
    label: 'Turret Plates',
    unit: '/game',
    lowerIsBetter: false,
    decimals: 1,
    goalTemplate: 'Take >= {target} turret plates before 14:00',
  },
  killParticipationPct: {
    label: 'Kill Participation',
    unit: '%',
    lowerIsBetter: false,
    decimals: 0,
    goalTemplate: 'Join >= {target}% of team kills via dragon & mid-lane fights',
  },
};

const RECENT_WINDOW = 15;

/** Merges pack overrides for the target tier on top of the provisional table. */
export function resolveAdcBenchmark(
  targetDivision: string,
  packOverrides?: AdcBenchmarkOverrides
): ResolvedAdcBenchmark {
  const tier = parseTargetTier(targetDivision);
  const base = ADC_BENCHMARKS_PROVISIONAL[tier];
  const wantedFull = targetDivision.trim().toUpperCase();

  let override: Partial<AdcDivisionBenchmark> | undefined;
  if (packOverrides) {
    const entries = Object.entries(packOverrides);
    // Full division ("PLATINUM IV") wins over the bare tier ("PLATINUM").
    override =
      entries.find(([k]) => k.trim().toUpperCase() === wantedFull)?.[1] ??
      entries.find(([k]) => k.trim().toUpperCase() === tier)?.[1];
  }

  const benchmark: AdcDivisionBenchmark = { ...base };
  const calibratedKeys: AdcKpiKey[] = [];
  if (override) {
    for (const key of ADC_KPI_KEYS) {
      const v = override[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        benchmark[key] = v;
        calibratedKeys.push(key);
      }
    }
  }

  return {
    tier,
    benchmark,
    isProvisional: calibratedKeys.length < ADC_KPI_KEYS.length,
    calibratedKeys,
  };
}

function summaryMetric(s: AdcMatchSummary, metric: AdcKpiKey): number | null {
  const v = s[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function compareMetric(
  metric: AdcKpiKey,
  values: number[],
  target: number
): AdcBenchmarkComparison {
  const meta = ADC_KPI_META[metric];
  const sampleN = values.length;
  const current =
    sampleN === 0 ? 0 : roundTo(values.reduce((a, b) => a + b, 0) / sampleN, meta.decimals);

  let progressPct = 0;
  let status: AdcBenchmarkComparison['status'] = 'bottleneck';
  let gapText = '';

  if (sampleN === 0) {
    gapText = 'Sync ADC matches to measure';
  } else if (meta.lowerIsBetter) {
    if (current <= target) {
      progressPct = 100;
      status = 'on_track';
      gapText = 'Target met';
    } else {
      progressPct = Math.max(15, Math.min(99, Math.round((target / Math.max(current, 0.05)) * 100)));
      status = current <= target + 0.3 ? 'close' : 'bottleneck';
      gapText = `${roundTo(current - target, 2)} too high`;
    }
  } else if (metric === 'goldDiffAt15') {
    if (current >= target) {
      progressPct = 100;
      status = 'on_track';
      gapText = `+${Math.round(current - target)}g ahead`;
    } else {
      // Shift so negative tier targets (e.g. SILVER -220g) still produce a sane ratio.
      const shift = 1000;
      progressPct = Math.max(
        10,
        Math.min(99, Math.round((Math.max(0, current + shift) / (target + shift)) * 100))
      );
      status = target - current <= 150 ? 'close' : 'bottleneck';
      gapText = `${Math.round(target - current)}g below target`;
    }
  } else if (current >= target) {
    progressPct = 100;
    status = 'on_track';
    gapText = 'Target met';
  } else {
    progressPct = Math.max(10, Math.min(99, Math.round((current / Math.max(target, 0.01)) * 100)));
    status = progressPct >= 88 ? 'close' : 'bottleneck';
    gapText = `${roundTo(target - current, meta.decimals)} ${meta.unit} below`;
  }

  return {
    metric,
    label: meta.label,
    unit: meta.unit,
    currentValue: current,
    targetValue: target,
    lowerIsBetter: meta.lowerIsBetter,
    status,
    gapText,
    progressPct,
    sampleN,
  };
}

/** Benchmark evaluation over ADC summaries (non-ADC / short games are dropped here too). */
export function evaluateAdcSummaries(
  summaries: ReadonlyArray<AdcMatchSummary>,
  targetDivision: string,
  packOverrides?: AdcBenchmarkOverrides
): AdcDivisionEvaluation {
  const resolved = resolveAdcBenchmark(targetDivision, packOverrides);
  const recent = summaries
    .filter((s) => isAdcMatch(s) && s.durationSeconds >= ADC_MIN_VALID_MATCH_SECONDS)
    .sort((a, b) => safePlayedAtMs(b.playedAt) - safePlayedAtMs(a.playedAt))
    .slice(0, RECENT_WINDOW);

  const comparisons = ADC_KPI_KEYS.map((metric) =>
    compareMetric(
      metric,
      recent.map((s) => summaryMetric(s, metric)).filter((v): v is number => v !== null),
      resolved.benchmark[metric]
    )
  );

  const measured = comparisons.filter((c) => c.sampleN > 0);
  const overallReadinessPct =
    measured.length === 0
      ? 0
      : Math.round(measured.reduce((acc, c) => acc + c.progressPct, 0) / measured.length);
  const wins = recent.filter((m) => m.win).length;

  return {
    role: 'bottom',
    targetTier: resolved.tier,
    matchCount: recent.length,
    winRatePct: recent.length > 0 ? Math.round((wins / recent.length) * 100) : 0,
    overallReadinessPct,
    comparisons,
    benchmark: resolved.benchmark,
    isProvisional: resolved.isProvisional,
  };
}

/**
 * Evaluates the most recent 15 ADC matches against the target division. Jungle and Off-Role
 * matches are filtered out before any KPI is averaged.
 */
export function evaluateAdcDivisionBenchmarks(
  matches: ReadonlyArray<MatchV5Detail>,
  targetDivision: string,
  packOverrides?: AdcBenchmarkOverrides
): AdcDivisionEvaluation {
  const summaries = matches.filter(isAdcMatch).map((m) => toAdcMatchSummary(m));
  return evaluateAdcSummaries(summaries, targetDivision, packOverrides);
}

/**
 * Proposes up to 3 `role: 'bottom'` Climb goals from the weakest measured ADC KPIs.
 * Returns `[]` when there is no ADC evidence yet (no goals invented from zero samples).
 */
export function generateAutoAdcClimbGoals(
  summaries: ReadonlyArray<AdcMatchSummary>,
  targetDivision: string,
  packOverrides?: AdcBenchmarkOverrides,
  nowIso: string = new Date().toISOString()
): Array<ClimbGoal & { role: 'bottom' }> {
  const evaluation = evaluateAdcSummaries(summaries, targetDivision, packOverrides);
  if (evaluation.matchCount === 0) return [];

  return evaluation.comparisons
    .filter((c) => c.sampleN > 0 && c.status !== 'on_track')
    .sort((a, b) => a.progressPct - b.progressPct)
    .slice(0, 3)
    .map((c) => {
      const meta = ADC_KPI_META[c.metric];
      return {
        id: `auto-adc-${evaluation.targetTier.toLowerCase()}-${c.metric}`,
        role: 'bottom' as const,
        targetDivision,
        metric: c.metric,
        title: meta.goalTemplate.replace('{target}', String(c.targetValue)),
        targetValue: c.targetValue,
        currentValue: c.currentValue,
        unit: c.unit,
        lowerIsBetter: c.lowerIsBetter,
        status: 'active' as const,
        source: 'auto' as const,
        createdAt: nowIso,
      };
    });
}
