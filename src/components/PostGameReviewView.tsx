import { useMemo, useState } from 'react';
import { synthesizeDemoPostGameDebrief } from '../domain/aiCoachFallback';
import { formatClock } from '../domain/liveCoachEngine';
import { analyzePostGameMatch } from '../domain/postGameReviewEngine';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { GoldXpDiffChart } from './GoldXpDiffChart';
import { PostGameTimelineMap } from './PostGameTimelineMap';

interface PostGameReviewViewProps {
  matches: MatchV5Detail[];
  targetDivision: string;
  patchVersion: string;
  aiConfig: AiCoachConfig;
  canSyncLive: boolean;
  onSyncMatches: () => Promise<void>;
}

export function PostGameReviewView({
  matches,
  targetDivision,
  patchVersion,
  aiConfig,
  canSyncLive,
  onSyncMatches,
}: PostGameReviewViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string>(
    matches[0]?.matchId ?? ''
  );
  const [activeMinute, setActiveMinute] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDebrief, setAiDebrief] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const selectedMatch =
    matches.find((m) => m.matchId === selectedMatchId) ?? matches[0] ?? null;

  const report = useMemo(() => {
    if (!selectedMatch) return null;
    return analyzePostGameMatch(selectedMatch, targetDivision);
  }, [selectedMatch, targetDivision]);

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
    setAiLoading(true);
    setAiError(null);
    const context = JSON.stringify({
      champion: report.championName,
      enemyJungler: report.enemyJunglerName,
      win: report.win,
      grade: report.grade,
      targetDivision,
      kpis: report.kpis,
      highlights: report.highlights.map((h) => h.title),
      mistakes: report.mistakes.map((m) => m.title),
    });

    try {
      const response = await generateAiDebrief(context);
      setAiDebrief(response);
    } catch (err) {
      if (err instanceof Error && err.message === 'DEMO_FALLBACK') {
        setAiDebrief(synthesizeDemoPostGameDebrief(report));
      } else {
        setAiError(err instanceof Error ? err.message : 'AI Debrief failed.');
      }
    } finally {
      setAiLoading(false);
    }
  }

  if (!selectedMatch || !report) {
    return (
      <GlassSurface className="space-y-3 p-8 text-center text-xs text-slate-300">
        <p>
          No ranked jungle matches loaded yet. Sync your recent games or select a Demo scenario.
        </p>
        <div>
          <button
            type="button"
            disabled={!canSyncLive || syncing}
            onClick={() => void handleSync()}
            className="lg-btn-glass px-4 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncing ? 'Syncing...' : canSyncLive ? 'Sync Recent Games' : 'Save Riot API Key in Settings'}
          </button>
        </div>
        {syncError && (
          <p className="mx-auto max-w-md rounded-lg border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
            {syncError}
          </p>
        )}
      </GlassSurface>
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

  return (
    <div className="space-y-4">
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
                  setSelectedMatchId(m.matchId);
                  setActiveMinute(Math.max(1, Math.ceil(m.durationSeconds / 60)));
                  setAiDebrief(null);
                  setAiError(null);
                }}
                className={`rounded-full px-3 py-1 text-left text-xs transition ${
                  active
                    ? 'lg-segment-active font-semibold'
                    : 'border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
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
                <span className="tabular-nums ml-1.5 text-[10px] text-slate-400">
                  {m.kills}/{m.deaths}/{m.assists}
                </span>
              </button>
            );
          })}
        </div>

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

      {syncError && (
        <p className="rounded-lg border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {syncError}
        </p>
      )}

      {/* Match Header + Grade + KPIs */}
      <GlassSurface className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-white">
                {report.championName} vs {report.enemyJunglerName}
              </h2>
              <span
                className={`text-[11px] font-semibold ${
                  report.win ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {report.win ? 'VICTORY' : 'DEFEAT'} · {formatClock(report.durationSeconds)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
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

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'CS / Min', value: String(report.kpis.csPerMin) },
            {
              label: 'Gold Diff @15',
              value: `${report.kpis.goldDiffAt15 >= 0 ? '+' : ''}${report.kpis.goldDiffAt15}g`,
            },
            { label: 'Obj Share', value: `${report.kpis.objectiveSharePct}%` },
            { label: 'Vision / Min', value: String(report.kpis.visionPerMin) },
            { label: 'Pre-Obj Deaths', value: String(report.kpis.preObjectiveDeaths) },
            { label: 'Control Wards', value: String(report.kpis.controlWardsBought) },
          ].map((kpi) => (
            <div key={kpi.label} className="lg-inset px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                {kpi.label}
              </div>
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
        activeMinute={activeMinute ?? Math.max(1, Math.ceil(selectedMatch.durationSeconds / 60))}
        onSelectMinute={setActiveMinute}
      />

      <PostGameTimelineMap
        key={selectedMatch.matchId}
        durationSeconds={selectedMatch.durationSeconds}
        patchVersion={patchVersion}
        pathPoints={report.pathPoints}
        markers={report.markers}
        activeMinute={activeMinute ?? Math.max(1, Math.ceil(selectedMatch.durationSeconds / 60))}
        onChangeMinute={setActiveMinute}
      />

      {/* What You Did Good / Mistakes / Where to Improve */}
      <GlassSurface className="p-5">
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="mb-2.5 text-xs font-semibold text-emerald-300">
              What You Did Good
            </div>
            <div className="space-y-2.5">
              {report.highlights.map((item) => (
                <div key={item.id} className="text-[11px]">
                  <div className="font-semibold text-white">{item.title}</div>
                  <p className="mt-0.5 text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="mb-2.5 text-xs font-semibold text-rose-300">
              Mistakes to Cut Out
            </div>
            <div className="space-y-2.5">
              {report.mistakes.length > 0 ? (
                report.mistakes.map((item) => (
                  <div key={item.id} className="text-[11px]">
                    <div className="font-semibold text-white">{item.title}</div>
                    <p className="mt-0.5 text-slate-400">{item.detail}</p>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-slate-400">
                  No major macro mistakes flagged in this match.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="mb-2.5 text-xs font-semibold text-white">
              Where &amp; How to Improve
            </div>
            <div className="space-y-2.5">
              {report.improvements.map((item) => (
                <div key={item.id} className="text-[11px]">
                  <div className="font-semibold text-white">{item.title}</div>
                  <p className="mt-0.5 text-slate-400">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </GlassSurface>

      {/* Optional BYOK AI Coach Debrief */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-300">
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
          <pre className="lg-inset mt-3 whitespace-pre-wrap p-3 font-sans text-xs leading-relaxed text-slate-200">
            {aiDebrief}
          </pre>
        )}
        {aiError && <p className="mt-2 text-xs text-rose-300">{aiError}</p>}
      </GlassSurface>
    </div>
  );
}
