import { deriveHudCards, type ObjectiveBadgeKind } from '../domain/hudModel';
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

function ObjectiveBroadcastBadge({ kind }: { kind: ObjectiveBadgeKind }) {
  const tone =
    kind === 'scuttle'
      ? 'border-cyan-400/55 bg-cyan-500/20 text-cyan-300'
      : kind === 'grubs'
        ? 'border-violet-400/55 bg-violet-500/20 text-violet-300'
        : kind === 'herald'
          ? 'border-fuchsia-400/55 bg-fuchsia-500/20 text-fuchsia-300'
          : kind === 'baron'
            ? 'border-purple-400/60 bg-purple-500/25 text-purple-200'
            : kind === 'atakhan'
              ? 'border-rose-400/60 bg-rose-500/25 text-rose-200'
              : kind === 'objective'
                ? 'border-slate-400/55 bg-slate-500/20 text-slate-200'
                : 'border-emerald-400/55 bg-emerald-500/20 text-emerald-300';

  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] border ${tone}`}
    >
      {kind === 'scuttle' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <ellipse cx="8" cy="8.5" rx="4.5" ry="3.2" />
          <path d="M2.5 5.5L5 7.5M13.5 5.5L11 7.5M3 11L5.5 9.5M13 11L10.5 9.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      ) : kind === 'baron' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M8 2L13 6L11 14H5L3 6L8 2Z" />
        </svg>
      ) : kind === 'grubs' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <circle cx="5.5" cy="6" r="2.2" />
          <circle cx="10.5" cy="6" r="2.2" />
          <circle cx="8" cy="11" r="2.2" />
        </svg>
      ) : kind === 'herald' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <polygon points="8,1.5 14,8 8,14.5 2,8" />
        </svg>
      ) : kind === 'atakhan' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M3 3L6.5 7.5L8 4.5L9.5 7.5L13 3L11.5 13H4.5L3 3Z" />
        </svg>
      ) : kind === 'objective' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <rect x="4" y="4" width="8" height="8" rx="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M8 1.5L13.5 6.5L8 14.5L2.5 6.5L8 1.5Z" />
        </svg>
      )}
    </span>
  );
}

/**
 * Broadcast-inspired translucent Compact HUD.
 * Renders sharp rectangular plates with bold objective tiles over a transparent window canvas (`bg-transparent`).
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
      className="flex h-full w-full flex-col-reverse items-end justify-start gap-1.5 bg-transparent p-2 text-xs text-white select-none"
    >
      {/* Broadcast Header Strip: Live Clock & Hotkey */}
      <HudCard
        pill
        urgent={model.isUrgent}
        className="flex h-[28px] items-center gap-2 px-2.5"
      >
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-[1px] ${
            model.statusChip.dotTone === 'urgent'
              ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
              : model.statusChip.dotTone === 'active'
                ? 'bg-emerald-400'
                : 'bg-slate-400'
          }`}
        />
        <span className="tabular-nums whitespace-nowrap text-xs font-bold tracking-wide text-white">
          {model.statusChip.label}
        </span>

        {clickThrough ? (
          <kbd
            aria-label={`Expand hotkey ${hotkey}`}
            className="shrink-0 whitespace-nowrap rounded-[2px] border border-white/20 bg-white/[0.08] px-1.5 py-0.5 font-mono text-xs font-semibold text-white/[0.86]"
          >
            {hotkey}
          </kbd>
        ) : (
          <button
            type="button"
            onClick={onExpand}
            className="shrink-0 whitespace-nowrap rounded-[2px] border border-white/20 bg-white/[0.1] px-2 py-0.5 text-xs font-semibold text-white transition hover:bg-white/[0.18]"
            title={`Expand HUD (${hotkey})`}
          >
            Expand ({hotkey})
          </button>
        )}
      </HudCard>

      {/* Pre-1:30 / Loading Broadcast Route Strip */}
      {model.routeCard && (
        <HudCard className="flex h-[64px] w-[408px] flex-col justify-between border-l-2 border-l-emerald-400 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-bold uppercase tracking-wider text-emerald-300">
              {model.routeCard.title}
            </span>
            <span className="tabular-nums shrink-0 text-xs font-semibold text-white/[0.8]">
              {model.routeCard.timeWindow}
            </span>
          </div>
          <div className="truncate text-xs font-medium text-white/[0.85]">
            {model.routeCard.campsLine}
          </div>
        </HudCard>
      )}

      {/* Broadcast Objective Strip + Economy / Next Buy Tile */}
      {(model.objectiveCard || model.buyCard) && (
        <div
          className={`grid w-[408px] gap-1.5 ${
            model.objectiveCard && model.buyCard ? 'grid-cols-[1.28fr_0.92fr]' : 'grid-cols-1'
          }`}
        >
          {model.objectiveCard && (
            <HudCard
              urgent={model.objectiveCard.isLive || model.objectiveCard.isPrep}
              className="flex h-[66px] min-w-0 flex-col justify-between overflow-hidden px-2.5 pt-2 pb-0"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ObjectiveBroadcastBadge kind={model.objectiveCard.kind} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold uppercase tracking-wide text-white">
                      {model.objectiveCard.shortName}
                    </div>
                    <div className="truncate text-xs font-medium text-white/[0.72]">
                      {model.objectiveCard.actionChip}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    data-testid="hud-objective-timer"
                    className={`tabular-nums whitespace-nowrap text-[22px] leading-none font-extrabold tracking-tight ${
                      model.objectiveCard.isLive
                        ? 'text-emerald-300'
                        : model.objectiveCard.isPrep
                          ? 'text-amber-300'
                          : 'text-white'
                    }`}
                  >
                    {model.objectiveCard.timerText}
                  </span>

                  {model.objectiveCard.secondary && (
                    <div
                      data-testid="hud-secondary-objective"
                      className="flex items-center gap-1.5 border-l border-white/15 pl-2"
                    >
                      <ObjectiveBroadcastBadge kind={model.objectiveCard.secondary.kind} />
                      <div className="text-right">
                        <div className="text-xs font-bold leading-none text-white/[0.75]">
                          {model.objectiveCard.secondary.shortName}
                        </div>
                        <div
                          className={`tabular-nums mt-0.5 text-xs font-bold leading-none ${
                            model.objectiveCard.secondary.isLive ? 'text-emerald-300' : 'text-white'
                          }`}
                        >
                          {model.objectiveCard.secondary.timerText}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="-mx-2.5 h-[3px] bg-white/10">
                <div
                  className={`h-full ${
                    model.objectiveCard.isLive
                      ? 'bg-emerald-400'
                      : model.objectiveCard.isPrep
                        ? 'bg-amber-400'
                        : 'bg-sky-400/80'
                  }`}
                  style={{ width: `${model.objectiveCard.urgencyPct}%` }}
                />
              </div>
            </HudCard>
          )}

          {model.buyCard && (
            <HudCard className="flex h-[66px] min-w-0 items-center justify-between gap-2 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <img
                  src={getItemIconUrl(model.buyCard.itemId, patchVersion)}
                  alt={model.buyCard.itemName}
                  className="h-8 w-8 shrink-0 rounded-[2px] border border-amber-300/35 bg-black"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white">
                    {model.buyCard.itemName}
                  </div>
                  <div className="truncate text-xs text-white/[0.7]">
                    {model.buyCard.trinketName}
                  </div>
                </div>
              </div>
              <span
                className={`tabular-nums shrink-0 whitespace-nowrap rounded-[2px] border px-1.5 py-0.5 text-xs font-extrabold ${
                  model.buyCard.affordableNow
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                    : 'border-amber-400/35 bg-amber-500/10 text-amber-200'
                }`}
              >
                {model.buyCard.goldStatusText}
              </span>
            </HudCard>
          )}
        </div>
      )}

      {/* Left-Accented Broadcast Callout Strip */}
      {model.cueCard && (
        <HudCard
          urgent={model.cueCard.urgent}
          className={`max-h-[52px] w-[408px] border-l-[3px] px-3 py-1.5 text-xs leading-snug text-white/[0.88] ${
            model.cueCard.urgent ? 'border-l-amber-400' : 'border-l-sky-400'
          }`}
        >
          <div data-testid="hud-macro-cue" className="line-clamp-2">
            <span className="mr-1.5 font-bold uppercase tracking-wide text-white">
              {model.cueCard.title}:
            </span>
            <span>{model.cueCard.detail}</span>
          </div>
        </HudCard>
      )}
    </div>
  );
}
