import { Compass, Maximize2, ShieldAlert, Swords } from 'lucide-react';
import type { AdaptiveBuildPlan, MacroCue, ObjectiveWindow } from '../types/coaching';
import type { GamePhase } from '../types/riot';
import { formatClock } from '../domain/liveCoachEngine';

interface CompactHudBarProps {
  phase: GamePhase;
  gameTime: number;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  topCue: MacroCue | null;
  hotkey: string;
  onExpand: () => void;
}

export function CompactHudBar({
  phase,
  gameTime,
  objectives,
  buildPlan,
  topCue,
  hotkey,
  onExpand,
}: CompactHudBarProps) {
  const nextObj = objectives[0];
  const isUrgent =
    nextObj?.status === 'live' || nextObj?.status === 'prep_vision';

  return (
    <div
      data-testid="compact-hud-bar"
      data-phase={phase}
      data-urgent={isUrgent ? 'true' : 'false'}
      className="lg-shell w-[410px] !rounded-[22px] p-3 text-xs text-slate-100 select-none"
    >
      {/* Top Capsule Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isUrgent
                ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24]'
                : 'bg-sky-400 shadow-[0_0_10px_#38bdf8]'
            }`}
          />
          <span className="text-[11px] font-bold tracking-[0.08em] text-slate-100">
            BETTERJUNGLER
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-300">
            {phase.replace('_', ' ')}
            {gameTime > 0 ? ` • ${formatClock(gameTime)}` : ''}
          </span>
        </div>

        <button
          type="button"
          onClick={onExpand}
          className="lg-btn-glass inline-flex items-center gap-1 !rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-sky-200"
          title={`Expand HUD (${hotkey})`}
        >
          <Maximize2 className="h-2.5 w-2.5" />
          {hotkey}
        </button>
      </div>

      {/* Concentric Telemetry Wells */}
      <div className="grid grid-cols-2 gap-2">
        <div className="lg-inset p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">
            <Swords className="h-3 w-3 text-amber-300" />
            Next Objective
          </div>
          {nextObj ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-semibold text-slate-100">
                  {nextObj.name}
                </span>
                <span
                  className={`tabular-nums text-xs font-bold ${
                    nextObj.status === 'live'
                      ? 'text-emerald-300'
                      : nextObj.status === 'prep_vision'
                        ? 'text-amber-300'
                        : 'text-slate-300'
                  }`}
                >
                  {nextObj.status === 'live'
                    ? 'LIVE'
                    : formatClock(nextObj.secondsRemaining)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-400">
                {nextObj.actionText}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Waiting for match clock</p>
          )}
        </div>

        <div className="lg-inset p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">
            <ShieldAlert className="h-3 w-3 text-sky-300" />
            Next Buy &amp; Trinket
          </div>
          {buildPlan?.nextItem ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-semibold text-slate-100">
                  {buildPlan.nextItem.item.name}
                </span>
                <span
                  className={`tabular-nums text-[10px] font-bold ${
                    buildPlan.nextItem.affordableNow
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }`}
                >
                  {buildPlan.nextItem.affordableNow
                    ? 'BUY'
                    : `-${buildPlan.nextItem.goldNeeded}g`}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-sky-300/90">
                {buildPlan.trinketAdvice.item.name}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Full build / Elixir ready</p>
          )}
        </div>
      </div>

      {topCue && (
        <div className="lg-inset mt-2 flex items-start gap-2 px-2.5 py-2">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-100">{topCue.title}</div>
            <div className="line-clamp-1 text-[10px] text-slate-400">{topCue.detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
