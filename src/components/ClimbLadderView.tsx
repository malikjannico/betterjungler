import { CheckCircle2, Circle, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { findJungleChampionById } from '../data/jungleKnowledgePack';
import {
  KPI_META,
  MIN_GOAL_COMPLETION_GAMES,
  evaluateDivisionProgress,
  isGoalTargetMet,
  isSessionTilting,
  syncGoalsWithRollingProgress,
} from '../domain/climbLadderEngine';
import type { EmptyReason } from '../domain/sessionContext';
import type {
  ClimbGoal,
  DemoScenarioId,
  HighEloMetaSnapshot,
  JungleKpiKey,
  LpHistoryPoint,
} from '../types/coaching';
import type {
  MatchSummaryRecord,
  MatchV5Detail,
  SummonerProfileSummary,
} from '../types/riot';
import { ClimbTrendCharts } from './ClimbTrendCharts';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';

interface ClimbLadderViewProps {
  summonerProfile: SummonerProfileSummary | null;
  targetDivision: string;
  summaries: MatchSummaryRecord[];
  matches: MatchV5Detail[];
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
  onRefreshHighElo: () => Promise<void>;
  onSyncMatches?: () => Promise<void>;
  onOpenSettings?: () => void;
  onTestHud?: () => void;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

const KPI_OPTIONS: JungleKpiKey[] = [
  'preObjectiveDeaths',
  'csPerMin',
  'objectiveSharePct',
  'goldDiffAt15',
  'visionPerMin',
  'killParticipationPct',
];

export function ClimbLadderView({
  summonerProfile,
  targetDivision,
  summaries,
  matches,
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
  onRefreshHighElo,
  onSyncMatches,
  onOpenSettings,
  onTestHud,
  onPreviewSample,
}: ClimbLadderViewProps) {
  const [customMetric, setCustomMetric] = useState<JungleKpiKey>('csPerMin');
  const [customTarget, setCustomTarget] = useState<string>('6.8');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [syncingMatches, setSyncingMatches] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const evaluation = useMemo(
    () => evaluateDivisionProgress(summaries, targetDivision),
    [summaries, targetDivision]
  );

  const hasMatches = summaries.length > 0;
  const sessionTilting = useMemo(() => isSessionTilting(matches), [matches]);
  const syncedGoals = useMemo(
    () => syncGoalsWithRollingProgress(goals, evaluation.comparisons, evaluation.matchCount),
    [goals, evaluation.comparisons, evaluation.matchCount]
  );

  async function handlePinSuggested(goal: ClimbGoal) {
    await onUpsertGoal(goal);
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
    const meta = KPI_META[customMetric];
    const targetNum = Number(customTarget);
    if (!Number.isFinite(targetNum)) return;

    const comp = evaluation.comparisons.find((c) => c.metric === customMetric);
    const goal: ClimbGoal = {
      id: `custom-${Date.now()}`,
      targetDivision,
      metric: customMetric,
      title:
        customTitle.trim() ||
        meta.goalTemplate.replace('{target}', String(targetNum)),
      targetValue: targetNum,
      currentValue: comp?.currentValue ?? 0,
      unit: meta.unit,
      lowerIsBetter: meta.lowerIsBetter,
      status: 'active',
      source: 'custom',
      createdAt: new Date().toISOString(),
    };

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

  // Honest unconfigured / empty match onboarding state
  if (!hasMatches) {
    return (
      <div className="space-y-6">
        {summonerProfile && (
          <GlassSurface className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="t-title text-white/[0.92]">{summonerProfile.riotId}</div>
              <div className="t-caption mt-0.5 text-white/[0.62]">
                {summonerProfile.tier} {summonerProfile.rank} · {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
            <span className="t-caption text-white/[0.55]">Target: {targetDivision}</span>
          </GlassSurface>
        )}

        <EmptyState
          icon={TrendingUp}
          title={
            !accountReady
              ? 'Connect League Client or your Riot ID to begin'
              : emptyReason === 'needs_api_key'
                ? 'Save a Riot API key to sync Match-V5 history'
                : 'No ranked jungle matches synced yet'
          }
          description={
            !accountReady
              ? 'Open League of Legends for Keyless LCU live coaching, or save your Riot ID & Personal API Key in Settings to compute your rolling jungle KPIs and climb goals.'
              : emptyReason === 'needs_api_key'
                ? 'Your profile is detected via the League Client. Add a personal Riot API key in Settings to download Match-V5 timelines and benchmark your last 15 games.'
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
          onPreviewSample={onPreviewSample ? () => onPreviewSample('in_game_mid') : undefined}
          sampleLabel="Preview sample climb data"
        >
          {!accountReady && (
            <div className="mt-4 grid gap-2.5 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
              <div className="lg-inset flex items-start gap-2.5 p-3">
                {hasVerifiedKey ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-white/[0.38]" />
                )}
                <div className="t-caption">
                  <div className="font-semibold text-white/[0.92]">Riot API Key</div>
                  <p className="mt-0.5 text-white/[0.58]">
                    {hasVerifiedKey ? 'Verified & ready for Match-V5 sync.' : 'Optional key in Settings enables history sync.'}
                  </p>
                </div>
              </div>

              <div className="lg-inset flex items-start gap-2.5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                <div className="t-caption">
                  <div className="font-semibold text-white/[0.92]">Borderless Video Mode</div>
                  <p className="mt-0.5 text-white/[0.58]">
                    Set League Video Mode to Borderless or Windowed so the click-through HUD stays visible.
                  </p>
                </div>
              </div>

              <div className="lg-inset flex items-start gap-2.5 p-3">
                {hasTestedHud ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-white/[0.38]" />
                )}
                <div className="t-caption">
                  <div className="font-semibold text-white/[0.92]">Compact HUD ({overlayHotkey})</div>
                  {!hasTestedHud && onTestHud ? (
                    <button
                      type="button"
                      onClick={onTestHud}
                      className="mt-1 font-medium text-emerald-300 hover:underline"
                    >
                      Preview floating HUD →
                    </button>
                  ) : (
                    <p className="mt-0.5 text-white/[0.58]">Modular transparent HUD armed.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {syncError && (
            <p className="t-caption mt-3 rounded-[7px] border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-rose-200">
              {syncError}
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sessionTilting && (
        <div
          role="status"
          className="t-caption flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-amber-100"
        >
          <span>
            <strong className="font-semibold">Session Stop-Loss Guard:</strong> 3 consecutive
            ranked losses detected. Consider a 10-minute reset and review your pre-objective deaths
            before queueing again.
          </span>
        </div>
      )}

      {/* Division Climb Header */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="t-title text-white/[0.92]">
              Division Climb Ladder → {targetDivision}
            </h2>
            <p className="t-caption mt-1 text-white/[0.62]">
              Rolling last{' '}
              <span className="tabular-nums font-semibold text-white/[0.92]">
                {evaluation.matchCount}
              </span>{' '}
              ranked {evaluation.matchCount === 1 ? 'match' : 'matches'} (
              <span className="tabular-nums font-semibold text-white/[0.92]">
                {evaluation.winRatePct}% WR
              </span>
              )
              {evaluation.matchCount < MIN_GOAL_COMPLETION_GAMES && (
                <span className="text-white/[0.45]">
                  {' '}
                  · {evaluation.matchCount}/{MIN_GOAL_COMPLETION_GAMES} games toward reliable goal lock-in
                </span>
              )}
            </p>
          </div>

          {summonerProfile && (
            <div className="lg-inset px-3 py-1.5 t-caption">
              <div className="font-semibold text-white/[0.92]">{summonerProfile.riotId}</div>
              <div className="tabular-nums text-white/[0.58]">
                {summonerProfile.tier} {summonerProfile.rank} · {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
          )}
        </div>
      </GlassSurface>

      {/* 6-Pillar Division Benchmarks */}
      <GlassSurface className="p-4">
        <div className="t-caption mb-3 font-medium text-white/[0.55]">
          Jungle KPIs vs {evaluation.targetTier} benchmark
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {evaluation.comparisons.map((comp) => {
            const statusTextColor =
              comp.status === 'on_track'
                ? 'text-emerald-300'
                : comp.status === 'close'
                  ? 'text-amber-300'
                  : 'text-rose-300';

            return (
              <div key={comp.metric} className="lg-inset p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-white/[0.85]">{comp.label}</span>
                  <span className={`t-caption font-semibold capitalize ${statusTextColor}`}>
                    {comp.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="tabular-nums text-base font-bold text-white">
                    {comp.currentValue}
                    {comp.unit}
                  </span>
                  <span className="tabular-nums t-caption text-white/[0.55]">
                    Target {comp.lowerIsBetter ? '≤' : '≥'} {comp.targetValue}
                    {comp.unit}
                  </span>
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${
                      comp.status === 'on_track'
                        ? 'bg-emerald-400'
                        : comp.status === 'close'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                    }`}
                    style={{ width: `${comp.progressPct}%` }}
                  />
                </div>
                <div className="t-caption mt-1.5 text-white/[0.5]">{comp.gapText}</div>
              </div>
            );
          })}
        </div>
      </GlassSurface>

      {/* LP Progression & Official Map Multi-Game Death Heatmap */}
      <ClimbTrendCharts
        matches={matches}
        lpHistory={lpHistory}
        patchVersion={patchVersion}
      />

      {/* Goals & High-Elo Sampler */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassSurface className="space-y-3 p-4">
          <h3 className="t-title text-white/[0.92]">
            Recommended Next Focus Goals
          </h3>
          {evaluation.suggestedGoals.length > 0 ? (
            evaluation.suggestedGoals.map((sg) => {
              const pinned = existingIds.has(sg.id);
              return (
                <div
                  key={sg.id}
                  className="lg-inset flex items-center justify-between gap-2 p-3 text-xs"
                >
                  <div>
                    <div className="font-medium text-white/[0.92]">{sg.title}</div>
                    <div className="tabular-nums t-caption text-white/[0.55]">
                      Current: {sg.currentValue}
                      {sg.unit} → Target: {sg.targetValue}
                      {sg.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pinned}
                    onClick={() => void handlePinSuggested(sg)}
                    className="lg-btn-glass shrink-0 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {pinned ? 'Pinned' : 'Pin Goal'}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="t-caption text-emerald-300">
              All KPIs meet {evaluation.targetTier} benchmarks — consider raising your Target
              Division in Settings.
            </p>
          )}

          <form
            onSubmit={(e) => void handleAddCustomGoal(e)}
            className="mt-3 space-y-2 border-t border-white/[0.08] pt-3"
          >
            <div className="t-caption font-medium text-white/[0.55]">
              Add custom improvement goal
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <select
                aria-label="Custom goal metric"
                value={customMetric}
                onChange={(e) => setCustomMetric(e.target.value as JungleKpiKey)}
                className="lg-inset px-2.5 py-1.5 text-xs text-white/[0.92] outline-none"
              >
                {KPI_OPTIONS.map((k) => (
                  <option key={k} value={k} className="bg-zinc-900">
                    {KPI_META[k].label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.1"
                aria-label="Custom goal target"
                value={customTarget}
                onChange={(e) => setCustomTarget(e.target.value)}
                className="lg-inset px-2.5 py-1.5 text-xs text-white/[0.92] outline-none"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Optional custom goal title..."
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="lg-inset flex-1 px-2.5 py-1.5 text-xs text-white/[0.92] outline-none"
              />
              <button
                type="submit"
                className="lg-btn-primary px-3.5 py-1.5 text-xs font-bold"
              >
                Add
              </button>
            </div>
          </form>
        </GlassSurface>

        <div className="space-y-4">
          <GlassSurface className="p-4">
            <h3 className="t-title mb-2.5 text-white/[0.92]">
              Your pinned climb goals ({syncedGoals.length})
            </h3>
            {syncedGoals.length === 0 ? (
              <p className="t-caption text-white/[0.55]">
                Pin one of the recommended bottleneck goals or create your own on the left.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {syncedGoals.map((goal) => {
                  const isAutoMet = isGoalTargetMet(
                    goal,
                    evaluation.comparisons,
                    evaluation.matchCount
                  );
                  return (
                    <div
                      key={goal.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <button
                        type="button"
                        aria-pressed={goal.status === 'completed'}
                        aria-disabled={isAutoMet ? true : undefined}
                        aria-describedby={isAutoMet ? `auto-met-${goal.id}` : undefined}
                        onClick={() => {
                          if (!isAutoMet) void handleToggleGoalStatus(goal);
                        }}
                        className={`flex min-w-0 items-center gap-2.5 text-left ${
                          isAutoMet ? 'cursor-default' : ''
                        }`}
                      >
                        <span
                          className={`h-3 w-3 shrink-0 rounded-full border ${
                            goal.status === 'completed'
                              ? 'border-emerald-300 bg-emerald-400'
                              : 'border-white/40'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span
                              className={`truncate ${
                                goal.status === 'completed'
                                  ? 'text-white/[0.45] line-through'
                                  : 'font-medium text-white/[0.92]'
                              }`}
                            >
                              {goal.title}
                            </span>
                            {isAutoMet && (
                              <span
                                id={`auto-met-${goal.id}`}
                                className="shrink-0 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200"
                              >
                                Auto-met
                              </span>
                            )}
                          </span>
                          <span className="block tabular-nums text-[11px] text-white/[0.55]">
                            Current: {goal.currentValue} · Target: {goal.targetValue}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {onSetFocusGoal && (
                          <button
                            type="button"
                            aria-pressed={Boolean(goal.isFocusGoal)}
                            onClick={() => void onSetFocusGoal(goal.id)}
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                              goal.isFocusGoal
                                ? 'border-sky-400/45 bg-sky-500/20 text-sky-200'
                                : 'border-white/15 bg-white/[0.04] text-white/[0.75] hover:bg-white/[0.08]'
                            }`}
                          >
                            {goal.isFocusGoal ? 'Match Focus' : 'Set as Match Focus'}
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete goal ${goal.title}`}
                          onClick={() => void onDeleteGoal(goal.id)}
                          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-white/[0.45] transition hover:bg-white/[0.06] hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassSurface>

          <GlassSurface className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="t-title text-white/[0.92]">High-Elo Meta Snapshot</h3>
              <button
                type="button"
                disabled={refreshingMeta}
                onClick={() => void handleRefreshMeta()}
                className="lg-btn-glass px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {refreshingMeta
                  ? 'Sampling...'
                  : canSyncLive
                    ? 'Sample Challenger'
                    : 'Refresh Sample'}
              </button>
            </div>
            {metaError && (
              <p className="t-caption mt-2 rounded-[7px] border border-rose-400/35 bg-rose-400/10 px-3 py-1.5 text-rose-200">
                {metaError}
              </p>
            )}
            {highEloMeta ? (
              <div className="t-caption mt-2.5 space-y-2">
                <div className="text-white/[0.62]">
                  Patch {highEloMeta.patch} ({highEloMeta.region}) ·{' '}
                  {highEloMeta.sampleMatches} sampled high-elo matches blended into Champ Select
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {highEloMeta.champions.slice(0, 5).map((stat) => {
                    const champ = findJungleChampionById(stat.championId);
                    return (
                      <span
                        key={stat.championId}
                        className="lg-inset px-2.5 py-1 text-white/[0.85]"
                      >
                        {champ?.name ?? `#${stat.championId}`}:{' '}
                        <span className="font-semibold text-white">{stat.winRate}%</span> (
                        {stat.games}g)
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="t-caption mt-1 text-white/[0.55]">
                No high-elo meta snapshot cached yet.
              </p>
            )}
          </GlassSurface>
        </div>
      </div>
    </div>
  );
}
