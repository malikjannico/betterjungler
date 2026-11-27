/**
 * ADC Live Coach engine — parallel to the Jungle live coach.
 *
 * Read-only reuse of `assessLiveThreats` / `resolveSelfPlayer` / `formatClock` from
 * `../liveCoachEngine` (unmodified). Items come exclusively from `ADC_ITEM_CATALOG`
 * (plus the shared trinket / Control Ward entries), so no Jungle / bruiser / tank items
 * (e.g. Chempunk Chainsword) can ever be recommended.
 */
import {
  ADC_ITEM_CATALOG,
  findAdcChampionByName,
  resolveAdcItem,
  type AdcChampionProfile,
} from '../../data/adcKnowledgePack';
import { CHAMPION_META_TABLE, resolveItemMetadata } from '../../data/jungleKnowledgePack';
import { assessLiveThreats, formatClock, resolveSelfPlayer } from '../liveCoachEngine';
import type {
  AdaptiveBuildPlan,
  AdcDivisionBenchmark,
  ChampionMetaEntry,
  DivisionTier,
  ItemMetadata,
  ItemRecommendation,
  MacroCue,
  ObjectiveWindow,
  ThreatAssessment,
} from '../../types/coaching';
import type { LiveEvent, LiveGameData, LivePlayer } from '../../types/riot';
import type { AdcWinConditionPlan } from './types';

// ---------------------------------------------------------------------------
// Item IDs
// ---------------------------------------------------------------------------

export const ADC_ITEM_IDS = {
  mortalReminder: 3033,
  lordDominiks: 3036,
  mercurialScimitar: 3139,
  quicksilverSash: 3140,
  immortalShieldbow: 6673,
  guardianAngel: 3026,
  bloodthirster: 3072,
  berserkersGreaves: 3006,
  bootsOfSwiftness: 3009,
  stealthWard: 3340,
  farsightAlteration: 3363,
  controlWard: 2055,
} as const;

/** B.F. Sword cost — the classic first-reset spike threshold. */
export const ADC_RECALL_SPIKE_GOLD = 1300;

/** Threat → reactive ADC item rules (consumes `assessLiveThreats` output). */
export const ADC_ITEM_REACTIVE = {
  healing: {
    itemIds: [ADC_ITEM_IDS.mortalReminder],
    reason: 'Reactive: heavy enemy healing -> Mortal Reminder (Grievous Wounds + armor pen)',
  },
  tank: {
    itemIds: [ADC_ITEM_IDS.lordDominiks],
    reason: "Reactive: 2+ tanky frontliners -> Lord Dominik's Regards armor penetration",
  },
  cc: {
    itemIds: [ADC_ITEM_IDS.mercurialScimitar],
    componentId: ADC_ITEM_IDS.quicksilverSash,
    reason: 'Reactive: heavy hard CC -> Mercurial Scimitar (rush the Quicksilver Sash component if you need the cleanse now)',
  },
  burst: {
    itemIds: [ADC_ITEM_IDS.immortalShieldbow, ADC_ITEM_IDS.guardianAngel, ADC_ITEM_IDS.bloodthirster],
    reason: 'Reactive: fed burst / assassins -> Immortal Shieldbow lifeline (Guardian Angel for late fights, Bloodthirster vs poke)',
  },
} as const;

/** Item IDs that must never appear in ADC recommendations (jungle / bruiser / tank items). */
export const ADC_FORBIDDEN_ITEM_IDS: ReadonlySet<number> = new Set([
  6609, // Chempunk Chainsword
  3075, // Thornmail
  3071, // Black Cleaver
  3068, // Sunfire Aegis
  3143, // Randuin's Omen
  3111, // Mercury's Treads
  3047, // Plated Steelcaps
  3364, // Oracle Lens (support/jungle sweeper)
  1101,
  1102,
  1103, // Jungle pets
]);

const LAST_WHISPER_IDS = new Set<number>([3033, 3036, 6694]);
const LIFELINE_IDS = new Set<number>([6673]);
const BOOT_IDS = new Set<number>([3006, 3009, 3158, 1001]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function findMeta(player: LivePlayer): ChampionMetaEntry | undefined {
  const candidates = [
    player.championName,
    player.rawChampionName?.replace(/^game_character_displayname_/i, ''),
  ]
    .filter((c): c is string => Boolean(c))
    .map(normalize);
  return Object.values(CHAMPION_META_TABLE).find((entry) =>
    candidates.some((c) => normalize(entry.name) === c || normalize(entry.key) === c)
  );
}

function resolveSelfAdcProfile(self: LivePlayer | null): AdcChampionProfile | undefined {
  if (!self) return undefined;
  return (
    findAdcChampionByName(self.championName) ??
    (self.rawChampionName
      ? findAdcChampionByName(self.rawChampionName.replace(/^game_character_displayname_/i, ''))
      : undefined)
  );
}

function resolveAdcCatalogItem(itemId: number): ItemMetadata | undefined {
  if (ADC_FORBIDDEN_ITEM_IDS.has(itemId)) return undefined;
  return resolveAdcItem(itemId);
}

function makeRecommendation(
  itemId: number,
  reason: string,
  currentGold: number,
  componentIds: number[] = []
): ItemRecommendation | null {
  const item = resolveAdcCatalogItem(itemId);
  if (!item) return null;
  const affordableComponents = componentIds
    .map((id) => resolveAdcCatalogItem(id))
    .filter((c): c is ItemMetadata => c !== undefined && c.cost <= currentGold);
  return {
    item,
    reason,
    affordableNow: currentGold >= item.cost,
    goldNeeded: Math.max(0, item.cost - currentGold),
    affordableComponents,
  };
}

export interface AdcThreatProfile extends ThreatAssessment {
  assassinCount: number;
  /** Fed AD/AP burst or any assassin. */
  burstThreat: boolean;
}

export function assessAdcThreats(enemies: LivePlayer[]): AdcThreatProfile {
  const base = assessLiveThreats(enemies);
  const assassinCount = enemies.filter((e) => findMeta(e)?.championClass === 'assassin').length;
  const fedAssassin = enemies.some(
    (e) => findMeta(e)?.championClass === 'assassin' && e.scores.kills >= 3
  );
  const burstThreat = base.adThreat || base.apThreat || assassinCount >= 2 || fedAssassin;
  const reasons = [...base.reasons];
  if (burstThreat && !base.adThreat && !base.apThreat) {
    reasons.push('Assassin dive threat -> ADC lifeline / anti-burst item');
  }
  return { ...base, reasons, assassinCount, burstThreat };
}

// ---------------------------------------------------------------------------
// Adaptive ADC build
// ---------------------------------------------------------------------------

export interface AdcAdaptiveBuildPlan extends AdaptiveBuildPlan {
  threats: AdcThreatProfile;
  /** Every threat-reactive pivot that was injected (in priority order). */
  reactivePivots: ItemRecommendation[];
}

export function computeAdcAdaptiveBuild(
  liveData: LiveGameData,
  profileOverride?: AdcChampionProfile
): AdcAdaptiveBuildPlan {
  const self = resolveSelfPlayer(liveData);
  const profile = profileOverride ?? resolveSelfAdcProfile(self);
  const enemies = self ? liveData.allPlayers.filter((p) => p.team !== self.team) : [];
  const threats = assessAdcThreats(enemies);

  const inventory = (self?.items ?? []).filter((i) => i.slot < 6);
  const ownedIds = new Set(inventory.map((i) => i.itemID));
  const ownedTrinketId = (self?.items ?? []).find((i) => i.slot === 6)?.itemID;
  const currentGold = Math.floor(liveData.activePlayer.currentGold);
  const gameTime = liveData.gameData.gameTime;
  const level = liveData.activePlayer.level;

  const majorItems = inventory.filter(
    (i) => i.price >= 2400 && !BOOT_IDS.has(i.itemID) && !ADC_ITEM_CATALOG[i.itemID]?.tags.includes('boots')
  ).length;
  const ownsBoots = inventory.some(
    (i) => BOOT_IDS.has(i.itemID) || ADC_ITEM_CATALOG[i.itemID]?.tags.includes('boots')
  );
  const isFullBuild = majorItems >= 5 && (inventory.length >= 6 || ownsBoots);

  // --- Reactive pivots (priority order) ---
  const reactive: Array<{ id: number; reason: string; components?: number[] }> = [];
  const ownsLastWhisper = [...ownedIds].some((id) => LAST_WHISPER_IDS.has(id));

  if (threats.healingThreat && !ownedIds.has(ADC_ITEM_IDS.mortalReminder)) {
    reactive.push({ id: ADC_ITEM_IDS.mortalReminder, reason: ADC_ITEM_REACTIVE.healing.reason });
  }
  if (threats.tankThreat && !ownsLastWhisper && !threats.healingThreat) {
    reactive.push({ id: ADC_ITEM_IDS.lordDominiks, reason: ADC_ITEM_REACTIVE.tank.reason });
  }
  if (threats.ccThreat && !ownedIds.has(ADC_ITEM_IDS.mercurialScimitar)) {
    reactive.push({
      id: ADC_ITEM_IDS.mercurialScimitar,
      reason: ADC_ITEM_REACTIVE.cc.reason,
      components: ownedIds.has(ADC_ITEM_IDS.quicksilverSash) ? [] : [ADC_ITEM_IDS.quicksilverSash],
    });
  }
  if (threats.burstThreat) {
    const ownsLifeline = [...ownedIds].some((id) => LIFELINE_IDS.has(id));
    if (!ownsLifeline) {
      reactive.push({
        id: ADC_ITEM_IDS.immortalShieldbow,
        reason: 'Reactive: fed burst / assassins -> Immortal Shieldbow lifeline shield',
      });
    }
    if ((gameTime >= 1500 || majorItems >= 3) && !ownedIds.has(ADC_ITEM_IDS.guardianAngel)) {
      reactive.push({
        id: ADC_ITEM_IDS.guardianAngel,
        reason: 'Reactive: you are focused in late fights -> Guardian Angel revive',
      });
    }
    if (threats.adThreat && !ownedIds.has(ADC_ITEM_IDS.bloodthirster)) {
      reactive.push({
        id: ADC_ITEM_IDS.bloodthirster,
        reason: 'Reactive: fed AD poke/burst -> Bloodthirster overheal shield',
      });
    }
  }

  // --- Queue assembly ---
  const queue: Array<{ id: number; reason: string; components?: number[] }> = [];
  const core = (profile?.coreItemIds ?? []).filter((id) => !ownedIds.has(id));
  const coreEntries = core.map((id) => ({
    id,
    reason: ADC_ITEM_CATALOG[id]?.shortReason ?? 'Core ADC spike',
  }));

  // Never delay the first core spike: reactive pivots slot in after the first item.
  if (majorItems === 0 && coreEntries.length > 0) {
    queue.push(coreEntries[0]!, ...reactive, ...coreEntries.slice(1));
  } else {
    queue.push(...reactive, ...coreEntries);
  }

  if (!ownsBoots) {
    let bootId: number = profile?.bootItemId ?? ADC_ITEM_IDS.berserkersGreaves;
    let bootReason = "Standard ADC boots: Berserker's Greaves attack speed";
    if (bootId === ADC_ITEM_IDS.bootsOfSwiftness) {
      bootReason = 'Boots of Swiftness for kiting tempo';
    } else if (bootId !== ADC_ITEM_IDS.berserkersGreaves) {
      bootReason = ADC_ITEM_CATALOG[bootId]?.shortReason ?? 'Champion-specific boots';
    }
    if (threats.ccThreat && bootId === ADC_ITEM_IDS.berserkersGreaves) {
      bootId = ADC_ITEM_IDS.bootsOfSwiftness;
      bootReason = 'Heavy slows/CC -> Boots of Swiftness fallback for slow resist & kiting';
    }
    queue.splice(Math.min(1, queue.length), 0, { id: bootId, reason: bootReason });
  }

  for (const id of profile?.situationalItemIds ?? []) {
    if (!queue.some((q) => q.id === id)) {
      queue.push({ id, reason: ADC_ITEM_CATALOG[id]?.shortReason ?? 'Situational ADC item' });
    }
  }

  const seen = new Set<number>();
  const recommendations: ItemRecommendation[] = [];
  const reactiveIds = new Set(reactive.map((r) => r.id));
  const reactivePivots: ItemRecommendation[] = [];
  for (const entry of queue) {
    if (seen.has(entry.id) || ownedIds.has(entry.id)) continue;
    // Last Whisper items are mutually exclusive.
    if (LAST_WHISPER_IDS.has(entry.id) && [...seen].some((id) => LAST_WHISPER_IDS.has(id))) continue;
    if (LAST_WHISPER_IDS.has(entry.id) && ownsLastWhisper) continue;
    seen.add(entry.id);
    const rec = makeRecommendation(entry.id, entry.reason, currentGold, entry.components);
    if (!rec) continue;
    recommendations.push(rec);
    if (reactiveIds.has(entry.id)) reactivePivots.push(rec);
  }

  // --- Trinket: Stealth Ward early, Farsight on reset after Lv9 / 15:00 ---
  const stealth = resolveItemMetadata(ADC_ITEM_IDS.stealthWard)!;
  const farsight = resolveItemMetadata(ADC_ITEM_IDS.farsightAlteration)!;
  const farsightTime = level >= 9 || gameTime >= 900;
  const trinketAdvice =
    ownedTrinketId === ADC_ITEM_IDS.farsightAlteration
      ? {
          item: farsight,
          reason: 'Farsight active — scout brushes and Baron/Elder from max range; never face-check.',
        }
      : farsightTime
        ? {
            item: farsight,
            reason:
              'Swap to Farsight Alteration on your next reset (Lv9+ / 15:00+): check fog from safety instead of face-checking.',
          }
        : {
            item: stealth,
            reason: 'Keep Stealth Ward for the tri-brush / river pixel before the 2:15–2:55 gank window.',
          };

  const consumableAdvice: AdaptiveBuildPlan['consumableAdvice'] = [];
  const controlWard = resolveItemMetadata(ADC_ITEM_IDS.controlWard);
  if (controlWard && inventory.length < 6 && currentGold >= controlWard.cost) {
    consumableAdvice.push({
      item: controlWard,
      reason: 'Buy a Control Ward for the bot lane brush or Dragon-side river.',
    });
  }

  const fullBuildAlternatives: AdaptiveBuildPlan['fullBuildAlternatives'] = [];
  if (isFullBuild && !ownedIds.has(ADC_ITEM_IDS.guardianAngel)) {
    fullBuildAlternatives.push({
      replaceTarget: 'Lowest-impact situational item',
      recommendedItem: resolveAdcItem(ADC_ITEM_IDS.guardianAngel)!,
      reason: 'Full build: Guardian Angel keeps the carry alive through Baron/Elder fights.',
    });
  }

  return {
    threats,
    nextItem: recommendations[0] ?? null,
    upcomingQueue: recommendations.slice(1, 4),
    trinketAdvice,
    consumableAdvice,
    isFullBuild,
    fullBuildAlternatives,
    reactivePivots,
  };
}

// ---------------------------------------------------------------------------
// Riot-compliant live context
// ---------------------------------------------------------------------------

/**
 * Compile-time Riot compliance boundary for ADC live macro: ONLY public Live Client Data
 * (own scoreboard, clock, public events) may feed the engine — hidden game state is
 * statically forbidden via `never`.
 */
export interface AdcLiveContext {
  gameTime: number;
  currentGold: number;
  level: number;
  creepScore: number;
  wardScore: number;
  team: 'ORDER' | 'CHAOS' | null;
  /** From public `TurretKilled` events. */
  botTier1Destroyed: boolean;
  enemyCooldowns?: never;
  enemySpellTimers?: never;
  enemyPositions?: never;
  fogOfWarUnits?: never;
  enemyWardPositions?: never;
}

type TurretEvent = LiveEvent & { TurretKilled?: string };

/** Bot lane outer turrets: `Turret_T{1|2}_R_03_A` (R = bot lane). */
const BOT_TIER1_TURRET = /^Turret_T[12]_R_03_A$/i;

export function buildAdcLiveContext(liveData: LiveGameData): AdcLiveContext {
  const self = resolveSelfPlayer(liveData);
  const botTier1Destroyed = liveData.events.Events.some(
    (e) => e.EventName === 'TurretKilled' && BOT_TIER1_TURRET.test((e as TurretEvent).TurretKilled ?? '')
  );
  return {
    gameTime: liveData.gameData.gameTime,
    currentGold: Math.floor(liveData.activePlayer.currentGold),
    level: liveData.activePlayer.level,
    creepScore: self?.scores.creepScore ?? 0,
    wardScore: self?.scores.wardScore ?? 0,
    team: self?.team ?? null,
    botTier1Destroyed,
  };
}

// ---------------------------------------------------------------------------
// Macro guidance
// ---------------------------------------------------------------------------

/** ADC CS/min division priors (bot lane farms more than jungle). */
export const ADC_CS_PER_MIN_PRIORS: Record<DivisionTier, number> = {
  IRON: 5.2,
  BRONZE: 5.6,
  SILVER: 6.0,
  GOLD: 6.5,
  PLATINUM: 7.0,
  EMERALD: 7.4,
  DIAMOND: 7.8,
  MASTER: 8.3,
};

export interface AdcPersonalLearningSnapshot {
  adcMatchCount: number;
  /** Shrunk EWM CS/min baseline from your own ADC games. */
  csPerMinBaseline?: number;
  targetDivision?: DivisionTier | string;
  /** Signed patch-pack division benchmark, if available. */
  divisionBenchmark?: AdcDivisionBenchmark;
}

const MIN_PERSONAL_GAMES = 5;
const DEFAULT_CS_TARGET = 6.5;

export function resolveAdcCsTarget(
  personal?: AdcPersonalLearningSnapshot | null
): { target: number; source: 'personal' | 'division' | 'default' } {
  if (
    personal?.csPerMinBaseline !== undefined &&
    Number.isFinite(personal.csPerMinBaseline) &&
    personal.adcMatchCount >= MIN_PERSONAL_GAMES
  ) {
    return { target: personal.csPerMinBaseline, source: 'personal' };
  }
  if (personal?.divisionBenchmark) {
    return { target: personal.divisionBenchmark.csPerMin, source: 'division' };
  }
  const tier = personal?.targetDivision?.toUpperCase() as DivisionTier | undefined;
  if (tier && tier in ADC_CS_PER_MIN_PRIORS) {
    return { target: ADC_CS_PER_MIN_PRIORS[tier], source: 'division' };
  }
  return { target: DEFAULT_CS_TARGET, source: 'default' };
}

export function computeAdcMacroCues(
  ctx: AdcLiveContext,
  adcPlan: AdcWinConditionPlan | null,
  objectives: ObjectiveWindow[],
  personalLearning?: AdcPersonalLearningSnapshot | null
): MacroCue[] {
  const cues: MacroCue[] = [];
  const { gameTime, currentGold } = ctx;
  const topObjective = objectives[0];

  // 1. Objective setup
  if (topObjective && (topObjective.status === 'prep_vision' || topObjective.status === 'live')) {
    const secs = Math.max(0, Math.round(topObjective.secondsRemaining));
    const isDragon = topObjective.id === 'dragon';
    cues.push({
      id: 'adc-obj-setup',
      category: 'objective',
      priority: 'urgent',
      source: 'standard',
      title: `${topObjective.name} (${topObjective.status === 'live' ? 'LIVE' : `in ${secs}s`})`,
      detail: isDragon
        ? 'Shove the bot wave first, then rotate to Dragon with your Support — arrive before the enemy duo.'
        : 'Push your wave, group with your team, and position behind your frontline — no face-checks.',
    });
  }

  // 2. Gold-spike recall
  if (currentGold >= ADC_RECALL_SPIKE_GOLD) {
    const objSoon = topObjective && topObjective.secondsRemaining > 0 && topObjective.secondsRemaining <= 35;
    if (!objSoon) {
      const aheadOf =
        topObjective && topObjective.secondsRemaining > 35 && topObjective.secondsRemaining <= 120
          ? ` ahead of ${topObjective.name} (${formatClock(topObjective.secondsRemaining)})`
          : '';
      cues.push({
        id: 'adc-recall-spike',
        category: 'clear',
        priority: 'high',
        source: 'standard',
        title: `Recall spike: ${currentGold}g${aheadOf}`,
        detail:
          currentGold >= 3000
            ? 'Full item available — crash the wave and reset to complete it now.'
            : 'B.F. Sword spike (1300g) — crash the wave into tower, reset, and return before the next wave.',
      });
    }
  }

  // 3. CS/min pace
  if (gameTime >= 240) {
    const csPerMin = ctx.creepScore / Math.max(1, gameTime / 60);
    const { target, source } = resolveAdcCsTarget(personalLearning);
    const gap = target - csPerMin;
    const label = source === 'personal' ? 'personal baseline' : source === 'division' ? 'division target' : 'target';
    cues.push({
      id: 'adc-cs-pace',
      category: 'clear',
      priority: gap >= 0.8 ? 'high' : 'normal',
      source: source === 'personal' ? 'personal_guardrail' : 'standard',
      title: `CS pace ${csPerMin.toFixed(1)}/min vs ${target.toFixed(1)} ${label}`,
      detail:
        gap >= 0.8
          ? 'Behind your pace — prioritise the next two waves over roaming; catch side waves before grouping.'
          : 'On pace — keep last-hitting every wave between fights.',
    });
  }

  // 4. 14:00 plate deadline
  if (gameTime >= 300 && gameTime < 840) {
    const remaining = 840 - gameTime;
    cues.push({
      id: 'adc-plate-deadline',
      category: 'push',
      priority: remaining <= 120 ? 'urgent' : 'normal',
      source: 'standard',
      title: `Plates fall at 14:00 (${formatClock(remaining)} left)`,
      detail: 'Convert every kill or enemy recall into plate damage with your Support.',
    });
  }

  // 5. Bot → Mid swap
  if (ctx.botTier1Destroyed || gameTime >= 840) {
    cues.push({
      id: 'adc-mid-swap',
      category: 'push',
      priority: ctx.botTier1Destroyed ? 'high' : 'normal',
      source: 'standard',
      title: ctx.botTier1Destroyed ? 'Bot Tier-1 down — swap Mid' : 'Plates gone — prepare Mid swap',
      detail:
        adcPlan?.midSwap.instruction ??
        'Take Mid wave with your Support, let a solo laner hold Bot, and play from the center.',
    });
  }

  // 6. Phase reminder from the win plan
  if (adcPlan) {
    const phase = adcPlan.macroPhases.find(
      (p) => gameTime >= p.startSec && (p.endSec === null || gameTime < p.endSec)
    );
    if (phase) {
      cues.push({
        id: `adc-phase-${phase.id}`,
        category: phase.id === 'laning_lv2' ? 'gank' : 'push',
        priority: 'normal',
        source: 'standard',
        title: `${phase.label} (${phase.timeWindow}): ${phase.focus}`,
        detail: phase.actions[0] ?? phase.focus,
      });
    }
  }

  // 7. Early gank window alert
  if (adcPlan && gameTime < adcPlan.enemyJunglerThreat.dangerWindow.endSec + 30) {
    const w = adcPlan.enemyJunglerThreat.dangerWindow;
    if (gameTime >= w.startSec - 20) {
      cues.push({
        id: 'adc-gank-window',
        category: 'vision',
        priority: adcPlan.enemyJunglerThreat.threatLevel === 'high' ? 'urgent' : 'high',
        source: 'standard',
        title: `Jungler danger: ${w.label}`,
        detail: adcPlan.enemyJunglerThreat.instruction,
      });
    }
  }

  return cues;
}

export function computeAdcMacroGuidance(
  liveData: LiveGameData,
  adcPlan: AdcWinConditionPlan | null,
  objectives: ObjectiveWindow[],
  personalLearning?: AdcPersonalLearningSnapshot | null
): MacroCue[] {
  return computeAdcMacroCues(buildAdcLiveContext(liveData), adcPlan, objectives, personalLearning);
}
