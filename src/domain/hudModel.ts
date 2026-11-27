import { formatClock } from './liveCoachEngine';
import type {
  AdaptiveBuildPlan,
  JungleRoute,
  MacroCue,
  ObjectiveWindow,
} from '../types/coaching';
import type { GamePhase } from '../types/riot';

export type ObjectiveBadgeKind =
  | 'scuttle'
  | 'dragon'
  | 'baron'
  | 'grubs'
  | 'herald'
  | 'objective';

export interface HudStatusChip {
  dotTone: 'idle' | 'active' | 'urgent';
  label: string;
  hotkey: string;
  isOffRole?: boolean;
  activeRole?: 'jungle' | 'bottom' | 'off_role';
}

export interface HudRouteCard {
  title: string;
  campsLine: string;
  timeWindow: string;
}

export interface HudObjectiveCard {
  kind: ObjectiveBadgeKind;
  name: string;
  shortName: string;
  timerText: string;
  isLive: boolean;
  isPrep: boolean;
  urgencyPct: number;
  actionChip: string;
  secondary?: {
    kind: ObjectiveBadgeKind;
    name: string;
    shortName: string;
    timerText: string;
    isLive: boolean;
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
  isOffRole?: boolean;
  activeRole?: 'jungle' | 'bottom' | 'off_role';
}

function inferObjectiveBadgeKind(obj: ObjectiveWindow): ObjectiveBadgeKind {
  const hay = `${obj.id} ${obj.name}`.toLowerCase();
  if (hay.includes('scuttle') || hay.includes('scuttler')) return 'scuttle';
  if (hay.includes('baron') || hay.includes('nashor')) return 'baron';
  if (hay.includes('grub')) return 'grubs';
  if (hay.includes('herald')) return 'herald';
  if (hay.includes('dragon') || hay.includes('drake')) return 'dragon';
  return 'objective';
}

function toShortObjectiveName(kind: ObjectiveBadgeKind): string {
  switch (kind) {
    case 'scuttle':
      return 'SCT';
    case 'dragon':
      return 'DRG';
    case 'baron':
      return 'BRN';
    case 'grubs':
      return 'GRB';
    case 'herald':
      return 'HLD';
    case 'objective':
      return 'OBJ';
  }
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
 * Pure transformer driving the broadcast-inspired translucent Compact HUD.
 */
export function deriveHudCards(input: DeriveHudCardsInput): HudCardModel {
  const primaryObj = input.objectives[0] ?? null;
  const secondaryObj = input.objectives[1] ?? null;
  const isUrgent =
    primaryObj?.status === 'live' || primaryObj?.status === 'prep_vision';

  const effectiveRole: 'jungle' | 'bottom' | 'off_role' =
    input.activeRole ?? (input.isOffRole ? 'off_role' : 'jungle');
  const isOffRole = effectiveRole === 'off_role';

  const statusChip: HudStatusChip = {
    dotTone: isUrgent
      ? 'urgent'
      : input.phase === 'in_game' || input.phase === 'loading'
        ? 'active'
        : 'idle',
    label:
      input.phase === 'in_game' && input.gameTime > 0
        ? `LIVE ${formatClock(input.gameTime)}`
        : input.phase === 'loading'
          ? 'LOADING MATCH'
          : input.phase === 'champ_select'
            ? 'CHAMP SELECT'
            : 'HUD armed · appears in game',
    hotkey: input.hotkey,
    isOffRole,
    activeRole: effectiveRole,
  };

  const showOpeningRoute =
    effectiveRole === 'jungle' &&
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

  const primaryKind = primaryObj ? inferObjectiveBadgeKind(primaryObj) : null;
  const secondaryKind = secondaryObj ? inferObjectiveBadgeKind(secondaryObj) : null;

  const objectiveCard: HudObjectiveCard | null =
    !showOpeningRoute && input.phase === 'in_game' && primaryObj && primaryKind
      ? {
          kind: primaryKind,
          name: primaryObj.name,
          shortName: toShortObjectiveName(primaryKind),
          timerText:
            primaryObj.status === 'live'
              ? 'LIVE'
              : formatClock(primaryObj.secondsRemaining),
          isLive: primaryObj.status === 'live',
          isPrep: primaryObj.status === 'prep_vision',
          urgencyPct: computeUrgencyPct(primaryObj),
          actionChip: toShortActionChip(primaryObj),
          secondary:
            secondaryObj && secondaryKind
              ? {
                  kind: secondaryKind,
                  name: secondaryObj.name,
                  shortName: toShortObjectiveName(secondaryKind),
                  timerText:
                    secondaryObj.status === 'live'
                      ? 'LIVE'
                      : formatClock(secondaryObj.secondsRemaining),
                  isLive: secondaryObj.status === 'live',
                }
              : undefined,
        }
      : null;

  const buyCard: HudBuyCard | null =
    !isOffRole &&
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
    !isOffRole &&
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
