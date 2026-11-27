import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import pkg from '../../package.json';
import { synthesizeDemoPostGameDebrief } from '../domain/aiCoachFallback';
import { formatChampionName } from '../domain/championNames';
import { validateGroundedAiResponse } from '../domain/aiFactValidator';
import { getCachedAiResponse, hashAiContext, setCachedAiResponse } from '../domain/aiResponseCache';
import { evaluateFocusGoalAgainstMatch } from '../domain/climbLadderEngine';
import { formatClock } from '../domain/liveCoachEngine';
import { computePersonalLearningSnapshot } from '../domain/personalLearningEngine';
import {
  analyzePostGameMatch,
  formatRoleLabel,
  isJungleMatch,
} from '../domain/postGameReviewEngine';
import type { EmptyReason } from '../domain/sessionContext';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig, ClimbGoal, DemoScenarioId } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';
import { GoldXpDiffChart } from './GoldXpDiffChart';
import { PostGameTimelineMap } from './PostGameTimelineMap';
import { RecordingPlayerCard } from './RecordingPlayerCard';

export type PostGameSubpageId = 'overview' | 'timeline' | 'video' | 'ai';

const JUNGLE_SUBPAGES: Array<{ id: PostGameSubpageId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Map & Timeline' },
  { id: 'video', label: 'Video & Replay' },
  { id: 'ai', label: 'AI Debrief' },
];

const OFFROLE_SUBPAGES: Array<{ id: PostGameSubpageId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'video', label: 'Video & Replay' },
];

interface PostGameReviewViewProps {
  matches: MatchV5Detail[];
  targetDivision: string;
  patchVersion: string;
  appVersion?: string;
  aiConfig: AiCoachConfig;
  canSyncLive: boolean;
  isTauri?: boolean;
  focusGoal?: ClimbGoal | null;
  lastAutoSyncedMatchId?: string | null;
  autoSyncNotice?: string | null;
  emptyReason?: EmptyReason;
  onSyncMatches: () => Promise<void>;
  onOpenSettings?: (section?: 'account' | 'recording') => void;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

export function PostGameReviewView({
  matches,
  targetDivision,
  patchVersion,
  appVersion = pkg.version,
  aiConfig,
  canSyncLive,
  isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__),
  focusGoal,
  lastAutoSyncedMatchId,
  autoSyncNotice,
  emptyReason,
  onSyncMatches,
  onOpenSettings,
  onPreviewSample,
}: PostGameReviewViewProps) {
  const [selection, setSelection] = useState<{
    manualId: string | null;
    seenAutoSyncId: string | null;
  }>({
    manualId: null,
    seenAutoSyncId: lastAutoSyncedMatchId ?? null,
  });
  const [subpage, setSubpage] = useState<PostGameSubpageId>('overview');
  const [activeSecondState, setActiveSecondState] = useState<{
    matchId: string;
    second: number | null;
  }>({ matchId: '', second: null });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [aiLoadingMatchId, setAiLoadingMatchId] = useState<string | null>(null);
  const [aiDebriefState, setAiDebriefState] = useState<{
    matchId: string;
    text: string | null;
    verified?: boolean;
  }>({ matchId: '', text: null, verified: false });
  const [aiErrorState, setAiErrorState] = useState<{
    matchId: string;
    message: string | null;
  }>({ matchId: '', message: null });
  const [exportFeedbackState, setExportFeedbackState] = useState<{
    matchId: string;
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const pendingRevokesRef = useRef<Array<{ timerId: number; url: string }>>([]);

  useEffect(() => {
    mountedRef.current = true;
    const revokes = pendingRevokesRef;
    return () => {
      mountedRef.current = false;
      for (const entry of revokes.current) {
        window.clearTimeout(entry.timerId);
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(entry.url);
        }
      }
      revokes.current = [];
    };
  }, []);

  const followAutoSync =
    Boolean(lastAutoSyncedMatchId) &&
    lastAutoSyncedMatchId !== selection.seenAutoSyncId &&
    matches.some((m) => m.matchId === lastAutoSyncedMatchId);

  const effectiveSelectedId = followAutoSync
    ? lastAutoSyncedMatchId!
    : (selection.manualId ?? matches[0]?.matchId ?? '');

  const selectedMatch =
    matches.find((m) => m.matchId === effectiveSelectedId) ?? matches[0] ?? null;

  const activeSecond =
    selectedMatch && activeSecondState.matchId === selectedMatch.matchId
      ? activeSecondState.second
      : null;
  const report = useMemo(() => {
    if (!selectedMatch) return null;
    return analyzePostGameMatch(selectedMatch, targetDivision);
  }, [selectedMatch, targetDivision]);

  const aiContextJson = useMemo(() => {
    if (!report || !report.isJungle) return '';
    return JSON.stringify({
      champion: report.championName,
      enemyJungler: report.enemyJunglerName,
      duration: formatClock(report.durationSeconds),
      win: report.win,
      grade: report.grade,
      targetDivision,
      kpis: report.kpis,
      highlights: report.highlights.map((h) => h.title),
      mistakes: report.mistakes.map((m) => m.title),
      improvements: report.improvements.map((imp) => imp.title),
    });
  }, [report, targetDivision]);

  const aiCacheKey =
    selectedMatch && aiContextJson
      ? `${selectedMatch.matchId}:${hashAiContext(aiContextJson)}`
      : '';

  const cachedDebrief = useMemo(() => {
    if (!aiCacheKey || !aiContextJson || aiConfig.provider === 'off') return null;
    const entry = getCachedAiResponse(
      'post_game',
      aiCacheKey,
      aiConfig.provider,
      aiConfig.model
    );
    if (!entry) return null;
    return validateGroundedAiResponse(aiContextJson, entry.text).valid ? entry : null;
  }, [aiCacheKey, aiContextJson, aiConfig.provider, aiConfig.model]);
  const aiError =
    aiCacheKey && aiErrorState.matchId === aiCacheKey ? aiErrorState.message : null;
  const hasLiveMatchDebrief = Boolean(
    aiCacheKey &&
      aiDebriefState.matchId === aiCacheKey &&
      aiDebriefState.text !== null
  );
  const aiDebrief = hasLiveMatchDebrief
    ? aiDebriefState.text
    : !aiError && cachedDebrief
      ? cachedDebrief.text
      : null;
  const aiDebriefVerified = hasLiveMatchDebrief
    ? Boolean(aiDebriefState.verified)
    : !aiError && Boolean(cachedDebrief?.verified);
  const aiDebriefFromCache = !hasLiveMatchDebrief && !aiError && Boolean(cachedDebrief);
  const exportFeedback =
    selectedMatch && exportFeedbackState?.matchId === selectedMatch.matchId
      ? exportFeedbackState
      : null;

  const availableSubpages = report?.isJungle ? JUNGLE_SUBPAGES : OFFROLE_SUBPAGES;
  const activeSubpage: PostGameSubpageId = availableSubpages.some((t) => t.id === subpage)
    ? subpage
    : 'overview';

  const focusGoalResult = useMemo(() => {
    if (!focusGoal || !report || !report.isJungle) return null;
    return evaluateFocusGoalAgainstMatch(focusGoal, report.kpis);
  }, [focusGoal, report]);

  const personalLearning = useMemo(() => {
    const jgMatches = matches.filter(
      (m) => isJungleMatch(m) && m.matchId !== selectedMatch?.matchId
    );
    return computePersonalLearningSnapshot(jgMatches, matches, targetDivision);
  }, [matches, selectedMatch?.matchId, targetDivision]);

  function handleExportReview() {
    if (!report) return;
    const payload = {
      schemaVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      matchId: report.matchId,
      role: report.role,
      isJungle: report.isJungle,
      championName: report.championName,
      enemyJunglerName: report.enemyJunglerName,
      win: report.win,
      durationSeconds: report.durationSeconds,
      targetDivision,
      grade: report.grade,
      kpis: report.kpis,
      highlights: report.highlights,
      mistakes: report.mistakes,
      improvements: report.improvements,
    };

    const filename = `betterjungler-review-${report.matchId}.json`;
    try {
      const json = JSON.stringify(payload, null, 2);
      const anchor = document.createElement('a');
      anchor.download = filename;

      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
          anchor.href = url;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
          const timerId = window.setTimeout(() => {
            pendingRevokesRef.current = pendingRevokesRef.current.filter(
              (entry) => entry.url !== url
            );
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(url);
            }
          }, 1000);
          pendingRevokesRef.current.push({ timerId, url });
        }
      } else {
        try {
          anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
        }
      }
      setExportFeedbackState({
        matchId: report.matchId,
        kind: 'success',
        message: `Exported ${filename}`,
      });
    } catch (err) {
      setExportFeedbackState({
        matchId: report.matchId,
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to export review JSON',
      });
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await onSyncMatches();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync Riot matches.');
    } finally {
      setSyncing(false);
    }
  }

  const isAiLoading = Boolean(aiCacheKey && aiLoadingMatchId === aiCacheKey);

  async function handleGenerateAiDebrief() {
    if (!report || !report.isJungle || !aiContextJson || !aiCacheKey) return;
    const requestCacheKey = aiCacheKey;
    setAiLoadingMatchId(requestCacheKey);
    setAiDebriefState({ matchId: requestCacheKey, text: null, verified: false });
    setAiErrorState({ matchId: requestCacheKey, message: null });
    const context = aiContextJson;

    try {
      const response = await generateAiDebrief(context);
      if (!mountedRef.current) return;
      const check = validateGroundedAiResponse(context, response);
      if (!check.valid) {
        setAiErrorState({
          matchId: requestCacheKey,
          message: `AI debrief rejected by numeric fact validator — ungrounded figures: ${check.ungroundedTokens.join(', ')}`,
        });
        return;
      }
      if (aiConfig.provider !== 'off') {
        setCachedAiResponse('post_game', requestCacheKey, aiConfig.provider, aiConfig.model, {
          text: response,
          verified: true,
        });
      }
      setAiDebriefState({ matchId: requestCacheKey, text: response, verified: true });
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof Error && err.message === 'DEMO_FALLBACK') {
        const fallback = synthesizeDemoPostGameDebrief(report);
        const check = validateGroundedAiResponse(context, fallback);
        setAiDebriefState({
          matchId: requestCacheKey,
          text: fallback,
          verified: check.valid,
        });
      } else {
        setAiErrorState({
          matchId: requestCacheKey,
          message: err instanceof Error ? err.message : 'AI Debrief failed.',
        });
      }
    } finally {
      if (mountedRef.current) {
        setAiLoadingMatchId((prev) => (prev === requestCacheKey ? null : prev));
      }
    }
  }

  if (!selectedMatch || !report) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={History}
          title="No ranked jungle matches loaded yet"
          description={
            emptyReason === 'no_account' || !canSyncLive
              ? 'Save your Riot ID & Personal Riot API Key in Settings to download Match-V5 timelines and review pathing, objectives, and mistakes.'
              : 'Sync your recent ranked games to review minute-by-minute gold swings, pathing replay, and objective mistakes.'
          }
          action={
            canSyncLive
              ? {
                  label: syncing ? 'Syncing...' : 'Sync Recent Games',
                  onClick: () => void handleSync(),
                  disabled: syncing,
                }
              : onOpenSettings
                ? {
                    label: 'Open Settings',
                    onClick: () => onOpenSettings('account'),
                  }
                : undefined
          }
          onPreviewSample={onPreviewSample ? () => onPreviewSample('in_game_mid') : undefined}
          sampleLabel="Preview sample review"
        >
          {syncError && (
            <p className="t-caption mt-3 rounded-[7px] border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-rose-200">
              {syncError}
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  const gradeColor =
    report.grade === 'S'
      ? 'text-amber-200 border-amber-300/40 bg-amber-400/10'
      : report.grade === 'A'
        ? 'text-emerald-200 border-emerald-300/40 bg-emerald-400/10'
        : report.grade === 'B'
          ? 'text-white border-white/25 bg-white/10'
          : report.grade === 'N/A'
            ? 'text-slate-300 border-white/15 bg-white/[0.04]'
            : 'text-rose-200 border-rose-300/40 bg-rose-400/10';

  const effectiveCursorSecond = activeSecond ?? selectedMatch.durationSeconds;
  const csTenLabel =
    report.kpis.csAt10Minute === 11 ? 'CS @5 / @11' : 'CS @5 / @10';
  const roleLabel = formatRoleLabel(report.role);

  function jumpToSecondOnTimeline(sec: number) {
    if (!selectedMatch) return;
    setActiveSecondState({
      matchId: selectedMatch.matchId,
      second: Math.round(sec),
    });
    setSubpage('timeline');
  }

  return (
    <div className="space-y-5">
      {/* Match Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="lg-segmented flex flex-wrap items-center gap-1">
          {matches.map((m) => {
            const active = m.matchId === selectedMatch.matchId;
            const mJungle = isJungleMatch(m);
            const mDisplayName = formatChampionName(m.championName, m.championId);
            return (
              <button
                key={m.matchId}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelection({
                    manualId: m.matchId,
                    seenAutoSyncId: lastAutoSyncedMatchId ?? null,
                  });
                  if (!mJungle) {
                    setSubpage('overview');
                  }
                  setActiveSecondState({
                    matchId: m.matchId,
                    second: m.durationSeconds,
                  });
                }}
                className={`rounded-[7px] px-3 py-1 text-left text-xs transition ${
                  active
                    ? 'lg-segment-active font-semibold'
                    : 'border border-transparent text-white/[0.62] hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <span
                  className={`mr-1.5 font-bold ${
                    m.win ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {m.win ? 'W' : 'L'}
                </span>
                <span>{mDisplayName}</span>
                {!mJungle && (
                  <span className="ml-1.5 rounded bg-white/10 px-1 py-0.5 text-[10px] font-medium text-white/[0.72]">
                    {formatRoleLabel(m.role)}
                  </span>
                )}
                <span className="tabular-nums ml-1.5 text-[11px] text-white/[0.55]">
                  {m.kills}/{m.deaths}/{m.assists}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!report}
            onClick={handleExportReview}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white/[0.85] disabled:opacity-50"
          >
            Export Review JSON
          </button>
          <button
            type="button"
            disabled={syncing || (!canSyncLive && typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__))}
            onClick={() => void handleSync()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {syncing
              ? 'Syncing...'
              : canSyncLive
                ? 'Sync Recent Games'
                : 'Refresh Sample Games'}
          </button>
        </div>
      </div>

      {exportFeedback && (
        <p
          role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
          className={`t-caption rounded-[8px] border px-3 py-2 ${
            exportFeedback.kind === 'error'
              ? 'border-rose-400/35 bg-rose-500/10 text-rose-200'
              : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          {exportFeedback.message}
        </p>
      )}

      {syncError && (
        <p className="t-caption rounded-[8px] border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-rose-200">
          {syncError}
        </p>
      )}

      {autoSyncNotice && !syncError && (
        <p
          role="status"
          className="t-caption rounded-[8px] border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-amber-100"
        >
          {autoSyncNotice}
        </p>
      )}

      {/* Match Header + Verdict Grade */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="t-title text-white/[0.92]">
                {report.isJungle
                  ? `${report.championName} vs ${report.enemyJunglerName}`
                  : `${report.championName} (${roleLabel})`}
              </h2>
              <span
                className={`t-caption font-semibold ${
                  report.win ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {report.win ? 'Victory' : 'Defeat'} · {formatClock(report.durationSeconds)}
              </span>
              {selectedMatch.matchId === lastAutoSyncedMatchId && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  Auto-Synced
                </span>
              )}
              {!report.isJungle && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white/[0.78]">
                  Off-Role ({roleLabel})
                </span>
              )}
            </div>
            <p className="t-caption mt-0.5 text-white/[0.55]">
              {report.isJungle
                ? `Jungle evaluation benchmarked against ${targetDivision}`
                : 'Basic match stats shown · Jungle benchmarks & climb metrics exclude off-role games'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {focusGoal && focusGoalResult && (
              <div className="lg-inset flex items-center gap-2 px-2.5 py-1.5">
                <span
                  className={`t-caption font-bold ${
                    focusGoalResult.passed ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  Focus {focusGoalResult.passed ? 'PASS' : 'MISS'}
                </span>
                <div className="t-caption">
                  <div className="font-medium text-white/[0.92]">{focusGoal.title}</div>
                  <div className="tabular-nums text-[11px] text-white/[0.55]">
                    {focusGoalResult.deltaLabel}
                  </div>
                </div>
              </div>
            )}

            <div
              className={`flex h-11 min-w-[44px] items-center justify-center rounded-full border px-2 text-sm font-bold ${gradeColor}`}
              title={report.isJungle ? 'Overall Jungle Performance Grade' : 'Off-Role Match'}
            >
              {report.grade}
            </div>
          </div>
        </div>
      </GlassSurface>

      {/* Per-Game Subpage Tab Strip */}
      <div
        role="tablist"
        aria-label="Match review sections"
        className="lg-segmented inline-flex flex-wrap items-center gap-1"
      >
        {availableSubpages.map((tab) => {
          const isActive = activeSubpage === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSubpage(tab.id)}
              className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? 'lg-segment-active font-semibold'
                  : 'text-white/[0.62] hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Subpage 1: Overview */}
      {activeSubpage === 'overview' && (
        <div className="space-y-4">
          {!report.isJungle ? (
            <>
              <div
                role="status"
                className="rounded-[10px] border border-white/15 bg-white/[0.04] px-4 py-3 text-xs text-white/[0.78]"
              >
                <strong className="font-semibold text-white">Off-role game ({roleLabel})</strong> —
                No deep jungle evaluation or lane-CS grading is generated here, and this match is
                excluded from your Jungle Climb benchmarks and mistake trends.
              </div>
              <GlassSurface className="p-4">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {[
                    {
                      label: 'K / D / A',
                      value: `${selectedMatch.kills}/${selectedMatch.deaths}/${selectedMatch.assists}`,
                    },
                    { label: 'CS / min', value: String(report.kpis.csPerMin) },
                    { label: 'Vision / min', value: String(report.kpis.visionPerMin) },
                    { label: 'Control wards', value: String(report.kpis.controlWardsBought) },
                    { label: 'Kill participation', value: `${report.kpis.killParticipationPct}%` },
                  ].map((stat) => (
                    <div key={stat.label} className="lg-inset px-3 py-2.5">
                      <div className="t-caption text-white/[0.55]">{stat.label}</div>
                      <div className="tabular-nums mt-1 text-base font-bold text-white">
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassSurface>
            </>
          ) : (
            <>
              <GlassSurface className="space-y-3 p-4">
                <div>
                  <span className="t-caption font-semibold text-white/[0.55]">
                    Last Game Takeaway
                  </span>
                  <p className="t-body mt-0.5 text-white/[0.88]">
                    {report.mistakes[0]?.detail ??
                      report.improvements[0]?.detail ??
                      report.highlights[0]?.detail ??
                      'Solid jungle fundamentals across objective setups.'}
                  </p>
                  {personalLearning &&
                    personalLearning.jungleMatchCount >= 3 &&
                    personalLearning.baselines?.csPerMin && (
                    <p className="tabular-nums mt-1 text-[11px] text-white/[0.5]">
                      vs Personal EWM Baseline: {personalLearning.baselines.csPerMin.shrunkBaseline}{' '}
                      CS/min · {personalLearning.baselines.visionPerMin.shrunkBaseline} vis/min ·{' '}
                      {personalLearning.baselines.preObjectiveDeaths.shrunkBaseline} pre-obj deaths/g
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
                  {[
                    { label: 'CS / min', value: String(report.kpis.csPerMin) },
                    {
                      label: csTenLabel,
                      value: `${report.kpis.csAt5 ?? 'n/a'} / ${report.kpis.csAt10 ?? 'n/a'}`,
                    },
                    {
                      label: 'Gold diff @15',
                      value: `${report.kpis.goldDiffAt15 >= 0 ? '+' : ''}${report.kpis.goldDiffAt15}g`,
                    },
                    { label: 'Obj share', value: `${report.kpis.objectiveSharePct}%` },
                    { label: 'Vision / min', value: String(report.kpis.visionPerMin) },
                    { label: 'Pre-obj deaths', value: String(report.kpis.preObjectiveDeaths) },
                    { label: 'Control wards', value: String(report.kpis.controlWardsBought) },
                  ].map((kpi) => (
                    <div key={kpi.label} className="lg-inset px-3 py-2.5">
                      <div className="t-caption text-white/[0.55]">{kpi.label}</div>
                      <div className="tabular-nums mt-1 text-base font-bold text-white">
                        {kpi.value}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassSurface>

              <GlassSurface className="p-4">
                <div className="grid gap-6 md:grid-cols-3">
                  <div>
                    <div className="t-caption mb-2.5 font-semibold text-emerald-300">
                      What You Did Good
                    </div>
                    <div className="space-y-2.5">
                      {report.highlights.map((item) => (
                        <div key={item.id} className="t-caption">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-white/[0.92]">{item.title}</span>
                            {item.timestampSec !== undefined && (
                              <button
                                type="button"
                                onClick={() => jumpToSecondOnTimeline(item.timestampSec!)}
                                className="tabular-nums shrink-0 rounded-[5px] border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-white/[0.72] hover:text-white"
                              >
                                Jump @ {formatClock(item.timestampSec)}
                              </button>
                            )}
                          </div>
                          <p className="mt-0.5 text-white/[0.58]">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
                    <div className="t-caption mb-2.5 font-semibold text-rose-300">
                      Mistakes to Cut Out
                    </div>
                    <div className="space-y-2.5">
                      {report.mistakes.length > 0 ? (
                        report.mistakes.map((item) => (
                          <div key={item.id} className="t-caption">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-white/[0.92]">{item.title}</span>
                              {item.timestampSec !== undefined && (
                                <button
                                  type="button"
                                  onClick={() => jumpToSecondOnTimeline(item.timestampSec!)}
                                  className="tabular-nums shrink-0 rounded-[5px] border border-rose-400/25 bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/20"
                                >
                                  Jump @ {formatClock(item.timestampSec)}
                                </button>
                              )}
                            </div>
                            <p className="mt-0.5 text-white/[0.58]">{item.detail}</p>
                          </div>
                        ))
                      ) : (
                        <p className="t-caption text-white/[0.58]">
                          No major macro mistakes flagged in this match.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
                    <div className="t-caption mb-2.5 font-semibold text-white/[0.92]">
                      Where &amp; How to Improve
                    </div>
                    <div className="space-y-2.5">
                      {report.improvements.map((item) => (
                        <div key={item.id} className="t-caption">
                          <div className="font-semibold text-white/[0.92]">{item.title}</div>
                          <p className="mt-0.5 text-white/[0.58]">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </GlassSurface>
            </>
          )}
        </div>
      )}

      {/* Subpage 2: Map & Timeline */}
      {activeSubpage === 'timeline' && report.isJungle && (
        <div className="space-y-4">
          <GoldXpDiffChart
            key={`chart-${selectedMatch.matchId}`}
            match={selectedMatch}
            activeSecond={effectiveCursorSecond}
            onSelectSecond={(second) =>
              setActiveSecondState({ matchId: selectedMatch.matchId, second })
            }
          />

          <PostGameTimelineMap
            key={selectedMatch.matchId}
            durationSeconds={selectedMatch.durationSeconds}
            patchVersion={patchVersion}
            pathPoints={report.pathPoints}
            enemyPathPoints={report.enemyPathPoints}
            markers={report.markers}
            activeSecond={effectiveCursorSecond}
            onChangeSecond={(second) =>
              setActiveSecondState({ matchId: selectedMatch.matchId, second })
            }
          />
        </div>
      )}

      {/* Subpage 3: Video & Replay */}
      {activeSubpage === 'video' && (
        <RecordingPlayerCard
          key={`rec-${selectedMatch.matchId}`}
          matchId={selectedMatch.matchId}
          durationSeconds={selectedMatch.durationSeconds}
          activeSecond={effectiveCursorSecond}
          isTauri={isTauri}
          onSelectSecond={(second) =>
            setActiveSecondState({ matchId: selectedMatch.matchId, second })
          }
          onOpenSettings={onOpenSettings ? () => onOpenSettings('recording') : undefined}
        />
      )}

      {/* Subpage 4: AI Debrief */}
      {activeSubpage === 'ai' && report.isJungle && (
        <GlassSurface className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="t-caption font-medium text-white/[0.75]">
              Optional AI Coach Debrief (
              {aiConfig.provider === 'off'
                ? 'Built-in Coaching Preview / Configure AI in Settings'
                : `${aiConfig.provider.toUpperCase()} · ${aiConfig.model}`}
              )
            </span>
            <button
              type="button"
              disabled={isAiLoading}
              onClick={() => void handleGenerateAiDebrief()}
              className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {isAiLoading
                ? 'Generating...'
                : aiDebrief
                  ? 'Regenerate AI Debrief'
                  : 'Generate AI Coach Debrief'}
            </button>
          </div>

          {aiDebrief && (
            <div className="mt-3 space-y-1.5">
              {(aiDebriefVerified || aiDebriefFromCache) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {aiDebriefVerified && (
                    <div
                      title="Cited metrics and timestamps matched against provided match telemetry."
                      className="inline-flex items-center rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"
                    >
                      Telemetry Numbers Checked
                    </div>
                  )}
                  {aiDebriefFromCache && (
                    <div className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/[0.7]">
                      Cached
                    </div>
                  )}
                </div>
              )}
              <pre className="lg-inset t-caption whitespace-pre-wrap p-3 font-sans leading-relaxed text-white/[0.88]">
                {aiDebrief}
              </pre>
            </div>
          )}
          {!aiDebrief && !aiError && (
            <p className="t-caption mt-3 text-white/[0.55]">
              Click &quot;Generate AI Coach Debrief&quot; for a narrative summary grounded in your{' '}
              {report.championName} vs {report.enemyJunglerName} match telemetry.
            </p>
          )}
          {aiError && <p className="t-caption mt-2 text-rose-300">{aiError}</p>}
        </GlassSurface>
      )}
    </div>
  );
}
