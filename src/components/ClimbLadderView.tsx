import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { findJungleChampionById } from '../data/jungleKnowledgePack';
import {
  KPI_META,
  evaluateDivisionProgress,
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

interface ClimbLadderViewProps {
  summonerProfile: SummonerProfileSummary | null;
  targetDivision: string;
  summaries: MatchSummaryRecord[];
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
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

  const evaluation = useMemo(
    () => evaluateDivisionProgress(summaries, targetDivision),
    [summaries, targetDivision]
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
    const meta = KPI_META[customMetric];
    const targetNum = Number(customTarget);
    if (Number.isNaN(targetNum)) return;

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
    try {
      await onRefreshHighElo();
    } finally {
      setRefreshingMeta(false);
    }
  }

  const existingIds = new Set(goals.map((g) => g.id));

  return (
    <div className="space-y-3">
      {/* Division Climb Header */}
      <div className="hud-card rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-slate-100">
                Division Climb Ladder → {targetDivision}
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Rolling last {evaluation.matchCount} ranked matches ({evaluation.winRatePct}% WR) •
              Readiness Score:{' '}
              <span className="font-bold text-cyan-300">{evaluation.overallReadinessPct}%</span>
            </p>
          </div>

          {summonerProfile ? (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs">
              <div className="font-bold text-cyan-200">{summonerProfile.riotId}</div>
              <div className="text-[11px] text-slate-300">
                {summonerProfile.tier} {summonerProfile.rank} • {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
          ) : (
            <span className="rounded bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">
              Using {evaluation.matchCount} local/demo ranked games
            </span>
          )}
        </div>

        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all"
            style={{ width: `${evaluation.overallReadinessPct}%` }}
          />
        </div>
      </div>

      {/* 6-Pillar Division Benchmarks */}
      <div className="hud-card rounded-xl p-3">
        <div className="mb-2 text-xs font-bold text-slate-200">
          Jungle KPIs vs. {evaluation.targetTier} Benchmark
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {evaluation.comparisons.map((comp) => {
            const badgeStyle =
              comp.status === 'on_track'
                ? 'bg-emerald-500/20 text-emerald-300'
                : comp.status === 'close'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-rose-500/20 text-rose-300';

            return (
              <div key={comp.metric} className="rounded-lg bg-slate-900/75 p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{comp.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeStyle}`}>
                    {comp.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="tabular-nums text-sm font-bold text-cyan-300">
                    {comp.currentValue}
                    {comp.unit}
                  </span>
                  <span className="tabular-nums text-[11px] text-slate-400">
                    Target {comp.lowerIsBetter ? '≤' : '≥'} {comp.targetValue}
                    {comp.unit}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${
                      comp.status === 'on_track'
                        ? 'bg-emerald-400'
                        : comp.status === 'close'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                    }`}
                    style={{ width: `${comp.progressPct}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-400">{comp.gapText}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* LP Progression & Multi-Game Death Heatmap */}
      <ClimbTrendCharts matches={matches} lpHistory={lpHistory} />

      {/* Suggested Bottleneck Goals + Active Goals + Custom Goal Form */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="hud-card space-y-2.5 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
            <Target className="h-4 w-4" />
            Recommended Next Focus Goals
          </div>
          {evaluation.suggestedGoals.length > 0 ? (
            evaluation.suggestedGoals.map((sg) => {
              const pinned = existingIds.has(sg.id);
              return (
                <div
                  key={sg.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/75 p-2.5 text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-100">{sg.title}</div>
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
                    className="shrink-0 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
                  >
                    {pinned ? 'Pinned' : 'Pin Goal'}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-emerald-300">
              All KPIs meet {evaluation.targetTier} benchmarks — consider raising your Target
              Division in Settings!
            </p>
          )}

          {/* Custom Goal Form */}
          <form
            onSubmit={(e) => void handleAddCustomGoal(e)}
            className="mt-3 space-y-2 border-t border-slate-800 pt-2.5"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Add Custom Improvement Goal
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <select
                aria-label="Custom goal metric"
                value={customMetric}
                onChange={(e) => setCustomMetric(e.target.value as JungleKpiKey)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              >
                {KPI_OPTIONS.map((k) => (
                  <option key={k} value={k}>
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
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Optional custom goal title..."
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-cyan-400"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </form>
        </div>

        {/* Active & Completed Goals + High-Elo Meta Sampler */}
        <div className="space-y-3">
          <div className="hud-card rounded-xl p-3">
            <div className="mb-2 text-xs font-bold text-slate-200">
              Your Pinned Climb Goals ({goals.length})
            </div>
            {goals.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                Pin one of the recommended bottleneck goals or create your own on the left.
              </p>
            ) : (
              <div className="space-y-1.5">
                {goals.map((goal) => (
                  <div
                    key={goal.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border p-2 text-xs ${
                      goal.status === 'completed'
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-slate-700/70 bg-slate-900/70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggleGoalStatus(goal)}
                      className="flex items-center gap-2 text-left"
                    >
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          goal.status === 'completed' ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      />
                      <span
                        className={
                          goal.status === 'completed'
                            ? 'text-slate-400 line-through'
                            : 'font-medium text-slate-100'
                        }
                      >
                        {goal.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete goal ${goal.title}`}
                      onClick={() => void onDeleteGoal(goal.id)}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hud-card rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                <Database className="h-4 w-4" />
                High-Elo Match-V5 Meta Sampler
              </div>
              <button
                type="button"
                disabled={refreshingMeta}
                onClick={() => void handleRefreshMeta()}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshingMeta ? 'animate-spin' : ''}`} />
                {canSyncLive ? 'Sample Challenger' : 'Refresh Demo Sample'}
              </button>
            </div>
            {highEloMeta ? (
              <div className="mt-2 space-y-1.5 text-[11px]">
                <div className="text-slate-400">
                  Patch {highEloMeta.patch} ({highEloMeta.region}) •{' '}
                  {highEloMeta.sampleMatches} sampled high-elo matches blended into Champ Select
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {highEloMeta.champions.slice(0, 5).map((stat) => {
                    const champ = findJungleChampionById(stat.championId);
                    return (
                      <span
                        key={stat.championId}
                        className="rounded bg-slate-900/80 px-2 py-1 text-[11px] text-slate-200"
                      >
                        {champ?.name ?? `#${stat.championId}`}:{' '}
                        <span className="font-bold text-cyan-300">{stat.winRate}%</span> ({stat.games}g)
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
          </div>
        </div>
      </div>
    </div>
  );
}
