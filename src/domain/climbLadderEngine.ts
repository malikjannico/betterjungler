import type {
  ClimbGoal,
  DivisionBenchmarkComparison,
  DivisionTier,
  JungleKpiKey,
} from '../types/coaching';
import type { MatchSummaryRecord } from '../types/riot';

export interface DivisionBenchmarkProfile {
  csPerMin: number;
  goldDiffAt15: number;
  objectiveSharePct: number;
  preObjectiveDeaths: number;
  earlyDeaths: number;
  visionPerMin: number;
  killParticipationPct: number;
}

export const DIVISION_BENCHMARKS: Record<DivisionTier, DivisionBenchmarkProfile> = {
  IRON: { csPerMin: 5.0, goldDiffAt15: -150, objectiveSharePct: 45, preObjectiveDeaths: 1.8, earlyDeaths: 1.6, visionPerMin: 0.55, killParticipationPct: 48 },
  BRONZE: { csPerMin: 5.4, goldDiffAt15: 0, objectiveSharePct: 48, preObjectiveDeaths: 1.5, earlyDeaths: 1.4, visionPerMin: 0.65, killParticipationPct: 50 },
  SILVER: { csPerMin: 5.8, goldDiffAt15: 100, objectiveSharePct: 52, preObjectiveDeaths: 1.2, earlyDeaths: 1.2, visionPerMin: 0.75, killParticipationPct: 53 },
  GOLD: { csPerMin: 6.2, goldDiffAt15: 200, objectiveSharePct: 55, preObjectiveDeaths: 0.9, earlyDeaths: 1.0, visionPerMin: 0.85, killParticipationPct: 56 },
  PLATINUM: { csPerMin: 6.6, goldDiffAt15: 300, objectiveSharePct: 58, preObjectiveDeaths: 0.6, earlyDeaths: 0.9, visionPerMin: 0.95, killParticipationPct: 59 },
  EMERALD: { csPerMin: 6.9, goldDiffAt15: 400, objectiveSharePct: 60, preObjectiveDeaths: 0.45, earlyDeaths: 0.75, visionPerMin: 1.05, killParticipationPct: 62 },
  DIAMOND: { csPerMin: 7.2, goldDiffAt15: 500, objectiveSharePct: 63, preObjectiveDeaths: 0.3, earlyDeaths: 0.6, visionPerMin: 1.15, killParticipationPct: 65 },
  MASTER: { csPerMin: 7.5, goldDiffAt15: 650, objectiveSharePct: 66, preObjectiveDeaths: 0.2, earlyDeaths: 0.5, visionPerMin: 1.25, killParticipationPct: 68 },
};

export const KPI_META: Record<
  JungleKpiKey,
  { label: string; unit: string; lowerIsBetter: boolean; goalTemplate: string }
> = {
  csPerMin: {
    label: 'Jungle Farm Tempo',
    unit: 'CS/m',
    lowerIsBetter: false,
    goalTemplate: 'Maintain >= {target} CS/min across ranked games',
  },
  goldDiffAt15: {
    label: 'Early Gold Lead @15',
    unit: 'g',
    lowerIsBetter: false,
    goalTemplate: 'Average >= +{target}g Gold Diff @ 15m',
  },
  objectiveSharePct: {
    label: 'Objective Control Share',
    unit: '%',
    lowerIsBetter: false,
    goalTemplate: 'Control >= {target}% of Dragons, Grubs, Herald & Baron',
  },
  preObjectiveDeaths: {
    label: 'Pre-Objective Deaths',
    unit: '/game',
    lowerIsBetter: true,
    goalTemplate: 'Keep Pre-Objective Deaths <= {target}/game',
  },
  earlyDeaths: {
    label: 'Early Deaths (<10m)',
    unit: '/game',
    lowerIsBetter: true,
    goalTemplate: 'Keep Early Deaths (<10m) <= {target}/game',
  },
  visionPerMin: {
    label: 'Vision Score / Min',
    unit: '/m',
    lowerIsBetter: false,
    goalTemplate: 'Reach >= {target} Vision Score/min with regular Control Wards',
  },
  killParticipationPct: {
    label: 'Kill Participation',
    unit: '%',
    lowerIsBetter: false,
    goalTemplate: 'Impact >= {target}% of team kills via strong-side pathing',
  },
};

export const MIN_GOAL_COMPLETION_GAMES = 10;

export function isGoalTargetMet(
  goal: ClimbGoal,
  comparisons: DivisionBenchmarkComparison[],
  matchCountOrHasMatches: number | boolean = comparisons.some(
    (c) => c.gapText !== 'Sync matches to measure'
  )
): boolean {
  const sampleCount =
    typeof matchCountOrHasMatches === 'number'
      ? matchCountOrHasMatches
      : matchCountOrHasMatches
        ? MIN_GOAL_COMPLETION_GAMES
        : 0;
  if (sampleCount < MIN_GOAL_COMPLETION_GAMES) return false;
  const matchComp = comparisons.find((c) => c.metric === goal.metric);
  if (!matchComp) return false;
  return goal.lowerIsBetter
    ? matchComp.currentValue <= goal.targetValue
    : matchComp.currentValue >= goal.targetValue;
}

export function syncGoalsWithRollingProgress(
  goals: ClimbGoal[],
  comparisons: DivisionBenchmarkComparison[],
  matchCountOrHasMatches: number | boolean = comparisons.some(
    (c) => c.gapText !== 'Sync matches to measure'
  )
): ClimbGoal[] {
  const hasMatches =
    typeof matchCountOrHasMatches === 'number'
      ? matchCountOrHasMatches > 0
      : matchCountOrHasMatches;
  return goals.map((goal) => {
    const matchComp = comparisons.find((c) => c.metric === goal.metric);
    if (!matchComp || !hasMatches) return goal;
    const met = isGoalTargetMet(goal, comparisons, matchCountOrHasMatches);
    return {
      ...goal,
      currentValue: matchComp.currentValue,
      status: met ? 'completed' : goal.status,
    };
  });
}

export function parseTargetTier(targetDivision: string): DivisionTier {
  const upper = targetDivision.toUpperCase();
  const tiers: DivisionTier[] = [
    'MASTER',
    'DIAMOND',
    'EMERALD',
    'PLATINUM',
    'GOLD',
    'SILVER',
    'BRONZE',
    'IRON',
  ];
  return tiers.find((t) => upper.includes(t)) ?? 'PLATINUM';
}

function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export interface DivisionProgressEvaluation {
  targetTier: DivisionTier;
  matchCount: number;
  winRatePct: number;
  overallReadinessPct: number;
  comparisons: DivisionBenchmarkComparison[];
  suggestedGoals: ClimbGoal[];
}

export function evaluateDivisionProgress(
  summaries: MatchSummaryRecord[],
  targetDivision: string
): DivisionProgressEvaluation {
  const targetTier = parseTargetTier(targetDivision);
  const bench = DIVISION_BENCHMARKS[targetTier];
  const recent = summaries.slice(0, 15);
  const count = recent.length;

  const avg = (getter: (m: MatchSummaryRecord) => number, decimals: number) => {
    if (count === 0) return 0;
    const sum = recent.reduce((acc, m) => acc + getter(m), 0);
    return roundTo(sum / count, decimals);
  };

  const currentMap: Record<Exclude<JungleKpiKey, 'earlyDeaths'>, number> = {
    csPerMin: avg((m) => m.csPerMin, 1),
    goldDiffAt15: avg((m) => m.goldDiffAt15, 0),
    objectiveSharePct: avg((m) => m.objectiveSharePct, 0),
    preObjectiveDeaths: avg((m) => m.preObjectiveDeaths, 2),
    visionPerMin: avg((m) => m.visionPerMin, 2),
    killParticipationPct: avg((m) => m.killParticipationPct, 0),
  };

  const keys: Array<Exclude<JungleKpiKey, 'earlyDeaths'>> = [
    'preObjectiveDeaths',
    'csPerMin',
    'objectiveSharePct',
    'goldDiffAt15',
    'visionPerMin',
    'killParticipationPct',
  ];

  const comparisons: DivisionBenchmarkComparison[] = keys.map((metric) => {
    const meta = KPI_META[metric];
    const current = currentMap[metric];
    const target = bench[metric];

    let progressPct = 0;
    let status: DivisionBenchmarkComparison['status'] = 'bottleneck';
    let gapText = '';

    if (count === 0) {
      progressPct = 0;
      status = 'bottleneck';
      gapText = 'Sync matches to measure';
    } else if (meta.lowerIsBetter) {
      if (current <= target) {
        progressPct = 100;
        status = 'on_track';
        gapText = 'Target met';
      } else {
        const ratio = target / Math.max(current, 0.05);
        progressPct = Math.max(15, Math.min(99, Math.round(ratio * 100)));
        status = current <= target + 0.3 ? 'close' : 'bottleneck';
        gapText = `${roundTo(current - target, 2)} too high`;
      }
    } else if (metric === 'goldDiffAt15') {
      if (current >= target) {
        progressPct = 100;
        status = 'on_track';
        gapText = `+${Math.round(current - target)}g ahead`;
      } else {
        const shiftedCur = current + 600;
        const shiftedTarget = target + 600;
        progressPct = Math.max(10, Math.min(99, Math.round((shiftedCur / shiftedTarget) * 100)));
        status = target - current <= 150 ? 'close' : 'bottleneck';
        gapText = `${Math.round(target - current)}g below target`;
      }
    } else {
      if (current >= target) {
        progressPct = 100;
        status = 'on_track';
        gapText = 'Target met';
      } else {
        progressPct = Math.max(10, Math.min(99, Math.round((current / Math.max(target, 0.01)) * 100)));
        status = progressPct >= 88 ? 'close' : 'bottleneck';
        gapText = `${roundTo(target - current, metric === 'visionPerMin' ? 2 : 1)} ${meta.unit} below`;
      }
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
    };
  });

  const overallReadinessPct =
    count === 0
      ? 0
      : Math.round(
          comparisons.reduce((acc, c) => acc + c.progressPct, 0) / comparisons.length
        );

  const wins = recent.filter((m) => m.win).length;
  const winRatePct = count > 0 ? Math.round((wins / count) * 100) : 0;

  // Suggest top 3 bottlenecks sorted by lowest progressPct
  const nowIso = new Date().toISOString();
  const suggestedGoals: ClimbGoal[] = [...comparisons]
    .filter((c) => c.status !== 'on_track')
    .sort((a, b) => a.progressPct - b.progressPct)
    .slice(0, 3)
    .map((c) => {
      const meta = KPI_META[c.metric];
      return {
        id: `auto-${targetTier.toLowerCase()}-${c.metric}`,
        targetDivision,
        metric: c.metric,
        title: meta.goalTemplate.replace('{target}', String(c.targetValue)),
        targetValue: c.targetValue,
        currentValue: c.currentValue,
        unit: c.unit,
        lowerIsBetter: c.lowerIsBetter,
        status: 'active',
        source: 'auto',
        createdAt: nowIso,
      };
    });

  return {
    targetTier,
    matchCount: count,
    winRatePct,
    overallReadinessPct,
    comparisons,
    suggestedGoals,
  };
}

/**
 * Toggles a single Match Focus goal across the active goal list (at most one active focus).
 */
export function setSingleFocusGoal(goals: ClimbGoal[], goalId: string | null): ClimbGoal[] {
  return goals.map((goal) => ({
    ...goal,
    isFocusGoal: goalId !== null && goal.id === goalId && !goal.isFocusGoal,
  }));
}

export interface FocusGoalMatchEvaluation {
  passed: boolean;
  actualValue: number;
  targetValue: number;
  deltaLabel: string;
}

/**
 * Grades a Match Focus goal directly against a completed Post-Game Review report.
 */
export function evaluateFocusGoalAgainstMatch(
  goal: ClimbGoal,
  kpis: {
    csPerMin: number;
    goldDiffAt15: number;
    objectiveSharePct: number;
    preObjectiveDeaths: number;
    earlyDeaths?: number;
    visionPerMin: number;
    killParticipationPct: number;
  }
): FocusGoalMatchEvaluation {
  const raw = kpis[goal.metric];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      passed: false,
      actualValue: 0,
      targetValue: goal.targetValue,
      deltaLabel: 'Metric unavailable',
    };
  }
  const decimals =
    goal.metric === 'visionPerMin' ||
    goal.metric === 'preObjectiveDeaths' ||
    goal.metric === 'earlyDeaths'
      ? 2
      : goal.metric === 'csPerMin'
        ? 1
        : 0;
  const actualValue = roundTo(raw, decimals);
  const passed = goal.lowerIsBetter
    ? actualValue <= goal.targetValue
    : actualValue >= goal.targetValue;
  const diff = actualValue - goal.targetValue;
  const roundedDiff = roundTo(Math.abs(diff), decimals);
  const unitSuffix = goal.unit ? ` ${goal.unit}` : '';
  const deltaLabel = passed
    ? goal.lowerIsBetter
      ? `Cleared target (${actualValue} <= ${goal.targetValue}${unitSuffix})`
      : `Cleared target (${actualValue} >= ${goal.targetValue}${unitSuffix})`
    : goal.lowerIsBetter
      ? `${roundedDiff}${unitSuffix} above limit`
      : `${roundedDiff}${unitSuffix} short`;

  return {
    passed,
    actualValue,
    targetValue: goal.targetValue,
    deltaLabel,
  };
}

const SESSION_TILT_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Returns true when the three most recent recorded matches are consecutive losses
 * within a single session window (4h span when match timestamps are available).
 */
export function isSessionTilting(
  matches: ReadonlyArray<{ win: boolean; playedAt?: string }>,
  referenceNowMs = Date.now()
): boolean {
  if (matches.length < 3) return false;
  const hasAllDates = matches.every((m) => m.playedAt && !Number.isNaN(Date.parse(m.playedAt)));
  const ordered = hasAllDates
    ? [...matches].sort(
        (a, b) => Date.parse(b.playedAt!) - Date.parse(a.playedAt!)
      )
    : matches;
  const lastThree = ordered.slice(0, 3);
  if (!lastThree.every((match) => !match.win)) return false;
  if (hasAllDates) {
    const newestMs = Date.parse(lastThree[0]!.playedAt!);
    const oldestInStreakMs = Date.parse(lastThree[2]!.playedAt!);
    if (
      newestMs - oldestInStreakMs > SESSION_TILT_WINDOW_MS ||
      referenceNowMs - newestMs > SESSION_TILT_WINDOW_MS
    ) {
      return false;
    }
  }
  return true;
}
