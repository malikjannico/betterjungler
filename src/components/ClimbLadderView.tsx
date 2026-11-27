import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Crosshair,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
  Trees,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { findJungleChampionById } from '../data/jungleKnowledgePack';
import {
  ADC_KPI_KEYS,
  ADC_KPI_META,
  evaluateAdcDivisionBenchmarks,
  generateAutoAdcClimbGoals,
} from '../domain/adc/adcBenchmarks';
import { computeAdcPersonalLearningSnapshot } from '../domain/adc/adcDetectors';
import { isAdcMatch, toAdcMatchSummary } from '../domain/adc/adcKpis';
import type { AdcBenchmarkComparison, AdcBenchmarkOverrides } from '../domain/adc/adcReviewTypes';
import { formatChampionName } from '../domain/championNames';
import { computePersonalLearningSnapshot } from '../domain/personalLearningEngine';
import {
  DIVISION_BENCHMARKS,
  KPI_META,
  MIN_GOAL_COMPLETION_GAMES,
  evaluateDivisionProgress,
  isGoalTargetMet,
  isSessionTilting,
  syncGoalsWithRollingProgress,
} from '../domain/climbLadderEngine';
import type { CoachedRole } from '../domain/roles/types';
import type { EmptyReason, RoleResolutionSource } from '../domain/sessionContext';
import type {
  AdcKpiKey,
  ClimbGoal,
  DivisionBenchmarkComparison,
  HighEloMetaSnapshot,
  JungleKpiKey,
  LpHistoryPoint,
  SqlPersonalLearningSummary,
} from '../types/coaching';
import type {
  MatchSummaryRecord,
  MatchV5Detail,
  SummonerProfileSummary,
} from '../types/riot';
import { ClimbTrendCharts } from './ClimbTrendCharts';
import { EmptyState } from './EmptyState';
import { M3Button, M3Card, M3Chip, M3ListItem, M3SegmentedButton, formatRankLine } from './m3';
import type { M3ChipTone } from './m3';
import { PersonalLearningPanel } from './PersonalLearningPanel';

interface ClimbLadderViewProps {
  summonerProfile: SummonerProfileSummary | null;
  targetDivision: string;
  summaries: MatchSummaryRecord[];
  matches: MatchV5Detail[];
  allMatchesForSessions?: MatchV5Detail[];
  sqlPersonalLearning?: SqlPersonalLearningSummary | null;
  offRoleExcludedCount?: number;
  lpHistory: LpHistoryPoint[];
  patchVersion: string;
  goals: ClimbGoal[];
  highEloMeta: HighEloMetaSnapshot | null;
  canSyncLive: boolean;
  accountReady?: boolean;
  emptyReason?: EmptyReason | null;
  hasVerifiedKey?: boolean;
  hasTestedHud?: boolean;
  overlayHotkey?: string;
  onUpsertGoal: (goal: ClimbGoal) => Promise<void>;
  onDeleteGoal: (goalId: string) => Promise<void>;
  onSetFocusGoal?: (goalId: string) => Promise<void>;
  onAdoptFocusGoal?: (goal: ClimbGoal) => Promise<void>;
  onRefreshHighElo: () => Promise<void>;
  onSyncMatches?: () => Promise<void>;
  onOpenSettings?: () => void;
  onTestHud?: () => void;
  /** Coached role whose benchmarks/goals are shown. Defaults to Jungle. */
  activeRole?: CoachedRole;
  roleSource?: RoleResolutionSource;
  /** Manual Jungle | ADC override. Falls back to local state when omitted. */
  onSelectRole?: (role: CoachedRole) => void;
  adcMatches?: MatchV5Detail[];
  adcOffRoleExcludedCount?: number;
  adcSqlPersonalLearning?: SqlPersonalLearningSummary | null;
  roleBenchmarks?: AdcBenchmarkOverrides;
}

const KPI_OPTIONS: JungleKpiKey[] = [
  'preObjectiveDeaths',
  'csPerMin',
  'objectiveSharePct',
  'goldDiffAt15',
  'visionPerMin',
  'killParticipationPct',
];

const ADC_PROVISIONAL_MIN_GAMES = 10;

const ROLE_SOURCE_LABEL: Record<RoleResolutionSource, string> = {
  manual: 'Manual',
  lcu: 'Auto · League Client',
  spell_heuristic: 'Auto · Summoner spells',
  settings: 'Primary role',
  default: 'Default',
};

const STATUS_CHIP: Record<
  'on_track' | 'close' | 'bottleneck',
  { label: string; tone: M3ChipTone; bar: string }
> = {
  on_track: { label: 'On track', tone: 'success', bar: 'var(--md-ext-success)' },
  close: { label: 'Close', tone: 'warning', bar: 'var(--md-ext-warning)' },
  bottleneck: { label: 'Behind', tone: 'error', bar: 'var(--md-sys-color-error)' },
};

/** Common shape of Jungle and ADC benchmark comparisons for the KPI matrix. */
interface MatrixRow {
  metric: string;
  label: string;
  unit: string;
  currentValue: number;
  targetValue: number;
  lowerIsBetter: boolean;
  status: 'on_track' | 'close' | 'bottleneck';
  gapText: string;
  progressPct: number;
  sampleN?: number;
  baseline?: { shrunkBaseline: number; p25: number; p75: number } | null;
}

function goalRole(goal: ClimbGoal): CoachedRole {
  return goal.role ?? 'jungle';
}

function isAdcGoalMet(goal: ClimbGoal, comparisons: AdcBenchmarkComparison[], matchCount: number) {
  if (matchCount < MIN_GOAL_COMPLETION_GAMES) return false;
  const comp = comparisons.find((c) => c.metric === goal.metric);
  if (!comp || comp.sampleN === 0) return false;
  return goal.lowerIsBetter
    ? comp.currentValue <= goal.targetValue
    : comp.currentValue >= goal.targetValue;
}

function syncAdcGoals(
  goals: ClimbGoal[],
  comparisons: AdcBenchmarkComparison[],
  matchCount: number
): ClimbGoal[] {
  return goals.map((goal) => {
    const comp = comparisons.find((c) => c.metric === goal.metric);
    if (!comp || comp.sampleN === 0 || matchCount === 0) return goal;
    return {
      ...goal,
      currentValue: comp.currentValue,
      status: isAdcGoalMet(goal, comparisons, matchCount) ? 'completed' : goal.status,
    };
  });
}

function goalProgressPct(goal: ClimbGoal): number {
  const { currentValue: cur, targetValue: target } = goal;
  if (goal.lowerIsBetter) {
    if (cur <= target) return 100;
    return Math.max(8, Math.min(99, Math.round((target / Math.max(cur, 0.05)) * 100)));
  }
  if (cur >= target) return 100;
  if (target <= 0) {
    // Negative / zero targets (e.g. gold diff) — shift onto a positive scale.
    const shift = 1000;
    return Math.max(8, Math.min(99, Math.round((Math.max(0, cur + shift) / (target + shift)) * 100)));
  }
  return Math.max(8, Math.min(99, Math.round((cur / target) * 100)));
}

function LinearProgress({ pct, color, label }: { pct: number; color: string; label: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className="flex h-1.5 w-full items-center gap-1"
    >
      <span
        className="h-full min-w-1.5 rounded-full transition-[width] duration-700 motion-reduce:transition-none"
        style={{ width: `${v}%`, background: color }}
      />
      {v < 100 && <span className="h-full flex-1 rounded-full bg-[var(--md-sys-color-secondary-container)]" />}
    </div>
  );
}

export function ClimbLadderView({
  summonerProfile,
  targetDivision,
  summaries,
  matches,
  allMatchesForSessions,
  sqlPersonalLearning,
  offRoleExcludedCount = 0,
  lpHistory,
  patchVersion,
  goals,
  highEloMeta,
  canSyncLive,
  accountReady = Boolean(summonerProfile) || matches.length > 0,
  emptyReason = null,
  hasVerifiedKey = false,
  hasTestedHud = false,
  overlayHotkey = 'Alt+J',
  onUpsertGoal,
  onDeleteGoal,
  onSetFocusGoal,
  onAdoptFocusGoal,
  onRefreshHighElo,
  onSyncMatches,
  onOpenSettings,
  onTestHud,
  activeRole,
  roleSource,
  onSelectRole,
  adcMatches,
  adcOffRoleExcludedCount = 0,
  adcSqlPersonalLearning = null,
  roleBenchmarks,
}: ClimbLadderViewProps) {
  const [localRole, setLocalRole] = useState<CoachedRole>(activeRole ?? 'jungle');
  const role: CoachedRole = onSelectRole ? (activeRole ?? 'jungle') : localRole;
  const isAdc = role === 'bottom';

  const [customMetric, setCustomMetric] = useState<JungleKpiKey | AdcKpiKey>('csPerMin');
  const [customTarget, setCustomTarget] = useState<string>('6.8');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [showCustomGoalForm, setShowCustomGoalForm] = useState(false);
  const [showHighEloMeta, setShowHighEloMeta] = useState(false);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [syncingMatches, setSyncingMatches] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  function handleSelectRole(next: CoachedRole) {
    if (onSelectRole) onSelectRole(next);
    else setLocalRole(next);
    // Keep the custom-goal metric valid for the newly selected role.
    const valid = next === 'bottom'
      ? (ADC_KPI_KEYS as string[]).includes(customMetric)
      : (KPI_OPTIONS as string[]).includes(customMetric);
    if (!valid) setCustomMetric('csPerMin');
  }

  // ---- Jungle (unchanged math) ---------------------------------------------------------------
  const evaluation = useMemo(
    () => evaluateDivisionProgress(summaries, targetDivision),
    [summaries, targetDivision]
  );
  const jungleBench = DIVISION_BENCHMARKS[evaluation.targetTier];

  const sessionSourceMatches = allMatchesForSessions ?? matches;
  const personalLearning = useMemo(
    () =>
      computePersonalLearningSnapshot(
        matches,
        sessionSourceMatches,
        targetDivision,
        sqlPersonalLearning
      ),
    [matches, sessionSourceMatches, targetDivision, sqlPersonalLearning]
  );

  // ---- ADC (role-isolated) -------------------------------------------------------------------
  const adcMatchesList = useMemo(
    () => (adcMatches ?? []).filter(isAdcMatch),
    [adcMatches]
  );
  const adcEvaluation = useMemo(
    () => evaluateAdcDivisionBenchmarks(adcMatchesList, targetDivision, roleBenchmarks),
    [adcMatchesList, targetDivision, roleBenchmarks]
  );
  const adcSuggestedGoals = useMemo(
    () =>
      generateAutoAdcClimbGoals(
        adcMatchesList.map((m) => toAdcMatchSummary(m)),
        targetDivision,
        roleBenchmarks
      ),
    [adcMatchesList, targetDivision, roleBenchmarks]
  );
  const adcPersonalLearning = useMemo(() => {
    if (adcMatchesList.length === 0 && !adcSqlPersonalLearning) return null;
    const snap = computeAdcPersonalLearningSnapshot(
      adcMatchesList,
      targetDivision,
      adcSqlPersonalLearning,
      roleBenchmarks
    );
    return snap.adcMatchCount > 0 ? snap : null;
  }, [adcMatchesList, targetDivision, adcSqlPersonalLearning, roleBenchmarks]);

  // ---- Role-scoped view model ---------------------------------------------------------------
  const roleMatches = isAdc ? adcMatchesList : matches;
  const roleMatchCount = isAdc ? adcEvaluation.matchCount : evaluation.matchCount;
  const roleWinRate = isAdc ? adcEvaluation.winRatePct : evaluation.winRatePct;
  const roleTier = isAdc ? adcEvaluation.targetTier : evaluation.targetTier;
  const roleExcluded = isAdc ? adcOffRoleExcludedCount : offRoleExcludedCount;
  const roleNoun = isAdc ? 'ADC' : 'jungle';
  const hasMatches = isAdc ? adcMatchesList.length > 0 : summaries.length > 0;
  const adcSmallSample = isAdc && adcEvaluation.matchCount < ADC_PROVISIONAL_MIN_GAMES;
  const adcProvisional = isAdc && (adcEvaluation.isProvisional || adcSmallSample);

  const sessionTilting = useMemo(
    () => isSessionTilting(roleMatches.filter((m) => m.durationSeconds >= 300)),
    [roleMatches]
  );

  const matrixRows: MatrixRow[] = useMemo(() => {
    if (isAdc) {
      return adcEvaluation.comparisons.map((c) => {
        const b = adcPersonalLearning && adcPersonalLearning.adcMatchCount >= 2
          ? adcPersonalLearning.baselines[c.metric]
          : null;
        return { ...c, baseline: b };
      });
    }
    return evaluation.comparisons.map((c: DivisionBenchmarkComparison) => {
      const b =
        personalLearning && personalLearning.jungleMatchCount >= 2
          ? (personalLearning.baselines?.[c.metric] ?? null)
          : null;
      return { ...c, baseline: b };
    });
  }, [isAdc, adcEvaluation.comparisons, adcPersonalLearning, evaluation.comparisons, personalLearning]);

  const readinessPct = isAdc ? adcEvaluation.overallReadinessPct : evaluation.overallReadinessPct;

  const jungleGoals = useMemo(() => goals.filter((g) => goalRole(g) === 'jungle'), [goals]);
  const adcGoals = useMemo(() => goals.filter((g) => goalRole(g) === 'bottom'), [goals]);
  const syncedJungleGoals = useMemo(
    () => syncGoalsWithRollingProgress(jungleGoals, evaluation.comparisons, evaluation.matchCount),
    [jungleGoals, evaluation.comparisons, evaluation.matchCount]
  );
  const syncedAdcGoals = useMemo(
    () => syncAdcGoals(adcGoals, adcEvaluation.comparisons, adcEvaluation.matchCount),
    [adcGoals, adcEvaluation.comparisons, adcEvaluation.matchCount]
  );
  const roleGoals = isAdc ? syncedAdcGoals : syncedJungleGoals;
  const otherRoleGoalCount = isAdc ? jungleGoals.length : adcGoals.length;
  const suggestedGoals: ClimbGoal[] = isAdc ? adcSuggestedGoals : evaluation.suggestedGoals;

  const activeFocusGoalId =
    goals.find((g) => g.isFocusGoal && g.status === 'active')?.id ??
    goals.find((g) => g.isFocusGoal)?.id ??
    null;
  const focusGoal = useMemo(() => {
    if (!activeFocusGoalId) return null;
    return (
      [...syncedJungleGoals, ...syncedAdcGoals].find((g) => g.id === activeFocusGoalId) ??
      goals.find((g) => g.id === activeFocusGoalId) ??
      null
    );
  }, [activeFocusGoalId, syncedJungleGoals, syncedAdcGoals, goals]);

  const isGoalAutoMet = (goal: ClimbGoal) =>
    goalRole(goal) === 'bottom'
      ? isAdcGoalMet(goal, adcEvaluation.comparisons, adcEvaluation.matchCount)
      : isGoalTargetMet(goal, evaluation.comparisons, evaluation.matchCount);

  const recentResults = useMemo(
    () =>
      [...roleMatches]
        .sort((a, b) => (Date.parse(b.playedAt) || 0) - (Date.parse(a.playedAt) || 0))
        .slice(0, 8)
        .reverse(),
    [roleMatches]
  );

  const metricOptions: Array<{ key: JungleKpiKey | AdcKpiKey; label: string }> = isAdc
    ? ADC_KPI_KEYS.map((k) => ({ key: k, label: ADC_KPI_META[k].label }))
    : KPI_OPTIONS.map((k) => ({ key: k, label: KPI_META[k].label }));
  const effectiveMetric = metricOptions.some((o) => o.key === customMetric)
    ? customMetric
    : 'csPerMin';

  async function handleAdoptFocusGoal(goal: ClimbGoal) {
    if (onAdoptFocusGoal) {
      await onAdoptFocusGoal(goal);
      return;
    }
    const cleanGoal: ClimbGoal = { ...goal, isFocusGoal: !onSetFocusGoal };
    await onUpsertGoal(cleanGoal);
    if (onSetFocusGoal) {
      await onSetFocusGoal(cleanGoal.id);
    }
  }

  async function handlePinSuggested(goal: ClimbGoal) {
    await onUpsertGoal({ ...goal, role: goal.role ?? role });
  }

  async function handleToggleGoalStatus(goal: ClimbGoal) {
    await onUpsertGoal({
      ...goal,
      status: goal.status === 'active' ? 'completed' : 'active',
    });
  }

  async function handleAddCustomGoal(e: React.FormEvent) {
    e.preventDefault();
    if (customTarget.trim() === '') return;
    const targetNum = Number(customTarget);
    if (!Number.isFinite(targetNum)) return;

    let goal: ClimbGoal;
    if (isAdc) {
      const metric = effectiveMetric as AdcKpiKey;
      const meta = ADC_KPI_META[metric];
      const comp = adcEvaluation.comparisons.find((c) => c.metric === metric);
      goal = {
        id: `custom-adc-${Date.now()}`,
        role: 'bottom',
        targetDivision,
        metric,
        title: customTitle.trim() || meta.goalTemplate.replace('{target}', String(targetNum)),
        targetValue: targetNum,
        currentValue: comp?.currentValue ?? 0,
        unit: meta.unit,
        lowerIsBetter: meta.lowerIsBetter,
        status: 'active',
        source: 'custom',
        createdAt: new Date().toISOString(),
      };
    } else {
      const metric = effectiveMetric as JungleKpiKey;
      const meta = KPI_META[metric];
      const comp = evaluation.comparisons.find((c) => c.metric === metric);
      goal = {
        id: `custom-${Date.now()}`,
        role: 'jungle',
        targetDivision,
        metric,
        title: customTitle.trim() || meta.goalTemplate.replace('{target}', String(targetNum)),
        targetValue: targetNum,
        currentValue: comp?.currentValue ?? 0,
        unit: meta.unit,
        lowerIsBetter: meta.lowerIsBetter,
        status: 'active',
        source: 'custom',
        createdAt: new Date().toISOString(),
      };
    }

    await onUpsertGoal(goal);
    setCustomTitle('');
  }

  async function handleRefreshMeta() {
    setRefreshingMeta(true);
    setMetaError(null);
    try {
      await onRefreshHighElo();
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'High-Elo meta refresh failed.');
    } finally {
      setRefreshingMeta(false);
    }
  }

  async function handleSyncNow() {
    if (!onSyncMatches) return;
    setSyncingMatches(true);
    setSyncError(null);
    try {
      await onSyncMatches();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync Riot matches.');
    } finally {
      setSyncingMatches(false);
    }
  }

  const existingIds = new Set(goals.map((g) => g.id));

  // ---- Header (always visible so the role can be switched from the empty state too) ----------
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m3-headline-s text-[var(--md-sys-color-on-surface)]">Climb &amp; Goals</h2>
        <p className="m3-body-s mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
          Division pace, benchmarks, habits and your next Match Focus
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {roleSource && (
          <M3Chip size="sm" tone="plain" title="How the coached role was resolved">
            {ROLE_SOURCE_LABEL[roleSource]}
          </M3Chip>
        )}
        {isAdc && adcProvisional && (
          <M3Chip
            tone="warning"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="ADC benchmarks are provisional until calibrated and until 10 ADC games are synced."
          >
            Provisional
          </M3Chip>
        )}
        <M3SegmentedButton<CoachedRole>
          ariaLabel="Coached role"
          value={role}
          onChange={handleSelectRole}
          options={[
            {
              value: 'jungle',
              label: 'Jungle',
              icon: <Trees className="h-4 w-4" />,
              badge: String(summaries.length),
              title: 'Jungle benchmarks & goals',
            },
            {
              value: 'bottom',
              label: 'ADC',
              icon: <Crosshair className="h-4 w-4" />,
              badge: String(adcMatchesList.length),
              title: 'ADC (Bottom) benchmarks & goals',
            },
          ]}
        />
      </div>
    </div>
  );

  // ---- Honest unconfigured / empty match onboarding state ------------------------------------
  if (!hasMatches) {
    const offRoleOnly = isAdc
      ? adcOffRoleExcludedCount > 0 && accountReady
      : emptyReason === 'only_off_role_matches';
    return (
      <div className="space-y-4">
        {header}

        {summonerProfile && (
          <M3Card variant="module" className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">{summonerProfile.riotId}</div>
              <div className="m3-body-s num mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
                {summonerProfile.tier} {summonerProfile.rank} · {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
            <M3Chip size="sm" tone="plain">Target: {targetDivision}</M3Chip>
          </M3Card>
        )}

        <EmptyState
          icon={TrendingUp}
          title={
            offRoleOnly
              ? `No ranked ${roleNoun} matches in recent games`
              : !accountReady
                ? 'Connect League Client or your Riot ID to begin'
                : emptyReason === 'needs_api_key'
                  ? 'Save a Riot API key to sync Match-V5 history'
                  : `No ranked ${roleNoun} matches synced yet`
          }
          description={
            offRoleOnly
              ? `${roleExcluded} off-role ${roleExcluded === 1 ? 'game was' : 'games were'} synced. Climb benchmarks evaluate ${isAdc ? 'ADC (Bottom)' : 'Jungle'} games only — switch role above, inspect off-role stats in Post-Game Review, or sync more games.`
              : !accountReady
                ? `Open League of Legends for Keyless LCU live coaching, or save your Riot ID & Personal API Key in Settings to compute your rolling ${roleNoun} KPIs and climb goals.`
                : emptyReason === 'needs_api_key'
                  ? 'Your profile is detected via the League Client. Add a personal Riot API key in Settings to download Match-V5 timelines and benchmark your last 15 games.'
                  : isAdc
                    ? 'Sync your recent ranked ADC matches to inspect CS@10, damage share, lane deaths and bottleneck climb goals.'
                    : 'Sync your recent ranked jungle matches to inspect KPI trends, death heatmaps, and bottleneck climb goals.'
          }
          action={
            canSyncLive && onSyncMatches
              ? {
                  label: syncingMatches ? 'Syncing games...' : 'Sync Recent Games',
                  onClick: () => void handleSyncNow(),
                  disabled: syncingMatches,
                }
              : onOpenSettings
                ? {
                    label: 'Open Settings',
                    onClick: onOpenSettings,
                  }
                : undefined
          }
        >
          {!accountReady && (
            <div className="mt-4 grid gap-2.5 border-t border-[var(--md-sys-color-outline-variant)] pt-4 sm:grid-cols-3">
              <M3Card variant="module" className="flex items-start gap-2.5 p-3">
                {hasVerifiedKey ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--md-ext-success)]" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--md-sys-color-outline)]" />
                )}
                <div className="m3-body-s">
                  <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">Riot API Key</div>
                  <p className="mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
                    {hasVerifiedKey ? 'Verified & ready for Match-V5 sync.' : 'Optional key in Settings enables history sync.'}
                  </p>
                </div>
              </M3Card>

              <M3Card variant="module" className="flex items-start gap-2.5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--md-sys-color-primary)]" />
                <div className="m3-body-s">
                  <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">Borderless Video Mode</div>
                  <p className="mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
                    Set League Video Mode to Borderless or Windowed so the click-through HUD stays visible.
                  </p>
                </div>
              </M3Card>

              <M3Card variant="module" className="flex items-start gap-2.5 p-3">
                {hasTestedHud ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--md-ext-success)]" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--md-sys-color-outline)]" />
                )}
                <div className="m3-body-s">
                  <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">Compact HUD ({overlayHotkey})</div>
                  {!hasTestedHud && onTestHud ? (
                    <button
                      type="button"
                      onClick={onTestHud}
                      className="m3-focus-ring mt-1 rounded font-semibold text-[var(--md-sys-color-primary)] hover:underline"
                    >
                      Preview floating HUD →
                    </button>
                  ) : (
                    <p className="mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">Modular transparent HUD armed.</p>
                  )}
                </div>
              </M3Card>
            </div>
          )}

          {syncError && (
            <p
              role="alert"
              className="m3-body-s mt-3 rounded-[12px] bg-[var(--md-sys-color-error-container)] px-3 py-2 text-[var(--md-sys-color-on-error-container)]"
            >
              {syncError}
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  const focusPct = focusGoal ? goalProgressPct(focusGoal) : 0;
  const rankLine = summonerProfile
    ? formatRankLine(summonerProfile.tier, summonerProfile.rank, null)
    : null;

  return (
    <div className="space-y-4">
      {header}

      {sessionTilting && (
        <div
          role="status"
          className="m3-body-s flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--md-ext-warning-container)] px-4 py-2.5 text-[var(--md-ext-on-warning-container)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong className="font-semibold">Session Stop-Loss Guard:</strong> 3 consecutive
            ranked {roleNoun} losses detected. Consider a 10-minute reset and review your{' '}
            {isAdc ? 'lane deaths before 14:00' : 'pre-objective deaths'} before queueing again.
          </span>
        </div>
      )}

      {isAdc && adcSmallSample && (
        <div
          role="status"
          className="m3-body-s flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--md-ext-warning-container)] px-4 py-2.5 text-[var(--md-ext-on-warning-container)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong className="font-semibold">Provisional ADC sample:</strong>{' '}
            {adcEvaluation.matchCount}/{ADC_PROVISIONAL_MIN_GAMES} ranked ADC games. Benchmarks,
            mistake gates and goal auto-completion lock in at {ADC_PROVISIONAL_MIN_GAMES} games.
          </span>
        </div>
      )}

      {/* Row 1 — Division Hero Pace · Match Focus Goal */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <M3Card
          variant="tonal"
          as="section"
          aria-label="Division pace"
          className="flex flex-col gap-3 bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="m3-label-l flex items-center gap-1.5 uppercase tracking-wide">
                <TrendingUp className="h-4 w-4" />
                Division pace → {targetDivision}
              </div>
              {summonerProfile ? (
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="m3-display num">{summonerProfile.leaguePoints}</span>
                  <span className="m3-title-m">LP · {rankLine}</span>
                </div>
              ) : (
                <div className="m3-headline-s mt-1">{roleTier} benchmark</div>
              )}
            </div>
            <M3Chip size="sm" tone="primary">
              {isAdc ? 'ADC' : 'Jungle'}
            </M3Chip>
          </div>

          <div className="space-y-1">
            <LinearProgress
              pct={readinessPct}
              color="var(--md-sys-color-primary)"
              label={`${readinessPct}% ready for ${roleTier}`}
            />
            <div className="m3-label-m num flex justify-between">
              <span>{readinessPct}% KPI readiness</span>
              <span>{roleTier}</span>
            </div>
          </div>

          <p className="m3-body-m">
            Rolling last <b className="num font-bold">{roleMatchCount}</b> ranked {roleNoun}{' '}
            {roleMatchCount === 1 ? 'match' : 'matches'} at{' '}
            <b className="num font-bold">{roleWinRate}% WR</b>
            {roleMatchCount < MIN_GOAL_COMPLETION_GAMES && (
              <span>
                {' '}
                · {roleMatchCount}/{MIN_GOAL_COMPLETION_GAMES} games toward reliable goal lock-in
              </span>
            )}
            {roleExcluded > 0 && (
              <span>
                {' '}
                · {roleExcluded} off-role game{roleExcluded === 1 ? '' : 's'} excluded
              </span>
            )}
          </p>

          <div className="mt-auto grid grid-cols-3 gap-2">
            <div className="rounded-[16px] bg-[rgba(12,14,19,0.28)] px-3 py-2">
              <div className="m3-label-m">Games</div>
              <div className="m3-title-l num">{roleMatchCount}</div>
            </div>
            <div className="rounded-[16px] bg-[rgba(12,14,19,0.28)] px-3 py-2">
              <div className="m3-label-m">Win rate</div>
              <div className="m3-title-l num">{roleWinRate}%</div>
            </div>
            <div className="rounded-[16px] bg-[rgba(12,14,19,0.28)] px-3 py-2">
              <div className="m3-label-m">Record</div>
              <div className="m3-title-l num">
                {summonerProfile ? `${summonerProfile.wins}W ${summonerProfile.losses}L` : '—'}
              </div>
            </div>
          </div>
        </M3Card>

        <M3Card
          variant="tonal"
          as="section"
          aria-label="Match focus goal"
          className="flex flex-col gap-3 bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="m3-label-l flex items-center gap-1.5 uppercase tracking-wide">
              <Target className="h-4 w-4" />
              Match Focus
            </div>
            {focusGoal && (
              <M3Chip size="sm" tone="tertiary">
                {goalRole(focusGoal) === 'bottom' ? 'ADC' : 'Jungle'}
              </M3Chip>
            )}
          </div>

          {focusGoal ? (
            <>
              <div className="m3-title-l">{focusGoal.title}</div>
              <div className="space-y-1">
                <LinearProgress
                  pct={focusPct}
                  color="var(--md-sys-color-tertiary)"
                  label={`Focus goal ${focusPct}% complete`}
                />
                <div className="m3-label-m num flex justify-between">
                  <span>
                    Now {focusGoal.currentValue}
                    {focusGoal.unit}
                  </span>
                  <span>
                    Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
                    {focusGoal.unit}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="m3-body-m">
              No Match Focus yet. Adopt the recommended focus below or set one of your pinned goals
              as Match Focus — it is surfaced in Champ Select, Win Plan and the live HUD.
            </p>
          )}

          {recentResults.length > 0 && (
            <div className="mt-auto space-y-1">
              <div className="m3-label-m">Last {recentResults.length} {roleNoun} games</div>
              <div className="flex items-center gap-1.5" role="list" aria-label="Recent results">
                {recentResults.map((m) => (
                  <span
                    key={m.matchId}
                    role="listitem"
                    title={`${m.win ? 'Win' : 'Loss'} · ${new Date(m.playedAt).toLocaleDateString()}`}
                    aria-label={m.win ? 'Win' : 'Loss'}
                    className={`m3-label-m grid h-6 w-6 place-items-center font-bold ${
                      m.win
                        ? 'rounded-full bg-[var(--md-sys-color-tertiary)] text-[var(--md-sys-color-on-tertiary)]'
                        : 'rounded-[4px] bg-[rgba(250,216,253,0.16)]'
                    }`}
                  >
                    {m.win ? 'W' : 'L'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </M3Card>
      </div>

      {/* LP Trend & Velocity · Death heatmap */}
      <ClimbTrendCharts
        matches={roleMatches}
        lpHistory={lpHistory}
        patchVersion={patchVersion}
        targetDivision={targetDivision}
        summonerProfile={summonerProfile}
      />

      {/* Benchmarks KPI Matrix */}
      <M3Card variant="hero" as="section" aria-label="KPI benchmark matrix" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
              {isAdc ? 'ADC' : 'Jungle'} KPIs vs {roleTier} benchmark
            </h3>
            <p className="m3-body-s mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
              You = rolling average of last {roleMatchCount} games · Baseline = shrunk EWM with IQR
            </p>
          </div>
          {isAdc ? (
            adcEvaluation.isProvisional && (
              <M3Chip size="sm" tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                Provisional benchmarks
              </M3Chip>
            )
          ) : (
            <M3Chip size="sm" tone="plain" className="num">
              {jungleBench.csPerMin} CS/m · {jungleBench.objectiveSharePct}% obj target
            </M3Chip>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-y-0.5 text-left">
            <thead>
              <tr className="m3-label-m uppercase tracking-wide text-[var(--md-sys-color-outline)]">
                <th className="px-2.5 pb-1 font-semibold">Metric</th>
                <th className="px-2.5 pb-1 font-semibold">You</th>
                <th className="px-2.5 pb-1 font-semibold">Baseline</th>
                <th className="px-2.5 pb-1 font-semibold">Target</th>
                <th className="w-[22%] px-2.5 pb-1 font-semibold">Progress</th>
                <th className="px-2.5 pb-1 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => {
                const status = STATUS_CHIP[row.status];
                const unmeasured = row.sampleN === 0;
                return (
                  <tr key={row.metric} className="group">
                    <td className="m3-title-s rounded-l-[12px] px-2.5 py-2 text-[var(--md-sys-color-on-surface)] group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      {row.label}
                      <div className="m3-label-m m3-faint font-normal">{row.gapText}</div>
                    </td>
                    <td className="m3-title-m num px-2.5 py-2 whitespace-nowrap text-[var(--md-sys-color-on-surface)] group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      {unmeasured ? '—' : row.currentValue}
                      {!unmeasured && (
                        <span className="m3-label-m ml-0.5 text-[var(--md-sys-color-on-surface-variant)]">
                          {row.unit}
                        </span>
                      )}
                    </td>
                    <td className="m3-label-m num px-2.5 py-2 whitespace-nowrap text-[var(--md-sys-color-on-surface-variant)] group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      {row.baseline ? (
                        <>
                          EWM {row.baseline.shrunkBaseline}
                          {row.unit}
                          <div className="m3-faint">
                            IQR {row.baseline.p25}–{row.baseline.p75}
                          </div>
                        </>
                      ) : (
                        <span className="m3-faint">Needs 2+ games</span>
                      )}
                    </td>
                    <td className="m3-label-l num px-2.5 py-2 whitespace-nowrap text-[var(--md-sys-color-on-surface)] group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      {row.lowerIsBetter ? '≤' : '≥'} {row.targetValue}
                      {row.unit}
                    </td>
                    <td className="px-2.5 py-2 group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      <LinearProgress
                        pct={row.progressPct}
                        color={status.bar}
                        label={`${row.label} ${row.progressPct}% of target`}
                      />
                    </td>
                    <td className="rounded-r-[12px] px-2.5 py-2 text-right group-hover:bg-[var(--md-sys-color-surface-container-high)]">
                      <M3Chip size="sm" tone={unmeasured ? 'plain' : status.tone}>
                        {unmeasured ? 'No data' : status.label}
                      </M3Chip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </M3Card>

      {/* Stamina / Tilt & Confidence — role-isolated personal learning */}
      <PersonalLearningPanel
        snapshot={personalLearning}
        currentFocusGoalId={activeFocusGoalId}
        onAdoptFocusGoal={handleAdoptFocusGoal}
        activeRole={role}
        adcSnapshot={adcPersonalLearning}
      />

      {/* Goals & High-Elo Sampler */}
      <div className="grid gap-3 lg:grid-cols-2">
        <M3Card variant="hero" as="section" aria-label="Recommended focus goals" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
              Recommended Next Focus Goals
            </h3>
            <M3Chip size="sm" tone="primary">{isAdc ? 'ADC' : 'Jungle'}</M3Chip>
          </div>
          {suggestedGoals.length > 0 ? (
            <div className="space-y-2">
              {suggestedGoals.map((sg) => {
                const pinned = existingIds.has(sg.id);
                return (
                  <M3ListItem
                    key={sg.id}
                    className="rounded-[16px] bg-[var(--md-sys-color-surface-container-high)]"
                    title={sg.title}
                    description={
                      <span className="num">
                        Current: {sg.currentValue}
                        {sg.unit} → Target: {sg.targetValue}
                        {sg.unit}
                      </span>
                    }
                    trailing={
                      <M3Button
                        size="sm"
                        variant={pinned ? 'text' : 'tonal'}
                        disabled={pinned}
                        onClick={() => void handlePinSuggested(sg)}
                      >
                        {pinned ? 'Pinned' : 'Pin Goal'}
                      </M3Button>
                    }
                  />
                );
              })}
            </div>
          ) : (
            <p className="m3-body-m text-[var(--md-ext-success)]">
              {roleMatchCount === 0
                ? `Sync ${roleNoun} games to get recommended goals.`
                : `All ${isAdc ? 'ADC' : 'Jungle'} KPIs meet ${roleTier} benchmarks — consider raising your Target Division in Settings.`}
            </p>
          )}

          <div className="border-t border-[var(--md-sys-color-outline-variant)] pt-3">
            <M3Button
              size="sm"
              variant="text"
              onClick={() => setShowCustomGoalForm((v) => !v)}
              aria-expanded={showCustomGoalForm}
            >
              {showCustomGoalForm ? 'Hide Custom Goal Form' : '+ Add Custom Improvement Goal'}
            </M3Button>
            {showCustomGoalForm && (
              <form
                onSubmit={(e) => void handleAddCustomGoal(e)}
                className="mt-2.5 space-y-2"
                aria-label="Add custom improvement goal"
              >
                <div className="grid grid-cols-[1fr_96px] gap-2">
                  <select
                    aria-label="Custom goal metric"
                    value={effectiveMetric}
                    onChange={(e) => setCustomMetric(e.target.value as JungleKpiKey | AdcKpiKey)}
                    className="m3-body-m rounded-[12px] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)]"
                  >
                    {metricOptions.map((o) => (
                      <option key={o.key} value={o.key} className="bg-zinc-900">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.1"
                    aria-label="Custom goal target"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    className="m3-body-m num rounded-[12px] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)]"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="Custom goal title"
                    placeholder="Optional custom goal title..."
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    className="m3-body-m min-w-0 flex-1 rounded-[12px] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-outline)] focus:border-[var(--md-sys-color-primary)]"
                  />
                  <M3Button type="submit" variant="filled">
                    Add
                  </M3Button>
                </div>
              </form>
            )}
          </div>
        </M3Card>

        <div className="space-y-3">
          <M3Card variant="hero" as="section" aria-label="Pinned climb goals">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
                Your pinned {isAdc ? 'ADC' : 'Jungle'} goals ({roleGoals.length})
              </h3>
              {otherRoleGoalCount > 0 && (
                <span className="m3-label-m m3-faint">
                  +{otherRoleGoalCount} {isAdc ? 'Jungle' : 'ADC'} goal{otherRoleGoalCount === 1 ? '' : 's'} hidden
                </span>
              )}
            </div>
            {roleGoals.length === 0 ? (
              <p className="m3-body-m text-[var(--md-sys-color-on-surface-variant)]">
                Pin one of the recommended bottleneck goals or create your own on the left.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--md-sys-color-outline-variant)]">
                {roleGoals.map((goal) => {
                  const isAutoMet = isGoalAutoMet(goal);
                  const completed = goal.status === 'completed';
                  return (
                    <li key={goal.id} className="flex items-center justify-between gap-2 py-2.5">
                      <button
                        type="button"
                        aria-pressed={completed}
                        aria-disabled={isAutoMet ? true : undefined}
                        aria-describedby={isAutoMet ? `auto-met-${goal.id}` : undefined}
                        onClick={() => {
                          if (!isAutoMet) void handleToggleGoalStatus(goal);
                        }}
                        className={`m3-focus-ring flex min-w-0 items-center gap-2.5 rounded-[8px] text-left ${
                          isAutoMet ? 'cursor-default' : ''
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                            completed
                              ? 'border-[var(--md-ext-success)] bg-[var(--md-ext-success)]'
                              : 'border-[var(--md-sys-color-outline)]'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`m3-title-s truncate ${
                                completed
                                  ? 'text-[var(--md-sys-color-outline)] line-through'
                                  : 'text-[var(--md-sys-color-on-surface)]'
                              }`}
                            >
                              {goal.title}
                            </span>
                            <M3Chip size="sm" tone="plain">
                              {goalRole(goal) === 'bottom' ? 'ADC' : 'Jungle'}
                            </M3Chip>
                            {isAutoMet && (
                              <M3Chip id={`auto-met-${goal.id}`} size="sm" tone="success">
                                Auto-met
                              </M3Chip>
                            )}
                          </span>
                          <span className="m3-label-m num block text-[var(--md-sys-color-on-surface-variant)]">
                            Current: {goal.currentValue} · Target: {goal.targetValue}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {onSetFocusGoal && (
                          <M3Button
                            size="sm"
                            variant={goal.isFocusGoal ? 'filled' : 'outlined'}
                            aria-pressed={Boolean(goal.isFocusGoal)}
                            onClick={() => void onSetFocusGoal(goal.id)}
                          >
                            {goal.isFocusGoal ? 'Match Focus' : 'Set as Match Focus'}
                          </M3Button>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete goal ${goal.title}`}
                          onClick={() => void onDeleteGoal(goal.id)}
                          className="m3-icon-btn m3-icon-btn--danger m3-state"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </M3Card>

          <M3Card variant="hero" as="section" aria-label="High-Elo meta snapshot">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={showHighEloMeta}
                onClick={() => setShowHighEloMeta((v) => !v)}
                className="m3-focus-ring flex items-center gap-2 rounded-md text-left"
              >
                <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">High-Elo Meta Snapshot</h3>
                <M3Chip size="sm" tone="plain">
                  {showHighEloMeta ? 'Hide' : 'Show'}
                </M3Chip>
              </button>
              <M3Button
                size="sm"
                variant="tonal"
                disabled={refreshingMeta}
                onClick={() => {
                  setShowHighEloMeta(true);
                  void handleRefreshMeta();
                }}
                icon={<RefreshCw className={`h-4 w-4 ${refreshingMeta ? 'animate-spin' : ''}`} />}
              >
                {refreshingMeta
                  ? 'Sampling...'
                  : canSyncLive
                    ? 'Sample Challenger'
                    : 'Refresh Sample'}
              </M3Button>
            </div>
            {metaError && (
              <p
                role="alert"
                className="m3-body-s mt-2 rounded-[12px] bg-[var(--md-sys-color-error-container)] px-3 py-1.5 text-[var(--md-sys-color-on-error-container)]"
              >
                {metaError}
              </p>
            )}
            {showHighEloMeta && (
              highEloMeta ? (
                <div className="mt-2.5 space-y-2">
                  <div className="m3-body-s text-[var(--md-sys-color-on-surface-variant)]">
                    Patch {highEloMeta.patch} ({highEloMeta.region}) ·{' '}
                    {highEloMeta.sampleMatches} sampled high-elo matches blended into Champ Select
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {highEloMeta.champions.slice(0, 5).map((stat) => {
                      const champ = findJungleChampionById(stat.championId);
                      const champLabel =
                        champ?.name ?? formatChampionName(undefined, stat.championId);
                      return (
                        <M3Chip key={stat.championId} tone="plain" className="num text-[var(--md-sys-color-on-surface)]">
                          {champLabel}: <span className="font-bold">{stat.winRate}%</span> ({stat.games}g)
                        </M3Chip>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="m3-body-m mt-2 text-[var(--md-sys-color-on-surface-variant)]">
                  No high-elo meta snapshot cached yet.
                </p>
              )
            )}
          </M3Card>
        </div>
      </div>
    </div>
  );
}
