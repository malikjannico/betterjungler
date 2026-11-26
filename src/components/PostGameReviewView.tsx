import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import { synthesizeDemoPostGameDebrief } from '../domain/aiCoachFallback';
import { formatClock } from '../domain/liveCoachEngine';
import { analyzePostGameMatch } from '../domain/postGameReviewEngine';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { GoldXpDiffChart } from './GoldXpDiffChart';
import { PostGameTimelineMap } from './PostGameTimelineMap';

interface PostGameReviewViewProps {
  matches: MatchV5Detail[];
  targetDivision: string;
  aiConfig: AiCoachConfig;
  canSyncLive: boolean;
  onSyncMatches: () => Promise<void>;
}

export function PostGameReviewView({
  matches,
  targetDivision,
  aiConfig,
  canSyncLive,
  onSyncMatches,
}: PostGameReviewViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string>(
    matches[0]?.matchId ?? ''
  );
  const [syncing, setSyncing] = useState(false);
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
    try {
      await onSyncMatches();
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
      <div className="hud-card rounded-xl p-6 text-center text-xs text-slate-300">
        No ranked jungle matches loaded yet. Sync your recent games or select Demo Mode.
      </div>
    );
  }

  const gradeColor =
    report.grade === 'S'
      ? 'text-amber-300 border-amber-400/50 bg-amber-500/15'
      : report.grade === 'A'
        ? 'text-emerald-300 border-emerald-400/50 bg-emerald-500/15'
        : report.grade === 'B'
          ? 'text-cyan-300 border-cyan-400/50 bg-cyan-500/15'
          : 'text-rose-300 border-rose-400/50 bg-rose-500/15';

  return (
    <div className="space-y-3">
      {/* Match Selector & Sync */}
      <div className="hud-card flex flex-wrap items-center justify-between gap-2 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          {matches.map((m) => {
            const active = m.matchId === selectedMatch.matchId;
            return (
              <button
                key={m.matchId}
                type="button"
                onClick={() => {
                  setSelectedMatchId(m.matchId);
                  setAiDebrief(null);
                  setAiError(null);
                }}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-500/15 text-slate-100'
                    : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1 text-[10px] font-bold ${
                      m.win
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {m.win ? 'W' : 'L'}
                  </span>
                  <span className="font-semibold">{m.championName}</span>
                  <span className="tabular-nums text-[10px] text-slate-400">
                    {m.kills}/{m.deaths}/{m.assists}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleSync()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {canSyncLive ? 'Sync Match-V5 Games' : 'Refresh Demo Games'}
        </button>
      </div>

      {/* Match Header + Grade + KPIs */}
      <div className="hud-card rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100">
                {report.championName} vs {report.enemyJunglerName}
              </h2>
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                  report.win
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {report.win ? 'VICTORY' : 'DEFEAT'} • {formatClock(report.durationSeconds)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Benchmarked against {targetDivision} • Match ID: {report.matchId}
            </p>
          </div>

          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl border text-lg font-extrabold ${gradeColor}`}
            title="Overall Jungle Performance Grade"
          >
            {report.grade}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
            <div key={kpi.label} className="rounded-lg bg-slate-900/80 px-2.5 py-2">
              <div className="text-[10px] uppercase text-slate-400">{kpi.label}</div>
              <div className="tabular-nums mt-0.5 text-sm font-bold text-slate-100">
                {kpi.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gold & XP Diff Curve */}
      <GoldXpDiffChart key={`chart-${selectedMatch.matchId}`} match={selectedMatch} />

      {/* Interactive SVG Timeline Replay Map */}
      <PostGameTimelineMap
        key={selectedMatch.matchId}
        durationSeconds={selectedMatch.durationSeconds}
        pathPoints={report.pathPoints}
        markers={report.markers}
      />

      {/* What You Did Good / Mistakes / Where to Improve */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="hud-card rounded-xl border-emerald-500/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            What You Did Good
          </div>
          <div className="space-y-2">
            {report.highlights.map((item) => (
              <div key={item.id} className="rounded-lg bg-slate-900/70 p-2 text-[11px]">
                <div className="font-semibold text-emerald-200">{item.title}</div>
                <p className="mt-0.5 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="hud-card rounded-xl border-rose-500/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-rose-300">
            <AlertCircle className="h-4 w-4" />
            Mistakes to Cut Out
          </div>
          <div className="space-y-2">
            {report.mistakes.length > 0 ? (
              report.mistakes.map((item) => (
                <div key={item.id} className="rounded-lg bg-slate-900/70 p-2 text-[11px]">
                  <div className="font-semibold text-rose-200">{item.title}</div>
                  <p className="mt-0.5 text-slate-300">{item.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-slate-400">
                No major macro mistakes flagged in this match.
              </p>
            )}
          </div>
        </div>

        <div className="hud-card rounded-xl border-cyan-500/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-cyan-300">
            <Lightbulb className="h-4 w-4" />
            Where &amp; How to Improve
          </div>
          <div className="space-y-2">
            {report.improvements.map((item) => (
              <div key={item.id} className="rounded-lg bg-slate-900/70 p-2 text-[11px]">
                <div className="font-semibold text-cyan-200">{item.title}</div>
                <p className="mt-0.5 text-slate-300">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Optional BYOK AI Coach Debrief */}
      <div className="hud-card rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
            <Bot className="h-4 w-4" />
            <span>
              Optional AI Coach Debrief (
              {aiConfig.provider === 'off'
                ? 'Deterministic Preview / Configure BYOK in Settings'
                : `${aiConfig.provider.toUpperCase()} • ${aiConfig.model}`}
              )
            </span>
          </div>
          <button
            type="button"
            disabled={aiLoading}
            onClick={() => void handleGenerateAiDebrief()}
            className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
          >
            {aiLoading ? 'Generating...' : 'Generate AI Coach Debrief'}
          </button>
        </div>

        {aiDebrief && (
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900/80 p-2.5 font-sans text-xs leading-relaxed text-slate-200">
            {aiDebrief}
          </pre>
        )}
        {aiError && <p className="mt-2 text-xs text-rose-300">{aiError}</p>}
      </div>
    </div>
  );
}
