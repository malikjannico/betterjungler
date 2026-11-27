import { Target } from 'lucide-react';
import { useState } from 'react';
import { formatClock } from '../domain/liveCoachEngine';
import type { ClimbGoal, PersonalLearningSnapshot } from '../types/coaching';
import { GlassSurface } from './GlassSurface';

interface PersonalLearningPanelProps {
  snapshot?: PersonalLearningSnapshot | null;
  currentFocusGoalId?: string | null;
  onAdoptFocusGoal?: (goal: ClimbGoal) => Promise<void>;
}

const CONFIDENCE_STYLES: Record<
  PersonalLearningSnapshot['signatures'][number]['status'],
  { label: string; className: string }
> = {
  confirmed: {
    label: 'Confirmed Leak',
    className: 'border-rose-400/40 bg-rose-500/15 text-rose-200',
  },
  emerging: {
    label: 'Emerging Pattern',
    className: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  },
  monitoring: {
    label: 'Monitoring',
    className: 'border-white/15 bg-white/[0.05] text-white/[0.68]',
  },
};

/**
 * Displays deterministic jungle mistake detectors with statistical surfacing gates
 * (`Confirmed` / `Emerging` / `Monitoring`), auto-proposed Match Focus goal, and
 * multi-session stamina & tilt analytics.
 */
export function PersonalLearningPanel({
  snapshot,
  currentFocusGoalId = null,
  onAdoptFocusGoal,
}: PersonalLearningPanelProps) {
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);

  if (!snapshot) {
    return (
      <GlassSurface className="p-4">
        <p className="t-caption text-white/[0.58]">
          Sync jungle matches to unlock personal EWM baselines, statistical mistake detectors, and
          multi-session stamina analytics.
        </p>
      </GlassSurface>
    );
  }

  const {
    proposedFocus,
    tiltAnalytics,
    jungleMatchCount,
  } = snapshot;
  const signatures = snapshot.signatures ?? [];
  const alreadyFocused =
    Boolean(proposedFocus) && currentFocusGoalId === proposedFocus?.goal.id;

  async function handleAdopt(goal: ClimbGoal) {
    if (!onAdoptFocusGoal || adopting) return;
    setAdopting(true);
    setAdoptError(null);
    try {
      await onAdoptFocusGoal(goal);
    } catch (err) {
      setAdoptError(err instanceof Error ? err.message : 'Failed to adopt focus goal.');
    } finally {
      setAdopting(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
      <GlassSurface className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="t-title text-white/[0.92]">
            Personal Mistake Signatures &amp; Surfacing Gate
          </h3>
          <span className="t-caption text-white/[0.5]">
            {jungleMatchCount} jungle {jungleMatchCount === 1 ? 'game' : 'games'} · 95% Wilson gate
          </span>
        </div>

        {proposedFocus && (
          <div className="space-y-2 rounded-[8px] border border-sky-400/30 bg-sky-500/10 px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-sky-200">
                  <Target className="h-3.5 w-3.5 shrink-0" />
                  <span>Recommended Match Focus: {proposedFocus.goal.title}</span>
                </div>
                <p className="t-caption text-white/[0.72]">{proposedFocus.reason}</p>
              </div>
              {onAdoptFocusGoal && (
                <button
                  type="button"
                  disabled={alreadyFocused || adopting}
                  onClick={() => void handleAdopt(proposedFocus.goal)}
                  className="lg-btn-primary shrink-0 px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                >
                  {alreadyFocused
                    ? 'Active Focus'
                    : adopting
                      ? 'Saving...'
                      : 'Adopt as Match Focus'}
                </button>
              )}
            </div>
            {adoptError && (
              <p className="t-caption text-rose-200">{adoptError}</p>
            )}
          </div>
        )}

        {signatures.length === 0 ? (
          <p className="t-caption text-white/[0.58]">
            No recurring jungle mistake signatures detected across your synced jungle games.
          </p>
        ) : (
          <div className="space-y-2">
            {signatures.map((sig) => {
              const badge = CONFIDENCE_STYLES[sig.status];
              return (
                <div key={sig.detectorId} className="lg-inset space-y-1.5 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white/[0.92]">{sig.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-[11px] text-white/[0.62]">
                        {sig.hitMatches}/{sig.totalMatches} ({sig.hitRatePct}% · CI floor{' '}
                        {sig.wilsonLowerBoundPct}%)
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <p className="t-caption text-white/[0.64]">{sig.drill}</p>
                  {sig.recentTimestamps.length > 0 && (
                    <div className="tabular-nums text-[11px] text-white/[0.45]">
                      Recent triggers: {sig.recentTimestamps.map(formatClock).join(', ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassSurface>

      <GlassSurface className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="t-title text-white/[0.92]">Multi-Session Stamina &amp; Tilt</h3>
          <span className="t-caption text-white/[0.5]">
            {tiltAnalytics.sessionCount} {tiltAnalytics.sessionCount === 1 ? 'session' : 'sessions'} ·{' '}
            {tiltAnalytics.avgGamesPerSession}g avg
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="lg-inset p-3">
            <div className="t-caption text-white/[0.55]">Fresh Block (Games 1–2)</div>
            <div className="tabular-nums mt-1 text-base font-bold text-white">
              {tiltAnalytics.freshGames > 0 ? `${tiltAnalytics.freshWrPct}% WR` : 'n/a'}
            </div>
            <div className="t-caption mt-0.5 text-white/[0.45]">
              {tiltAnalytics.freshGames} {tiltAnalytics.freshGames === 1 ? 'game' : 'games'}
            </div>
          </div>

          <div className="lg-inset p-3">
            <div className="t-caption text-white/[0.55]">Extended (Game 3+)</div>
            <div className="tabular-nums mt-1 text-base font-bold text-white">
              {tiltAnalytics.extendedWrPct !== null ? `${tiltAnalytics.extendedWrPct}% WR` : 'n/a'}
            </div>
            <div className="t-caption mt-0.5 text-white/[0.45]">
              {tiltAnalytics.extendedGames} {tiltAnalytics.extendedGames === 1 ? 'game' : 'games'}
            </div>
          </div>

          <div className="lg-inset p-3">
            <div className="t-caption text-white/[0.55]">After Loss Requeue</div>
            <div
              className={`tabular-nums mt-1 text-base font-bold ${
                tiltAnalytics.postLossWrPct !== null && tiltAnalytics.postLossWrPct <= 35
                  ? 'text-rose-300'
                  : 'text-white'
              }`}
            >
              {tiltAnalytics.postLossWrPct !== null ? `${tiltAnalytics.postLossWrPct}% WR` : 'n/a'}
            </div>
            <div className="t-caption mt-0.5 text-white/[0.45]">
              {tiltAnalytics.postLossGames} immediate {tiltAnalytics.postLossGames === 1 ? 'requeue' : 'requeues'}
            </div>
          </div>

          <div className="lg-inset p-3">
            <div className="t-caption text-white/[0.55]">After Win Momentum</div>
            <div className="tabular-nums mt-1 text-base font-bold text-emerald-300">
              {tiltAnalytics.postWinWrPct !== null ? `${tiltAnalytics.postWinWrPct}% WR` : 'n/a'}
            </div>
            <div className="t-caption mt-0.5 text-white/[0.45]">
              {tiltAnalytics.postWinGames} immediate {tiltAnalytics.postWinGames === 1 ? 'requeue' : 'requeues'}
            </div>
          </div>
        </div>

        <p className="lg-inset t-caption px-3 py-2 text-white/[0.75]">
          {tiltAnalytics.advisory}
        </p>
      </GlassSurface>
    </div>
  );
}
