import { formatClock } from '../domain/liveCoachEngine';
import type { AdaptiveBuildPlan, MacroCue, ObjectiveWindow } from '../types/coaching';
import type { GamePhase } from '../types/riot';

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
      className="lg-shell w-[410px] !rounded-[22px] p-3.5 text-xs text-slate-100 select-none"
    >
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isUrgent
                ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                : 'bg-emerald-400'
            }`}
          />
          <span className="text-[11px] font-semibold tracking-[0.12em] text-white">
            BETTERJUNGLER
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {phase.replace('_', ' ')}
            {gameTime > 0 ? ` · ${formatClock(gameTime)}` : ''}
          </span>
        </div>

        <button
          type="button"
          onClick={onExpand}
          className="lg-btn-glass !rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white"
          title={`Expand HUD (${hotkey})`}
        >
          {hotkey}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-2.5">
        <div className="lg-inset p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-slate-400">
            Next Objective
          </div>
          {nextObj ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-semibold text-white">
                  {nextObj.name}
                </span>
                <span
                  className={`tabular-nums text-xs font-bold ${
                    nextObj.status === 'live'
                      ? 'text-emerald-300'
                      : nextObj.status === 'prep_vision'
                        ? 'text-amber-300'
                        : 'text-slate-200'
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
          <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-slate-400">
            Next Buy &amp; Trinket
          </div>
          {buildPlan?.nextItem ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-semibold text-white">
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
              <p className="mt-0.5 truncate text-[10px] text-slate-300">
                {buildPlan.trinketAdvice.item.name}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Full build / Elixir ready</p>
          )}
        </div>
      </div>

      {topCue && (
        <div className="lg-inset mt-2 px-2.5 py-2">
          <div className="truncate font-semibold text-white">{topCue.title}</div>
          <div className="line-clamp-1 text-[10px] text-slate-400">{topCue.detail}</div>
        </div>
      )}
    </div>
  );
}
