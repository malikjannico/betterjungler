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

  return (
    <div
      data-testid="compact-hud-bar"
      className="hud-panel w-[390px] rounded-xl p-3 text-xs text-slate-100 select-none"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
          <span className="font-semibold tracking-wide text-cyan-300">BETTERJUNGLER</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
            {phase.replace('_', ' ')} {gameTime > 0 ? `• ${formatClock(gameTime)}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/25"
          title={`Expand HUD (${hotkey})`}
        >
          <Maximize2 className="h-3 w-3" />
          {hotkey}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="hud-card rounded-lg p-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <Swords className="h-3 w-3 text-amber-400" />
            Next Objective
          </div>
          {nextObj ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold text-slate-100">{nextObj.name}</span>
                <span
                  className={`tabular-nums font-bold ${
                    nextObj.status === 'live'
                      ? 'text-emerald-400'
                      : nextObj.status === 'prep_vision'
                        ? 'text-amber-400'
                        : 'text-slate-300'
                  }`}
                >
                  {nextObj.status === 'live' ? 'LIVE' : formatClock(nextObj.secondsRemaining)}
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

        <div className="hud-card rounded-lg p-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
            <ShieldAlert className="h-3 w-3 text-cyan-400" />
            Next Buy & Trinket
          </div>
          {buildPlan?.nextItem ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-semibold text-slate-100">
                  {buildPlan.nextItem.item.name}
                </span>
                <span
                  className={`tabular-nums text-[10px] font-semibold ${
                    buildPlan.nextItem.affordableNow ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {buildPlan.nextItem.affordableNow
                    ? 'BUY'
                    : `-${buildPlan.nextItem.goldNeeded}g`}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-cyan-300/90">
                Trinket: {buildPlan.trinketAdvice.item.name}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Full build / Elixir ready</p>
          )}
        </div>
      </div>

      {topCue && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-700/70 bg-slate-900/80 px-2.5 py-1.5">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-100">{topCue.title}</div>
            <div className="line-clamp-1 text-[10px] text-slate-400">{topCue.detail}</div>
          </div>
        </div>
      )}
    </div>
  );
}
