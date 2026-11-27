/**
 * Types for the ADC (role: 'bottom') benchmarks, mistake detectors, post-game review and
 * personal-learning engines. Kept separate from `./types` (draft/win-plan types) and from the
 * Jungle types in `../../types/coaching`, which are reused read-only and never widened, so the
 * Jungle `Record<MistakeDetectorId, …>` / `Record<JungleKpiKey, …>` tables stay exhaustive.
 */
import type {
  AdcDivisionBenchmark,
  AdcKpiKey,
  DivisionTier,
  MistakeSignatureInsight,
  NormalizedMapPoint,
  ReviewFinding,
  TimelineMapMarker,
  TimelineMarkerKind,
  ClimbGoal,
} from '../../types/coaching';
import type { AdcPostGameKpi } from './types';

/** Pack-supplied calibrated benchmarks, keyed by tier (`"PLATINUM"`) or full division (`"PLATINUM IV"`). */
export type AdcBenchmarkOverrides =
  | Readonly<Record<string, Partial<AdcDivisionBenchmark> | undefined>>
  | null
  | undefined;

export interface ResolvedAdcBenchmark {
  tier: DivisionTier;
  benchmark: AdcDivisionBenchmark;
  /** `true` unless every one of the 7 KPIs was calibrated by the patch pack. */
  isProvisional: boolean;
  calibratedKeys: AdcKpiKey[];
}

export type AdcGoldDiffSource = 'lane_opponent' | 'enemy_jungler_fallback' | 'unavailable';

/** Per-match ADC KPIs. `null` = not measurable for this match (too short / missing data). */
export interface AdcMatchKpis {
  csAt10: number | null;
  csAt10Minute: number | null;
  csPerMin: number;
  goldDiffAt15: number | null;
  goldDiffSource: AdcGoldDiffSource;
  damageSharePct: number | null;
  damagePerMin: number | null;
  deathsPre14: number;
  turretPlates: number;
  level2TimeSec: number | null;
  killParticipationPct: number;
}

/** Compact ADC match record (the ADC analogue of `MatchSummaryRecord`). */
export interface AdcMatchSummary {
  matchId: string;
  playedAt: string;
  role: string;
  championId: number;
  championName: string;
  win: boolean;
  durationSeconds: number;
  csAt10: number | null;
  csPerMin: number;
  goldDiffAt15: number | null;
  damageSharePct: number | null;
  deathsPre14: number;
  turretPlates: number;
  killParticipationPct: number;
}

export interface AdcBenchmarkComparison {
  metric: AdcKpiKey;
  label: string;
  unit: string;
  currentValue: number;
  targetValue: number;
  lowerIsBetter: boolean;
  status: 'on_track' | 'close' | 'bottleneck';
  gapText: string;
  progressPct: number;
  /** Matches that actually produced this metric (e.g. CS@10 needs a 10:00 frame). */
  sampleN: number;
}

export interface AdcDivisionEvaluation {
  role: 'bottom';
  targetTier: DivisionTier;
  matchCount: number;
  winRatePct: number;
  overallReadinessPct: number;
  comparisons: AdcBenchmarkComparison[];
  benchmark: AdcDivisionBenchmark;
  isProvisional: boolean;
}

export type AdcMistakeDetectorId =
  | 'adc_cs_deficit_10'
  | 'adc_lane_death_pre_14'
  | 'adc_low_damage_share'
  | 'adc_pre_obj_death'
  | 'adc_isolated_death';

export interface AdcMistakeHit {
  detectorId: AdcMistakeDetectorId;
  timestampSec: number;
  /** Every matching timestamp, chronological (e.g. each pre-objective death). */
  allTimestampsSec: number[];
}

export type AdcMistakeSignatureInsight = Omit<MistakeSignatureInsight, 'detectorId' | 'metric'> & {
  role: 'bottom';
  detectorId: AdcMistakeDetectorId;
  metric: AdcKpiKey;
};

export interface AdcPersonalBaselineMetric {
  metric: AdcKpiKey;
  ewmValue: number;
  shrunkBaseline: number;
  priorTarget: number;
  effectiveN: number;
  p25: number;
  p50: number;
  p75: number;
  trendDelta: number;
}

export interface AdcProposedFocusGoal {
  goal: ClimbGoal & { role: 'bottom' };
  reason: string;
  sourceDetectorId: AdcMistakeDetectorId;
}

export interface AdcPersonalLearningSnapshot {
  role: 'bottom';
  adcMatchCount: number;
  /** Matches dropped because they were Jungle / Off-Role / too short. */
  excludedMatchCount: number;
  isProvisional: boolean;
  usedSqlDepth: boolean;
  baselines: Record<AdcKpiKey, AdcPersonalBaselineMetric>;
  signatures: AdcMistakeSignatureInsight[];
  proposedFocus: AdcProposedFocusGoal | null;
}

export type AdcTimelineMarkerKind = TimelineMarkerKind | 'isolated_death' | 'plate';

export type AdcTimelineMarker = Omit<TimelineMapMarker, 'kind'> & { kind: AdcTimelineMarkerKind };

export interface AdcPostGameReviewReport {
  role: 'bottom';
  /** `false` for Jungle / Off-Role matches: no grade, no detectors, KPIs informational only. */
  isAdc: boolean;
  matchId: string;
  championName: string;
  laneOpponentName: string;
  win: boolean;
  durationSeconds: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'N/A';
  /** Raw 0..~100 grade points before letter bucketing. */
  gradePoints: number;
  targetTier: DivisionTier;
  isProvisional: boolean;
  kpis: AdcMatchKpis;
  kpiBreakdown: AdcPostGameKpi[];
  highlights: ReviewFinding[];
  mistakes: ReviewFinding[];
  improvements: ReviewFinding[];
  mistakeHits: AdcMistakeHit[];
  focusSuggestion?: AdcKpiKey;
  pathPoints: NormalizedMapPoint[];
  laneOpponentPathPoints: NormalizedMapPoint[];
  markers: AdcTimelineMarker[];
}
