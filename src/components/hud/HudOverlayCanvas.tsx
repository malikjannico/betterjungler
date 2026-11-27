import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, Lock, RotateCcw } from 'lucide-react';
import { deriveHudCards, type ObjectiveBadgeKind } from '../../domain/hudModel';
import type { SkillOrderAdvice } from '../../domain/skillOrderEngine';
import type { AdcWinConditionPlan } from '../../domain/adc/types';
import { getItemIconUrl } from '../../services/ddragonService';
import { DEFAULT_HUD_WIDGETS } from '../../services/tauriBridge';
import type {
  AdaptiveBuildPlan,
  HudScalePercent,
  HudWidgetId,
  HudWidgetMap,
  JungleRoute,
  MacroCue,
  ObjectiveWindow,
  SmiteTierStatus,
  WinConditionPlan,
} from '../../types/coaching';
import type { GamePhase } from '../../types/riot';
import { HudCard } from './HudCard';

export const HUD_WIDGET_META: ReadonlyArray<{ id: HudWidgetId; label: string; previewHint: string }> = [
  { id: 'objectives', label: 'Objectives', previewHint: 'DRG 1:42 · GRB 2:10' },
  { id: 'build', label: 'Next Item', previewHint: 'Kraken Slayer · −350g' },
  { id: 'cs', label: 'CS / min', previewHint: '7.4 / 7.2 CS/min (+0.2)' },
  { id: 'skillOrder', label: 'Skill Order', previewHint: 'LEVEL Q NOW · R > Q > E > W' },
  { id: 'gamePlan', label: 'Lv2 & Spikes', previewHint: 'Lv2 Plan · 1-Item Spike' },
  { id: 'cue', label: 'Macro Cue', previewHint: 'Setup Dragon Vision (45s)' },
];

interface HudOverlayCanvasProps {
  phase: GamePhase;
  gameTime: number;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  topCue: MacroCue | null;
  openingRoute?: JungleRoute | null;
  patchVersion?: string;
  hotkey: string;
  scalePercent?: HudScalePercent;
  opacity?: number;
  clickThrough?: boolean;
  hudLocked?: boolean;
  hudWidgets?: HudWidgetMap;
  activeRole?: 'jungle' | 'bottom' | 'off_role';
  isOffRole?: boolean;
  creepScore?: number;
  targetCsPerMin?: number;
  targetDivisionLabel?: string;
  skillOrder?: SkillOrderAdvice | null;
  winPlan?: WinConditionPlan | null;
  adcWinPlan?: AdcWinConditionPlan | null;
  smiteStatus?: SmiteTierStatus | null;
  onSaveWidgets?: (widgets: HudWidgetMap) => void;
  onResetWidgets?: () => void;
  onLockHud?: () => void;
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
          <path
            d="M2.5 5.5L5 7.5M13.5 5.5L11 7.5M3 11L5.5 9.5M13 11L10.5 9.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      ) : kind === 'baron' ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M8 2L13 6L11 14H5L3 6L8 2Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M8 2L13.5 8L8 14L2.5 8L8 2Z" />
        </svg>
      )}
    </span>
  );
}

/**
 * Isolated multi-widget transparent overlay stage (`hud.html` only).
 * When locked, every surface is strictly `pointer-events-none` click-through.
 * When unlocked, users can left-click-hold & drag each widget independently across the screen.
 */
export function HudOverlayCanvas({
  phase,
  gameTime,
  objectives,
  buildPlan,
  topCue,
  openingRoute = null,
  patchVersion = '16.23.1',
  hotkey,
  scalePercent = 100,
  opacity = 85,
  clickThrough = true,
  hudLocked = true,
  hudWidgets = DEFAULT_HUD_WIDGETS,
  activeRole,
  isOffRole,
  creepScore,
  targetCsPerMin,
  targetDivisionLabel,
  skillOrder,
  winPlan,
  adcWinPlan,
  smiteStatus,
  onSaveWidgets,
  onResetWidgets,
  onLockHud,
  onExpand,
}: HudOverlayCanvasProps) {
  const effectiveLocked = hudLocked && clickThrough;
  const isEditMode = !effectiveLocked;
  const scaleFactor = scalePercent === 150 ? 1.35 : scalePercent === 125 ? 1.18 : 1;

  const model = deriveHudCards({
    phase,
    gameTime,
    objectives,
    buildPlan,
    topCue,
    openingRoute,
    hotkey,
    activeRole,
    isOffRole,
    creepScore,
    targetCsPerMin,
    targetDivisionLabel,
    skillOrder,
    winPlan,
    adcWinPlan,
    smiteStatus,
  });

  const [dragState, setDragState] = useState<{
    id: HudWidgetId;
    startClientX: number;
    startClientY: number;
    origXPct: number;
    origYPct: number;
    curXPct: number;
    curYPct: number;
  } | null>(null);
  const widgetsRef = useRef(hudWidgets);
  widgetsRef.current = hudWidgets;

  function beginWidgetDrag(id: HudWidgetId, e: ReactPointerEvent<HTMLDivElement>) {
    if (!isEditMode || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const cur = widgetsRef.current[id];
    setDragState({
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXPct: cur.xPct,
      origYPct: cur.yPct,
      curXPct: cur.xPct,
      curYPct: cur.yPct,
    });
  }

  function moveWidgetDrag(id: HudWidgetId, e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.id !== id) return;
    const vw = Math.max(640, window.innerWidth || 1920);
    const vh = Math.max(360, window.innerHeight || 1080);
    const dxPct = ((e.clientX - dragState.startClientX) / vw) * 100;
    const dyPct = ((e.clientY - dragState.startClientY) / vh) * 100;
    const curXPct = Math.max(0, Math.min(92, Math.round((dragState.origXPct + dxPct) * 100) / 100));
    const curYPct = Math.max(0, Math.min(92, Math.round((dragState.origYPct + dyPct) * 100) / 100));
    setDragState((prev) => (prev ? { ...prev, curXPct, curYPct } : null));
  }

  function endWidgetDrag(id: HudWidgetId, e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.id !== id) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const next: HudWidgetMap = {
      ...widgetsRef.current,
      [id]: {
        ...widgetsRef.current[id],
        xPct: dragState.curXPct,
        yPct: dragState.curYPct,
      },
    };
    setDragState(null);
    onSaveWidgets?.(next);
  }

  function toggleWidgetEnabled(id: HudWidgetId) {
    const next: HudWidgetMap = {
      ...hudWidgets,
      [id]: {
        ...hudWidgets[id],
        enabled: !hudWidgets[id].enabled,
      },
    };
    onSaveWidgets?.(next);
  }

  function widgetPos(id: HudWidgetId): { left: string; top: string } {
    if (dragState?.id === id) {
      return { left: `${dragState.curXPct}%`, top: `${dragState.curYPct}%` };
    }
    return { left: `${hudWidgets[id].xPct}%`, top: `${hudWidgets[id].yPct}%` };
  }

  const wrapInteractive = isEditMode
    ? 'pointer-events-auto cursor-grab active:cursor-grabbing ring-1 ring-amber-400/75 shadow-[0_0_24px_rgba(251,191,36,0.22)]'
    : 'pointer-events-none';

  const cardOpacityStyle = { opacity: Math.max(0.7, Math.min(1, opacity / 100)) };

  const objCard = model.objectiveCard;
  const routeCard = model.routeCard;
  const buyCard = model.buyCard;
  const csCard = model.csCard;
  const skillCard = model.skillOrderCard;
  const gamePlanCard = model.gamePlanCard;
  const cueCard = model.cueCard;

  const isOffRoleMode = model.statusChip.activeRole === 'off_role';
  const showObjectives =
    hudWidgets.objectives.enabled && (Boolean(objCard || routeCard) || isEditMode);
  const showBuild =
    hudWidgets.build.enabled && !isOffRoleMode && (Boolean(buyCard) || isEditMode);
  const showCs =
    hudWidgets.cs.enabled && !isOffRoleMode && (Boolean(csCard) || isEditMode);
  const showSkill =
    hudWidgets.skillOrder.enabled && !isOffRoleMode && (Boolean(skillCard) || isEditMode);
  const showGamePlan =
    hudWidgets.gamePlan.enabled && !isOffRoleMode && (Boolean(gamePlanCard) || isEditMode);
  const showCue =
    hudWidgets.cue.enabled && !isOffRoleMode && (Boolean(cueCard) || isEditMode);

  const anyWidgetVisible =
    showObjectives || showBuild || showCs || showSkill || showGamePlan || showCue || isEditMode;

  return (
    <div
      data-testid="compact-hud-bar"
      data-scale={scalePercent}
      data-locked={effectiveLocked ? 'true' : 'false'}
      style={cardOpacityStyle}
      className="fixed inset-0 pointer-events-none select-none overflow-hidden"
    >
      {/* Floating Layout Editor Toolbar (only visible when HUD is unlocked for dragging) */}
      {isEditMode && (
        <div className="pointer-events-auto fixed top-3 left-1/2 z-50 flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-amber-400/45 bg-[#0c1018]/95 px-3 py-2 text-xs text-white shadow-2xl">
          <span className="font-semibold text-amber-300">
            HUD Layout Edit — Drag widgets with left mouse button
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {HUD_WIDGET_META.map((meta) => {
              const active = hudWidgets[meta.id].enabled;
              return (
                <button
                  key={meta.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleWidgetEnabled(meta.id)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition ${
                    active
                      ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/15 bg-white/[0.05] text-slate-400'
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          {onResetWidgets && (
            <button
              type="button"
              onClick={onResetWidgets}
              className="flex items-center gap-1 rounded-md border border-white/15 bg-white/[0.08] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.15]"
            >
              <RotateCcw className="h-3 w-3" /> Reset Layout
            </button>
          )}
          {onLockHud && (
            <button
              type="button"
              onClick={onLockHud}
              className="flex items-center gap-1 rounded-md bg-emerald-400 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-300"
            >
              <Lock className="h-3 w-3" /> Lock &amp; Save
            </button>
          )}
        </div>
      )}

      {/* Fallback armed status chip when idle in preview */}
      {!anyWidgetVisible && (
        <div className="fixed bottom-3 right-3">
          <HudCard pill className="flex items-center gap-2 px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            <span className="t-micro text-white/[0.86]">{model.statusChip.label}</span>
            <kbd aria-label={`Expand hotkey ${hotkey}`} className="hud-kbd t-micro">
              {hotkey}
            </kbd>
            {clickThrough && (
              <button
                type="button"
                onClick={onExpand}
                className="pointer-events-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20"
              >
                Expand
              </button>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 1: Objective Timers (Also displays Off-Role Global pill when off-role) */}
      {showObjectives && (
        <div
          data-testid="hud-widget-objectives"
          onPointerDown={(e) => beginWidgetDrag('objectives', e)}
          onPointerMove={(e) => moveWidgetDrag('objectives', e)}
          onPointerUp={(e) => endWidgetDrag('objectives', e)}
          style={{
            ...widgetPos('objectives'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 min-w-[235px] max-w-[300px] ${wrapInteractive}`}
        >
          <HudCard urgent={model.isUrgent} className="px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <span>{isOffRoleMode ? 'OFF-ROLE · GLOBALS' : routeCard ? 'OPENING CLEAR' : 'OBJECTIVES'}</span>
              {isEditMode && <GripVertical className="h-3.5 w-3.5 text-amber-300" />}
              {!isEditMode && (
                <kbd aria-label={`Expand hotkey ${hotkey}`} className="hud-kbd t-micro">
                  {hotkey}
                </kbd>
              )}
            </div>
            {routeCard ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-300">{routeCard.title}</span>
                  <span className="tabular-nums font-mono text-[10px] text-slate-300">
                    {routeCard.timeWindow}
                  </span>
                </div>
                <div className="text-[11px] font-medium text-white/[0.9]">{routeCard.campsLine}</div>
              </div>
            ) : objCard ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <ObjectiveBroadcastBadge kind={objCard.kind} />
                    <div>
                      <div className="font-bold tracking-wide text-white">{objCard.shortName}</div>
                      <div className="text-[10px] font-semibold text-amber-200/90">
                        {objCard.actionChip}
                      </div>
                    </div>
                  </div>
                  <div
                    data-testid="hud-objective-timer"
                    className={`tabular-nums font-mono text-lg font-extrabold leading-none ${
                      objCard.isLive
                        ? 'text-emerald-300'
                        : objCard.isPrep
                          ? 'text-amber-300'
                          : 'text-white'
                    }`}
                  >
                    {objCard.timerText}
                  </div>
                </div>
                {objCard.secondary && (
                  <div className="flex items-center justify-between border-t border-white/[0.08] pt-1 text-[11px] text-slate-300">
                    <span>Next · {objCard.secondary.name}</span>
                    <span className="tabular-nums font-mono font-bold text-white">
                      {objCard.secondary.timerText}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">DRG 1:42 · GRB 2:10</span>
                <span className="font-mono text-[11px] text-emerald-300">TRACKING</span>
              </div>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 2: Next Item & Gold Needed */}
      {showBuild && (
        <div
          data-testid="hud-widget-build"
          onPointerDown={(e) => beginWidgetDrag('build', e)}
          onPointerMove={(e) => moveWidgetDrag('build', e)}
          onPointerUp={(e) => endWidgetDrag('build', e)}
          style={{
            ...widgetPos('build'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 min-w-[215px] max-w-[270px] ${wrapInteractive}`}
        >
          <HudCard className="px-3 py-2">
            {isEditMode && (
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-amber-300">
                <span>Next Buy</span>
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            )}
            {buyCard ? (
              <div className="flex items-center gap-2.5">
                <img
                  src={getItemIconUrl(buyCard.itemId, patchVersion)}
                  alt={buyCard.itemName}
                  className="h-8 w-8 shrink-0 rounded-[4px] border border-white/15 bg-black/50"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{buyCard.itemName}</div>
                  <div className="truncate text-[10px] text-slate-400">{buyCard.trinketName}</div>
                </div>
                <span
                  className={`tabular-nums font-mono shrink-0 rounded px-2 py-0.5 text-[11px] font-extrabold ${
                    buyCard.affordableNow
                      ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/50'
                      : 'bg-white/[0.08] text-amber-200'
                  }`}
                >
                  {buyCard.goldStatusText}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-white">Kraken Slayer</span>
                <span className="font-mono text-[11px] font-bold text-amber-200">−350g</span>
              </div>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 3: CS/min vs Target */}
      {showCs && (
        <div
          data-testid="hud-widget-cs"
          onPointerDown={(e) => beginWidgetDrag('cs', e)}
          onPointerMove={(e) => moveWidgetDrag('cs', e)}
          onPointerUp={(e) => endWidgetDrag('cs', e)}
          style={{
            ...widgetPos('cs'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 min-w-[175px] ${wrapInteractive}`}
        >
          <HudCard className="px-3 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-400">
              <span>CS / MIN VS {csCard?.targetLabel ?? 'TARGET'}</span>
              {isEditMode && <GripVertical className="h-3.5 w-3.5 text-amber-300" />}
            </div>
            {csCard ? (
              <div className="mt-0.5 flex items-baseline justify-between gap-2.5">
                <div className="tabular-nums font-mono text-base font-extrabold text-white">
                  {csCard.csPerMin.toFixed(1)}{' '}
                  <span className="text-[11px] font-medium text-slate-400">
                    / {csCard.targetCsPerMin.toFixed(1)}
                  </span>
                </div>
                <span
                  className={`tabular-nums rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    csCard.status === 'ahead'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : csCard.status === 'behind'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-sky-500/20 text-sky-200'
                  }`}
                >
                  {csCard.deltaPerMin >= 0 ? `+${csCard.deltaPerMin.toFixed(1)}` : csCard.deltaPerMin.toFixed(1)} · {csCard.currentCs} CS
                </span>
              </div>
            ) : (
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="tabular-nums font-mono text-base font-extrabold text-white">7.4 / 7.2</span>
                <span className="text-[11px] font-bold text-emerald-300">+0.2</span>
              </div>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 4: Skill Order (What to Skill Next) */}
      {showSkill && (
        <div
          data-testid="hud-widget-skillOrder"
          onPointerDown={(e) => beginWidgetDrag('skillOrder', e)}
          onPointerMove={(e) => moveWidgetDrag('skillOrder', e)}
          onPointerUp={(e) => endWidgetDrag('skillOrder', e)}
          style={{
            ...widgetPos('skillOrder'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 min-w-[180px] ${wrapInteractive}`}
        >
          <HudCard urgent={Boolean(skillCard && skillCard.unspentPoints > 0)} className="px-3 py-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-400">
              <span>SKILL ORDER</span>
              {isEditMode && <GripVertical className="h-3.5 w-3.5 text-amber-300" />}
            </div>
            {skillCard ? (
              <div className="mt-0.5 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-1.5">
                  {(['Q', 'W', 'E', 'R'] as const).map((k) => {
                    const isNext = skillCard.nextSkill === k;
                    return (
                      <span
                        key={k}
                        className={`flex h-6 w-6 items-center justify-center rounded text-xs font-extrabold ${
                          isNext
                            ? skillCard.unspentPoints > 0
                              ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-200'
                              : 'bg-sky-400/25 text-sky-200 ring-1 ring-sky-400/60'
                            : 'bg-white/[0.06] text-slate-400'
                        }`}
                      >
                        {k}
                      </span>
                    );
                  })}
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-bold text-amber-200">{skillCard.promptLabel}</div>
                  <div className="text-[10px] text-slate-400">{skillCard.maxOrderLabel}</div>
                </div>
              </div>
            ) : (
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="font-bold text-amber-300">LEVEL Q NOW</span>
                <span className="text-[10px] text-slate-400">R &gt; Q &gt; E &gt; W</span>
              </div>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 5: Level-2 Plan, Macro Phases & Power Spikes */}
      {showGamePlan && (
        <div
          data-testid="hud-widget-gamePlan"
          onPointerDown={(e) => beginWidgetDrag('gamePlan', e)}
          onPointerMove={(e) => moveWidgetDrag('gamePlan', e)}
          onPointerUp={(e) => endWidgetDrag('gamePlan', e)}
          style={{
            ...widgetPos('gamePlan'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 max-w-[290px] min-w-[230px] ${wrapInteractive}`}
        >
          <HudCard className="px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                {gamePlanCard?.phaseTitle ?? 'Level-2 Plan'}
                {gamePlanCard?.phaseWindow ? ` · ${gamePlanCard.phaseWindow}` : ''}
              </span>
              {isEditMode && <GripVertical className="h-3.5 w-3.5 text-amber-300" />}
              {!isEditMode && gamePlanCard?.smiteBadge && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
                  {gamePlanCard.smiteBadge}
                </span>
              )}
            </div>
            {gamePlanCard ? (
              <div className="space-y-1 text-[11px]">
                <p className="leading-snug text-white/[0.92]">{gamePlanCard.planSummary}</p>
                <div className="border-t border-white/[0.08] pt-1 text-[10px] text-amber-200">
                  Spike: {gamePlanCard.powerSpikeLabel}
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-[11px]">
                <p className="text-white/[0.9]">Wave 1 + 3 melees on wave 2 for Lv2 all-in</p>
                <div className="text-[10px] text-amber-200">Spike: 1-Item Kraken + Q Evolve</div>
              </div>
            )}
          </HudCard>
        </div>
      )}

      {/* Widget 6: Urgent Tactical Macro Cue */}
      {showCue && (
        <div
          data-testid="hud-widget-cue"
          onPointerDown={(e) => beginWidgetDrag('cue', e)}
          onPointerMove={(e) => moveWidgetDrag('cue', e)}
          onPointerUp={(e) => endWidgetDrag('cue', e)}
          style={{
            ...widgetPos('cue'),
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left',
          }}
          className={`fixed z-20 max-w-[360px] min-w-[240px] ${wrapInteractive}`}
        >
          <HudCard
            testId="hud-macro-cue"
            urgent={Boolean(cueCard?.urgent)}
            className="px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[11px] leading-snug text-white/[0.95]">
                <span className="font-bold text-amber-200">
                  {cueCard?.title ?? 'Setup Dragon Vision'}:
                </span>{' '}
                {cueCard?.detail ?? 'Shove bot wave first and sweep river brush 45s prior.'}
              </div>
              {isEditMode && <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />}
            </div>
          </HudCard>
        </div>
      )}
    </div>
  );
}
