import { formatClock } from './liveCoachEngine';
import type {
  AdaptiveBuildPlan,
  JungleRoute,
  MacroCue,
  ObjectiveWindow,
} from '../types/coaching';
import type { GamePhase } from '../types/riot';

export interface HudStatusChip {
  dotTone: 'idle' | 'active' | 'urgent';
  label: string;
  hotkey: string;
}

export interface HudRouteCard {
  title: string;
  campsLine: string;
  timeWindow: string;
}

export interface HudObjectiveCard {
  name: string;
  timerText: string;
  isLive: boolean;
  isPrep: boolean;
  urgencyPct: number;
  actionChip: string;
  secondary?: {
    name: string;
    timerText: string;
  };
}

export interface HudBuyCard {
  itemId: number;
  itemName: string;
  goldStatusText: string;
  affordableNow: boolean;
  trinketName: string;
}

export interface HudCueCard {
  title: string;
  detail: string;
  urgent: boolean;
}

export interface HudCardModel {
  statusChip: HudStatusChip;
  routeCard: HudRouteCard | null;
  objectiveCard: HudObjectiveCard | null;
  buyCard: HudBuyCard | null;
  cueCard: HudCueCard | null;
  isUrgent: boolean;
}

export interface DeriveHudCardsInput {
  phase: GamePhase;
  gameTime: number;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  topCue: MacroCue | null;
  openingRoute: JungleRoute | null;
  hotkey: string;
}

function toShortActionChip(obj: ObjectiveWindow): string {
  if (obj.status === 'live') return 'CONTEST NOW';
  if (obj.status === 'prep_vision') return 'RESET · WARD · SWEEP';
  if (obj.secondsRemaining <= 90) return 'CYCLE & SETUP';
  return 'TRACK SPAWN';
}

function computeUrgencyPct(obj: ObjectiveWindow): number {
  if (obj.status === 'live') return 100;
  const maxWindow = 90;
  const clamped = Math.max(0, Math.min(maxWindow, obj.secondsRemaining));
  return Math.round(((maxWindow - clamped) / maxWindow) * 100);
}

/**
 * Pure transformer driving the multi-card transparent floating HUD.
 */
export function deriveHudCards(input: DeriveHudCardsInput): HudCardModel {
  const primaryObj = input.objectives[0] ?? null;
  const secondaryObj = input.objectives[1] ?? null;
  const isUrgent =
    primaryObj?.status === 'live' || primaryObj?.status === 'prep_vision';

  const statusChip: HudStatusChip = {
    dotTone: isUrgent
      ? 'urgent'
      : input.phase === 'in_game' || input.phase === 'loading'
        ? 'active'
        : 'idle',
    label:
      input.phase === 'in_game' && input.gameTime > 0
        ? `Live · ${formatClock(input.gameTime)}`
        : input.phase === 'loading'
          ? 'Loading match'
          : input.phase === 'champ_select'
            ? 'Champ select'
            : 'HUD armed · appears in game',
    hotkey: input.hotkey,
  };

  // Pre-1:30 / loading route card replaces Objective + Buy telemetry while spawning
  const showOpeningRoute =
    Boolean(input.openingRoute) &&
    (input.phase === 'loading' || (input.phase === 'in_game' && input.gameTime < 90));

  const routeCard: HudRouteCard | null =
    showOpeningRoute && input.openingRoute
      ? {
          title: input.openingRoute.descriptor,
          campsLine: input.openingRoute.steps.map((s) => s.campName).join(' → '),
          timeWindow: input.openingRoute.timeWindow,
        }
      : null;

  const objectiveCard: HudObjectiveCard | null =
    !showOpeningRoute && input.phase === 'in_game' && primaryObj
      ? {
          name: primaryObj.name,
          timerText:
            primaryObj.status === 'live'
              ? 'LIVE'
              : formatClock(primaryObj.secondsRemaining),
          isLive: primaryObj.status === 'live',
          isPrep: primaryObj.status === 'prep_vision',
          urgencyPct: computeUrgencyPct(primaryObj),
          actionChip: toShortActionChip(primaryObj),
          secondary: secondaryObj
            ? {
                name: secondaryObj.name,
                timerText:
                  secondaryObj.status === 'live'
                    ? 'LIVE'
                    : formatClock(secondaryObj.secondsRemaining),
              }
            : undefined,
        }
      : null;

  const buyCard: HudBuyCard | null =
    !showOpeningRoute &&
    input.phase === 'in_game' &&
    input.buildPlan &&
    !input.buildPlan.isFullBuild &&
    input.buildPlan.nextItem
      ? {
          itemId: input.buildPlan.nextItem.item.id,
          itemName: input.buildPlan.nextItem.item.name,
          goldStatusText: input.buildPlan.nextItem.affordableNow
            ? 'BUY'
            : `−${input.buildPlan.nextItem.goldNeeded}g`,
          affordableNow: input.buildPlan.nextItem.affordableNow,
          trinketName: input.buildPlan.trinketAdvice.item.name,
        }
      : null;

  const cueCard: HudCueCard | null =
    input.phase === 'in_game' &&
    input.topCue &&
    (input.topCue.priority === 'urgent' || input.topCue.priority === 'high')
      ? {
          title: input.topCue.title,
          detail: input.topCue.detail,
          urgent: input.topCue.priority === 'urgent',
        }
      : null;

  return {
    statusChip,
    routeCard,
    objectiveCard,
    buyCard,
    cueCard,
    isUrgent,
  };
}
