import { formatClock } from './liveCoachEngine';
import type { SkillOrderAdvice } from './skillOrderEngine';
import type { AdcWinConditionPlan } from './adc/types';
import type {
  AdaptiveBuildPlan,
  JungleRoute,
  MacroCue,
  ObjectiveWindow,
  SmiteTierStatus,
  WinConditionPlan,
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

export interface HudCsCard {
  currentCs: number;
  csPerMin: number;
  targetCsPerMin: number;
  deltaPerMin: number;
  status: 'ahead' | 'on_track' | 'behind';
  targetLabel: string;
}

export interface HudGamePlanCard {
  phaseTitle: string;
  phaseWindow: string;
  planSummary: string;
  powerSpikeLabel: string;
  smiteBadge?: string;
}

export interface HudCardModel {
  statusChip: HudStatusChip;
  routeCard: HudRouteCard | null;
  objectiveCard: HudObjectiveCard | null;
  buyCard: HudBuyCard | null;
  csCard: HudCsCard | null;
  skillOrderCard: SkillOrderAdvice | null;
  gamePlanCard: HudGamePlanCard | null;
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
  creepScore?: number;
  targetCsPerMin?: number;
  targetDivisionLabel?: string;
  skillOrder?: SkillOrderAdvice | null;
  winPlan?: WinConditionPlan | null;
  adcWinPlan?: AdcWinConditionPlan | null;
  smiteStatus?: SmiteTierStatus | null;
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

function buildGamePlanCard(
  role: 'jungle' | 'bottom',
  gameTime: number,
  adcWinPlan: AdcWinConditionPlan | null | undefined,
  winPlan: WinConditionPlan | null | undefined,
  openingRoute: JungleRoute | null,
  smiteStatus: SmiteTierStatus | null | undefined
): HudGamePlanCard | null {
  if (role === 'bottom' && adcWinPlan) {
    const activePhase =
      adcWinPlan.macroPhases.find(
        (p) => gameTime >= p.startSec && (p.endSec === null || gameTime < p.endSec)
      ) ?? adcWinPlan.macroPhases[0];
    const nextSpike =
      gameTime < 900
        ? adcWinPlan.powerSpikes[0]
        : gameTime < 1500
          ? (adcWinPlan.powerSpikes[1] ?? adcWinPlan.powerSpikes[0])
          : (adcWinPlan.powerSpikes[2] ?? adcWinPlan.powerSpikes[1] ?? adcWinPlan.powerSpikes[0]);

    const isLv2Window = gameTime < 240;
    return {
      phaseTitle: isLv2Window ? 'Level-2 Plan' : (activePhase?.label ?? 'Macro Phase'),
      phaseWindow: isLv2Window ? '0:30–4:00' : (activePhase?.timeWindow ?? ''),
      planSummary: isLv2Window
        ? adcWinPlan.wavePlan.level2Rule
        : (activePhase?.actions[0] ?? activePhase?.focus ?? adcWinPlan.laneGamePlan),
      powerSpikeLabel: nextSpike ? `${nextSpike.label}: ${nextSpike.note}` : '1-Item Spike',
    };
  }

  if (role === 'jungle' && (winPlan || openingRoute)) {
    const smiteBadge = smiteStatus ? `Smite ${smiteStatus.damage}` : undefined;
    if (gameTime < 120 && openingRoute) {
      return {
        phaseTitle: 'Lv2 / Opening Clear',
        phaseWindow: openingRoute.timeWindow,
        planSummary: `${openingRoute.descriptor} — Strong ${winPlan?.strongSide.toUpperCase() ?? 'Side'}`,
        powerSpikeLabel: winPlan?.phasePlaybook.early ?? openingRoute.summary,
        smiteBadge,
      };
    }
    if (winPlan) {
      const isLate = gameTime >= 1200;
      const isMid = gameTime >= 840 && !isLate;
      return {
        phaseTitle: isLate ? 'Late · Baron / Soul' : isMid ? 'Mid · Objectives' : 'Early · Clear & Gank',
        phaseWindow: isLate ? '20:00+' : isMid ? '14:00–20:00' : '1:55–14:00',
        planSummary: isLate
          ? winPlan.phasePlaybook.late
          : isMid
            ? winPlan.phasePlaybook.mid
            : winPlan.phasePlaybook.early,
        powerSpikeLabel: `Strong ${winPlan.strongSide.toUpperCase()} · Deny: ${winPlan.enemyWinConditionToDeny}`,
        smiteBadge,
      };
    }
  }

  return null;
}

/**
 * Pure transformer driving the modular transparent In-Game HUD widgets.
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

  const hasCsInput = typeof input.creepScore === 'number' && input.phase === 'in_game';
  const targetCsPerMin =
    input.targetCsPerMin ?? (effectiveRole === 'bottom' ? 7.2 : 6.2);
  let csCard: HudCsCard | null = null;
  if (!isOffRole && hasCsInput) {
    const minutes = input.gameTime / 60;
    const csPerMin = minutes >= 0.5 ? Math.round(((input.creepScore ?? 0) / minutes) * 10) / 10 : 0;
    const deltaPerMin = Math.round((csPerMin - targetCsPerMin) * 10) / 10;
    const status: HudCsCard['status'] =
      minutes < 1.5
        ? 'on_track'
        : deltaPerMin >= 0.3
          ? 'ahead'
          : deltaPerMin <= -0.6
            ? 'behind'
            : 'on_track';
    csCard = {
      currentCs: input.creepScore ?? 0,
      csPerMin,
      targetCsPerMin,
      deltaPerMin,
      status,
      targetLabel: input.targetDivisionLabel ?? 'Target',
    };
  }

  const skillOrderCard: SkillOrderAdvice | null =
    !isOffRole && input.phase === 'in_game' ? (input.skillOrder ?? null) : null;

  const gamePlanCard: HudGamePlanCard | null =
    !isOffRole && (input.phase === 'in_game' || input.phase === 'loading')
      ? buildGamePlanCard(
          effectiveRole === 'bottom' ? 'bottom' : 'jungle',
          input.gameTime,
          input.adcWinPlan,
          input.winPlan,
          input.openingRoute,
          input.smiteStatus
        )
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
    csCard,
    skillOrderCard,
    gamePlanCard,
    cueCard,
    isUrgent,
  };
}
