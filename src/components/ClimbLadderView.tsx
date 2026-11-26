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
import { GlassSurface } from './GlassSurface';

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
    <div className="space-y-3.5">
      {/* Division Climb Header */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-sky-300" />
              <h2 className="text-sm font-bold text-slate-50">
                Division Climb Ladder → {targetDivision}
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Rolling last {evaluation.matchCount} ranked matches ({evaluation.winRatePct}% WR) •
              Readiness Score:{' '}
              <span className="font-bold text-sky-300">{evaluation.overallReadinessPct}%</span>
            </p>
          </div>

          {summonerProfile ? (
            <div className="lg-inset border-sky-300/30 bg-sky-400/10 px-3 py-1.5 text-xs">
              <div className="font-bold text-sky-200">{summonerProfile.riotId}</div>
              <div className="text-[11px] text-slate-300">
                {summonerProfile.tier} {summonerProfile.rank} • {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-slate-300">
              Using {evaluation.matchCount} local/demo ranked games
            </span>
          )}
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-500"
            style={{ width: `${evaluation.overallReadinessPct}%` }}
          />
        </div>
      </GlassSurface>

      {/* 6-Pillar Division Benchmarks */}
      <GlassSurface className="p-4">
        <div className="mb-2.5 text-xs font-bold text-slate-100">
          Jungle KPIs vs. {evaluation.targetTier} Benchmark
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {evaluation.comparisons.map((comp) => {
            const badgeStyle =
              comp.status === 'on_track'
                ? 'bg-emerald-400/15 text-emerald-200'
                : comp.status === 'close'
                  ? 'bg-amber-400/15 text-amber-200'
                  : 'bg-rose-400/15 text-rose-200';

            return (
              <div key={comp.metric} className="lg-inset p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{comp.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${badgeStyle}`}
                  >
                    {comp.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="tabular-nums text-base font-extrabold text-sky-200">
                    {comp.currentValue}
                    {comp.unit}
                  </span>
                  <span className="tabular-nums text-[11px] text-slate-400">
                    Target {comp.lowerIsBetter ? '≤' : '≥'} {comp.targetValue}
                    {comp.unit}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
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

      {/* LP Progression & Multi-Game Death Heatmap */}
      <ClimbTrendCharts matches={matches} lpHistory={lpHistory} />

      {/* Goals & High-Elo Sampler */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <GlassSurface className="space-y-2.5 p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
            <Target className="h-4 w-4 text-amber-300" />
            Recommended Next Focus Goals
          </div>
          {evaluation.suggestedGoals.length > 0 ? (
            evaluation.suggestedGoals.map((sg) => {
              const pinned = existingIds.has(sg.id);
              return (
                <div
                  key={sg.id}
                  className="lg-inset flex items-center justify-between gap-2 p-2.5 text-xs"
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
                    className="lg-btn-glass shrink-0 px-2.5 py-1 text-[11px] font-semibold text-sky-200 disabled:opacity-50"
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

          <form
            onSubmit={(e) => void handleAddCustomGoal(e)}
            className="mt-3 space-y-2 border-t border-white/[0.07] pt-3"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
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
                  <option key={k} value={k} className="bg-slate-900">
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
                className="lg-btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </form>
        </GlassSurface>

        <div className="space-y-3.5">
          <GlassSurface className="p-4">
            <div className="mb-2.5 text-xs font-bold text-slate-100">
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
                    className={`lg-inset flex items-center justify-between gap-2 p-2.5 text-xs ${
                      goal.status === 'completed'
                        ? 'border-emerald-400/35 bg-emerald-400/10'
                        : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggleGoalStatus(goal)}
                      className="flex items-center gap-2 text-left"
                    >
                      <CheckCircle2
                        className={`h-4 w-4 shrink-0 ${
                          goal.status === 'completed' ? 'text-emerald-300' : 'text-slate-500'
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
                      className="text-slate-500 transition hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GlassSurface>

          <GlassSurface className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-200">
                <Database className="h-4 w-4 text-sky-300" />
                High-Elo Match-V5 Meta Sampler
              </div>
              <button
                type="button"
                disabled={refreshingMeta}
                onClick={() => void handleRefreshMeta()}
                className="lg-btn-glass inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-sky-200 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshingMeta ? 'animate-spin' : ''}`} />
                {canSyncLive ? 'Sample Challenger' : 'Refresh Demo Sample'}
              </button>
            </div>
            {highEloMeta ? (
              <div className="mt-2.5 space-y-2 text-[11px]">
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
                        className="lg-inset px-2.5 py-1 text-[11px] text-slate-200"
                      >
                        {champ?.name ?? `#${stat.championId}`}:{' '}
                        <span className="font-bold text-sky-300">{stat.winRate}%</span> (
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
