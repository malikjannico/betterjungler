import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import pkg from '../../package.json';
import { synthesizeDemoPostGameDebrief } from '../domain/aiCoachFallback';
import { evaluateFocusGoalAgainstMatch } from '../domain/climbLadderEngine';
import { formatClock } from '../domain/liveCoachEngine';
import { analyzePostGameMatch } from '../domain/postGameReviewEngine';
import type { EmptyReason } from '../domain/sessionContext';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig, ClimbGoal, DemoScenarioId } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';
import { GoldXpDiffChart } from './GoldXpDiffChart';
import { PostGameTimelineMap } from './PostGameTimelineMap';

interface PostGameReviewViewProps {
  matches: MatchV5Detail[];
  targetDivision: string;
  patchVersion: string;
  appVersion?: string;
  aiConfig: AiCoachConfig;
  canSyncLive: boolean;
  focusGoal?: ClimbGoal | null;
  lastAutoSyncedMatchId?: string | null;
  autoSyncNotice?: string | null;
  emptyReason?: EmptyReason;
  onSyncMatches: () => Promise<void>;
  onOpenSettings?: () => void;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

export function PostGameReviewView({
  matches,
  targetDivision,
  patchVersion,
  appVersion = pkg.version,
  aiConfig,
  canSyncLive,
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
  const [activeSecondState, setActiveSecondState] = useState<{
    matchId: string;
    second: number | null;
  }>({ matchId: '', second: null });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDebriefState, setAiDebriefState] = useState<{
    matchId: string;
    text: string | null;
  }>({ matchId: '', text: null });
  const [aiErrorState, setAiErrorState] = useState<{
    matchId: string;
    message: string | null;
  }>({ matchId: '', message: null });
  const [exportFeedbackState, setExportFeedbackState] = useState<{
    matchId: string;
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const pendingRevokesRef = useRef<Array<{ timerId: number; url: string }>>([]);

  useEffect(() => {
    const revokes = pendingRevokesRef;
    return () => {
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
  const aiDebrief =
    selectedMatch && aiDebriefState.matchId === selectedMatch.matchId ? aiDebriefState.text : null;
  const aiError =
    selectedMatch && aiErrorState.matchId === selectedMatch.matchId ? aiErrorState.message : null;
  const exportFeedback =
    selectedMatch && exportFeedbackState?.matchId === selectedMatch.matchId
      ? exportFeedbackState
      : null;

  const report = useMemo(() => {
    if (!selectedMatch) return null;
    return analyzePostGameMatch(selectedMatch, targetDivision);
  }, [selectedMatch, targetDivision]);

  const focusGoalResult = useMemo(() => {
    if (!focusGoal || !report) return null;
    return evaluateFocusGoalAgainstMatch(focusGoal, report.kpis);
  }, [focusGoal, report]);

  function handleExportReview() {
    if (!report) return;
    const payload = {
      schemaVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      matchId: report.matchId,
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

  async function handleGenerateAiDebrief() {
    if (!report) return;
    const requestMatchId = report.matchId;
    setAiLoading(true);
    setAiErrorState({ matchId: requestMatchId, message: null });
    const context = JSON.stringify({
      champion: report.championName,
      enemyJungler: report.enemyJunglerName,
      duration: formatClock(report.durationSeconds),
      win: report.win,
      grade: report.grade,
      targetDivision,
      kpis: report.kpis,
      highlights: report.highlights.map((h) => h.title),
      mistakes: report.mistakes.map((m) => m.title),
    });

    try {
      const response = await generateAiDebrief(context);
      setAiDebriefState({ matchId: requestMatchId, text: response });
    } catch (err) {
      if (err instanceof Error && err.message === 'DEMO_FALLBACK') {
        setAiDebriefState({
          matchId: requestMatchId,
          text: synthesizeDemoPostGameDebrief(report),
        });
      } else {
        setAiErrorState({
          matchId: requestMatchId,
          message: err instanceof Error ? err.message : 'AI Debrief failed.',
        });
      }
    } finally {
      setAiLoading(false);
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
              : 'Sync your recent ranked jungle games to review minute-by-minute gold swings, pathing replay, and objective mistakes.'
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
                    onClick: onOpenSettings,
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
          : 'text-rose-200 border-rose-300/40 bg-rose-400/10';

  const effectiveCursorSecond = activeSecond ?? selectedMatch.durationSeconds;
  const csTenLabel =
    report.kpis.csAt10Minute === 11 ? 'CS @5 / @11' : 'CS @5 / @10';

  return (
    <div className="space-y-6">
      {/* Match Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="lg-segmented flex flex-wrap items-center gap-1">
          {matches.map((m) => {
            const active = m.matchId === selectedMatch.matchId;
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
                <span>{m.championName}</span>
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

      {/* Last Game Takeaway & Lead Focus Goal PASS/MISS Verdict */}
      <GlassSurface className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-caption font-semibold text-white/[0.55]">
              Last Game Takeaway
            </span>
            {selectedMatch.matchId === lastAutoSyncedMatchId && (
              <span className="t-caption font-medium text-emerald-300">Auto-Synced</span>
            )}
          </div>
          <p className="t-body text-white/[0.88]">
            {report.mistakes[0]?.detail ??
              report.improvements[0]?.detail ??
              report.highlights[0]?.detail ??
              'Solid jungle fundamentals across objective setups.'}
          </p>
        </div>

        {focusGoal && focusGoalResult && (
          <div className="lg-inset flex items-center gap-2.5 px-3 py-2">
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
      </GlassSurface>

      {/* Match Header + Grade + KPIs */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="t-title text-white/[0.92]">
                {report.championName} vs {report.enemyJunglerName}
              </h2>
              <span
                className={`t-caption font-semibold ${
                  report.win ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {report.win ? 'Victory' : 'Defeat'} · {formatClock(report.durationSeconds)}
              </span>
            </div>
            <p className="t-caption mt-0.5 text-white/[0.55]">
              Benchmarked against {targetDivision}
            </p>
          </div>

          <div
            className={`flex h-11 w-11 items-center justify-center rounded-full border text-base font-bold ${gradeColor}`}
            title="Overall Jungle Performance Grade"
          >
            {report.grade}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
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

      {/* Synchronized Gold/XP Timeline Curve & Interactive Rift Replay */}
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

      {/* What You Did Good / Mistakes / Where to Improve */}
      <GlassSurface className="p-4">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="t-caption mb-2.5 font-semibold text-emerald-300">
              What You Did Good
            </div>
            <div className="space-y-2.5">
              {report.highlights.map((item) => (
                <div key={item.id} className="t-caption">
                  <div className="font-semibold text-white/[0.92]">{item.title}</div>
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
                    <div className="font-semibold text-white/[0.92]">{item.title}</div>
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

      {/* Optional BYOK AI Coach Debrief */}
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
            disabled={aiLoading}
            onClick={() => void handleGenerateAiDebrief()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {aiLoading ? 'Generating...' : 'Generate AI Coach Debrief'}
          </button>
        </div>

        {aiDebrief && (
          <pre className="lg-inset t-caption mt-3 whitespace-pre-wrap p-3 font-sans leading-relaxed text-white/[0.88]">
            {aiDebrief}
          </pre>
        )}
        {aiError && <p className="t-caption mt-2 text-rose-300">{aiError}</p>}
      </GlassSurface>
    </div>
  );
}
