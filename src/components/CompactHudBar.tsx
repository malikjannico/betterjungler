import { deriveHudCards } from '../domain/hudModel';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  HudScalePercent,
  JungleRoute,
  MacroCue,
  ObjectiveWindow,
} from '../types/coaching';
import type { GamePhase } from '../types/riot';
import { HudCard } from './hud/HudCard';

interface CompactHudBarProps {
  phase: GamePhase;
  gameTime: number;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  topCue: MacroCue | null;
  openingRoute?: JungleRoute | null;
  patchVersion?: string;
  hotkey: string;
  scalePercent?: HudScalePercent;
  clickThrough?: boolean;
  onExpand: () => void;
}

/**
 * Modular multi-card transparent floating HUD anchored at the bottom-right corner
 * over a completely transparent background canvas (`bg-transparent`).
 */
export function CompactHudBar({
  phase,
  gameTime,
  objectives,
  buildPlan,
  topCue,
  openingRoute = null,
  patchVersion = '16.23.1',
  hotkey,
  scalePercent = 100,
  clickThrough = false,
  onExpand,
}: CompactHudBarProps) {
  const model = deriveHudCards({
    phase,
    gameTime,
    objectives,
    buildPlan,
    topCue,
    openingRoute,
    hotkey,
  });

  const zoomFactor = scalePercent / 100;

  return (
    <div
      data-testid="compact-hud-bar"
      data-phase={phase}
      data-urgent={model.isUrgent ? 'true' : 'false'}
      data-scale={scalePercent}
      style={{
        zoom: zoomFactor !== 1 ? zoomFactor : undefined,
      }}
      className="flex h-full w-full flex-col-reverse items-end justify-start gap-2 bg-transparent p-2 text-xs text-white select-none"
    >
      {/* Card 1: Status & Hotkey Chip */}
      <HudCard
        pill
        urgent={model.isUrgent}
        className="flex h-[30px] items-center gap-2.5 px-3"
      >
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            model.statusChip.dotTone === 'urgent'
              ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
              : model.statusChip.dotTone === 'active'
                ? 'bg-emerald-400'
                : 'bg-white/40'
          }`}
        />
        <span className="tabular-nums whitespace-nowrap text-xs font-medium text-white/[0.92]">
          {model.statusChip.label}
        </span>

        {clickThrough ? (
          <kbd
            aria-label={`Expand hotkey ${hotkey}`}
            className="shrink-0 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-xs font-semibold text-white/[0.78]"
          >
            {hotkey}
          </kbd>
        ) : (
          <button
            type="button"
            onClick={onExpand}
            className="shrink-0 whitespace-nowrap rounded-full border border-white/18 bg-white/[0.08] px-2.5 py-0.5 text-xs font-semibold text-white transition hover:bg-white/[0.14]"
            title={`Expand HUD (${hotkey})`}
          >
            Expand ({hotkey})
          </button>
        )}
      </HudCard>

      {/* Card 2 (Pre-1:30 / Loading): Opening Route Micro-Card */}
      {model.routeCard && (
        <HudCard className="flex h-[64px] w-[408px] flex-col justify-between px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-white/[0.92]">
              {model.routeCard.title}
            </span>
            <span className="tabular-nums shrink-0 text-xs text-white/[0.72]">
              {model.routeCard.timeWindow}
            </span>
          </div>
          <div className="truncate text-xs text-white/[0.72]">
            {model.routeCard.campsLine}
          </div>
        </HudCard>
      )}

      {/* Card 2a & 2b (In-Game): Objective Countdown + Next Buy Floating Row */}
      {(model.objectiveCard || model.buyCard) && (
        <div
          className={`grid w-[408px] gap-2 ${
            model.objectiveCard && model.buyCard ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {model.objectiveCard && (
            <HudCard
              urgent={model.objectiveCard.isLive || model.objectiveCard.isPrep}
              className="flex h-[64px] min-w-0 flex-col justify-between px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold text-white/[0.92]">
                  {model.objectiveCard.name}
                </span>
                <span
                  data-testid="hud-objective-timer"
                  className={`tabular-nums shrink-0 whitespace-nowrap text-[22px] leading-none font-bold ${
                    model.objectiveCard.isLive
                      ? 'text-emerald-300'
                      : model.objectiveCard.isPrep
                        ? 'text-amber-300'
                        : 'text-white'
                  }`}
                >
                  {model.objectiveCard.timerText}
                </span>
              </div>

              <div className="space-y-1">
                <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full ${
                      model.objectiveCard.isLive
                        ? 'bg-emerald-400'
                        : model.objectiveCard.isPrep
                          ? 'bg-amber-400'
                          : 'bg-white/65'
                    }`}
                    style={{ width: `${model.objectiveCard.urgencyPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-1.5 text-xs text-white/[0.72]">
                  <span className="truncate font-medium">{model.objectiveCard.actionChip}</span>
                  {model.objectiveCard.secondary && (
                    <span className="tabular-nums shrink-0 text-white/[0.72]">
                      {model.objectiveCard.secondary.timerText}
                    </span>
                  )}
                </div>
              </div>
            </HudCard>
          )}

          {model.buyCard && (
            <HudCard className="flex h-[64px] min-w-0 items-center justify-between gap-2 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={getItemIconUrl(model.buyCard.itemId, patchVersion)}
                  alt={model.buyCard.itemName}
                  className="h-7 w-7 shrink-0 rounded-[7px] border border-white/15 bg-black"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white/[0.92]">
                    {model.buyCard.itemName}
                  </div>
                  <div className="truncate text-xs text-white/[0.72]">
                    {model.buyCard.trinketName}
                  </div>
                </div>
              </div>
              <span
                className={`tabular-nums shrink-0 whitespace-nowrap text-xs font-bold ${
                  model.buyCard.affordableNow ? 'text-emerald-300' : 'text-amber-200'
                }`}
              >
                {model.buyCard.goldStatusText}
              </span>
            </HudCard>
          )}
        </div>
      )}

      {/* Card 3: Conditional High-Priority Macro Cue Micro-Card */}
      {model.cueCard && (
        <HudCard
          urgent={model.cueCard.urgent}
          className="max-h-[52px] w-[408px] px-3 py-2 text-xs leading-snug text-white/[0.78]"
        >
          <div data-testid="hud-macro-cue" className="line-clamp-2">
            <span className="mr-1.5 font-semibold text-white">{model.cueCard.title}:</span>
            <span>{model.cueCard.detail}</span>
          </div>
        </HudCard>
      )}
    </div>
  );
}
