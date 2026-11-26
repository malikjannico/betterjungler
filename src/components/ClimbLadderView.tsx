import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { findJungleChampionById } from '../data/jungleKnowledgePack';
import {
  KPI_META,
  evaluateDivisionProgress,
  isGoalTargetMet,
  syncGoalsWithRollingProgress,
} from '../domain/climbLadderEngine';
import type {
  ClimbGoal,
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
  onUpsertGoal: (goal: ClimbGoal) => Promise<void>;
  onDeleteGoal: (goalId: string) => Promise<void>;
  onRefreshHighElo: () => Promise<void>;
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
  onUpsertGoal,
  onDeleteGoal,
  onRefreshHighElo,
}: ClimbLadderViewProps) {
  const [customMetric, setCustomMetric] = useState<JungleKpiKey>('csPerMin');
  const [customTarget, setCustomTarget] = useState<string>('6.8');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const evaluation = useMemo(
    () => evaluateDivisionProgress(summaries, targetDivision),
    [summaries, targetDivision]
  );

  const syncedGoals = useMemo(
    () => syncGoalsWithRollingProgress(goals, evaluation.comparisons),
    [goals, evaluation.comparisons]
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

  const existingIds = new Set(goals.map((g) => g.id));

  return (
    <div className="space-y-4">
      {/* Division Climb Header */}
      <GlassSurface className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Division Climb Ladder → {targetDivision}
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Rolling last {evaluation.matchCount} ranked matches ({evaluation.winRatePct}% WR) ·
              Readiness:{' '}
              <span className="font-semibold text-white">
                {evaluation.overallReadinessPct}%
              </span>
            </p>
          </div>

          {summonerProfile ? (
            <div className="lg-inset px-3 py-1.5 text-xs">
              <div className="font-semibold text-white">{summonerProfile.riotId}</div>
              <div className="text-[11px] text-slate-400">
                {summonerProfile.tier} {summonerProfile.rank} · {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">
              Using {evaluation.matchCount} local/demo ranked games
            </span>
          )}
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-white/80 transition-all duration-500 motion-reduce:transition-none"
            style={{ width: `${evaluation.overallReadinessPct}%` }}
          />
        </div>
      </GlassSurface>

      {/* 6-Pillar Division Benchmarks */}
      <GlassSurface className="p-5">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
          Jungle KPIs vs. {evaluation.targetTier} Benchmark
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
                  <span className="font-medium text-slate-200">{comp.label}</span>
                  <span className={`text-[10px] font-semibold uppercase ${statusTextColor}`}>
                    {comp.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="tabular-nums text-base font-bold text-white">
                    {comp.currentValue}
                    {comp.unit}
                  </span>
                  <span className="tabular-nums text-[11px] text-slate-400">
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
                <div className="mt-1.5 text-[10px] text-slate-400">{comp.gapText}</div>
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
        <GlassSurface className="space-y-3 p-5">
          <h3 className="text-xs font-semibold text-white">
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
                    <div className="font-medium text-white">{sg.title}</div>
                    <div className="text-[11px] text-slate-400">
                      Current: {sg.currentValue}
                      {sg.unit} → Target: {sg.targetValue}
                      {sg.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pinned}
                    onClick={() => void handlePinSuggested(sg)}
                    className="lg-btn-glass shrink-0 px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {pinned ? 'Pinned' : 'Pin Goal'}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-emerald-300">
              All KPIs meet {evaluation.targetTier} benchmarks — consider raising your Target
              Division in Settings.
            </p>
          )}

          <form
            onSubmit={(e) => void handleAddCustomGoal(e)}
            className="mt-3 space-y-2 border-t border-white/[0.08] pt-3"
          >
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Add Custom Improvement Goal
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <select
                aria-label="Custom goal metric"
                value={customMetric}
                onChange={(e) => setCustomMetric(e.target.value as JungleKpiKey)}
                className="lg-inset px-2.5 py-1.5 text-xs text-slate-100 outline-none"
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
                className="lg-inset px-2.5 py-1.5 text-xs text-slate-100 outline-none"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Optional custom goal title..."
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="lg-inset flex-1 px-2.5 py-1.5 text-xs text-slate-100 outline-none"
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
          <GlassSurface className="p-5">
            <h3 className="mb-2.5 text-xs font-semibold text-white">
              Your Pinned Climb Goals ({syncedGoals.length})
            </h3>
            {syncedGoals.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                Pin one of the recommended bottleneck goals or create your own on the left.
              </p>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {syncedGoals.map((goal) => {
                  const isAutoMet = isGoalTargetMet(goal, evaluation.comparisons);
                  return (
                    <div
                      key={goal.id}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <button
                        type="button"
                        aria-pressed={goal.status === 'completed'}
                        disabled={isAutoMet}
                        title={
                          isAutoMet
                            ? 'Target automatically satisfied by rolling 15-game KPIs'
                            : undefined
                        }
                        onClick={() => void handleToggleGoalStatus(goal)}
                        className="flex min-w-0 items-center gap-2.5 text-left disabled:cursor-default"
                      >
                        <span
                          className={`h-3 w-3 shrink-0 rounded-full border ${
                            goal.status === 'completed'
                              ? 'border-emerald-300 bg-emerald-400'
                              : 'border-slate-500'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span
                              className={`truncate ${
                                goal.status === 'completed'
                                  ? 'text-slate-400 line-through'
                                  : 'font-medium text-white'
                              }`}
                            >
                              {goal.title}
                            </span>
                            {isAutoMet && (
                              <span className="shrink-0 rounded-full border border-emerald-400/35 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                                Auto-met
                              </span>
                            )}
                          </span>
                          <span className="block tabular-nums text-[10px] text-slate-400">
                            Current: {goal.currentValue} · Target: {goal.targetValue}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete goal ${goal.title}`}
                        onClick={() => void onDeleteGoal(goal.id)}
                        className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.06] hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassSurface>

          <GlassSurface className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-white">
                Challenger Meta Snapshot
              </h3>
              <button
                type="button"
                disabled={refreshingMeta}
                onClick={() => void handleRefreshMeta()}
                className="lg-btn-glass px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {refreshingMeta
                  ? 'Sampling...'
                  : canSyncLive
                    ? 'Sample Challenger'
                    : 'Refresh Demo Sample'}
              </button>
            </div>
            {metaError && (
              <p className="mt-2 rounded-lg border border-rose-400/35 bg-rose-400/10 px-3 py-1.5 text-[11px] text-rose-200">
                {metaError}
              </p>
            )}
            {highEloMeta ? (
              <div className="mt-2.5 space-y-2 text-[11px]">
                <div className="text-slate-400">
                  Patch {highEloMeta.patch} ({highEloMeta.region}) ·{' '}
                  {highEloMeta.sampleMatches} sampled high-elo matches blended into Champ Select
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {highEloMeta.champions.slice(0, 5).map((stat) => {
                    const champ = findJungleChampionById(stat.championId);
                    return (
                      <span
                        key={stat.championId}
                        className="lg-inset px-2.5 py-1 text-[11px] text-slate-200"
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
              <p className="mt-1 text-[11px] text-slate-400">
                No high-elo meta snapshot cached yet.
              </p>
            )}
          </GlassSurface>
        </div>
      </div>
    </div>
  );
}
