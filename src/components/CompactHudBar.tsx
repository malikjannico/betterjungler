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
  clickThrough?: boolean;
  onExpand: () => void;
}

export function CompactHudBar({
  phase,
  gameTime,
  objectives,
  buildPlan,
  topCue,
  hotkey,
  clickThrough = false,
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
      style={{ backgroundColor: 'rgba(12, 15, 21, var(--hud-alpha, 0.92))' }}
      className="flex h-full w-full flex-col justify-between rounded-[20px] border border-white/14 p-3.5 text-xs text-slate-100 shadow-[0_20px_48px_-12px_rgba(0,0,0,0.85)] select-none"
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
              isUrgent
                ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                : 'bg-emerald-400'
            }`}
          />
          <span className="shrink-0 text-[11px] font-semibold tracking-[0.12em] text-white">
            BETTERJUNGLER
          </span>
          <span className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {phase.replace('_', ' ')}
            {gameTime > 0 ? ` · ${formatClock(gameTime)}` : ''}
          </span>
        </div>

        {clickThrough ? (
          <kbd
            aria-label={`Expand hotkey ${hotkey}`}
            className="shrink-0 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200"
          >
            {hotkey}
          </kbd>
        ) : (
          <button
            type="button"
            onClick={onExpand}
            className="lg-btn-glass shrink-0 whitespace-nowrap !rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white"
            title={`Expand HUD (${hotkey})`}
          >
            Expand ({hotkey})
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-2">
        <div className="lg-inset min-w-0 p-2.5">
          <div className="t-micro text-slate-400">Next Objective</div>
          {nextObj ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1.5">
                <span className="truncate font-semibold text-white">
                  {nextObj.name}
                </span>
                <span
                  className={`tabular-nums shrink-0 whitespace-nowrap text-xs font-bold ${
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
              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                {nextObj.actionText}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-400">
              Waiting for match clock
            </div>
          )}
        </div>

        <div className="lg-inset min-w-0 p-2.5">
          <div className="t-micro text-slate-400">Next Item Buy</div>
          {buildPlan?.nextItem ? (
            <div className="mt-1">
              <div className="flex items-baseline justify-between gap-1.5">
                <span className="truncate font-semibold text-white">
                  {buildPlan.nextItem.item.name}
                </span>
                <span
                  className={`tabular-nums shrink-0 whitespace-nowrap text-[10px] font-semibold ${
                    buildPlan.nextItem.affordableNow
                      ? 'text-emerald-300'
                      : 'text-amber-200'
                  }`}
                >
                  {buildPlan.nextItem.affordableNow
                    ? 'BUY'
                    : `-${buildPlan.nextItem.goldNeeded}g`}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                {buildPlan.trinketAdvice.item.name}
              </div>
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-slate-400">
              {buildPlan?.isFullBuild ? 'Full build active' : 'Farming first spike'}
            </div>
          )}
        </div>
      </div>

      {topCue && (
        <div className="mt-2 truncate border-t border-white/[0.06] pt-1.5 text-[11px] text-slate-200">
          <span className="mr-1.5 font-semibold text-white">{topCue.title}:</span>
          <span className="text-slate-400">{topCue.detail}</span>
        </div>
      )}
    </div>
  );
}
