import {
  CHAMPION_META_TABLE,
  ITEM_CATALOG,
  findJungleChampionByName,
  resolveItemMetadata,
} from '../data/jungleKnowledgePack';
import { findOwnedBootItem, getNonTrinketItems, hasCompletedBoots, isBootItem } from './itemDetection';
import type {
  AdaptiveBuildPlan,
  ChampionMetaEntry,
  ItemMetadata,
  ItemRecommendation,
  JungleChampionProfile,
  MacroCue,
  ObjectiveTimingsConfig,
  ObjectiveWindow,
  PersonalLearningSnapshot,
  PersonalLiveGuardrailContext,
  SmiteThresholdsConfig,
  SmiteTierStatus,
  ThreatAssessment,
  WinConditionPlan,
} from '../types/coaching';
import type { LiveGameData, LivePlayer, LcuChampSelectSession } from '../types/riot';

export const DEFAULT_OBJECTIVE_TIMINGS: ObjectiveTimingsConfig = {
  scuttleInitialSec: 175,
  dragonFirstSpawnSec: 300,
  dragonRespawnSec: 300,
  elderRespawnSec: 360,
  voidgrubsSpawnSec: 480,
  voidgrubsDespawnSec: 885,
  heraldSpawnSec: 900,
  heraldDespawnSec: 1185,
  baronSpawnSec: 1200,
  baronRespawnSec: 360,
};

export const DEFAULT_SMITE_THRESHOLDS: SmiteThresholdsConfig = {
  baseDamage: 600,
  unleashedDamage: 1000,
  primalDamage: 1400,
  unleashedStacks: 20,
  primalStacks: 35,
};

const ANTI_HEAL_ITEM_IDS = new Set([3123, 3916, 3076, 3075, 6609, 3165]);
const MR_ITEM_IDS = new Set([3111, 3155, 3156, 2504, 8020, 6664, 3102]);
const ARMOR_ITEM_IDS = new Set([3047, 3068, 3075, 3143, 3110, 6333, 3157, 3026, 3742]);
const PEN_ITEM_IDS = new Set([3071, 3153, 6694, 3036, 3135, 6653]);

// Locale-independent enemy threat item ID sets (Riot official item IDs)
const HEALING_THREAT_ITEM_IDS = new Set([3072, 6610, 6692, 4633, 6617, 3153, 3074]);
const CRIT_THREAT_ITEM_IDS = new Set([3031, 6676, 3046, 3094, 3085, 3087, 3036, 3033, 6672]);
const TANK_THREAT_ITEM_IDS = new Set([3068, 3084, 3075, 2504, 6665, 3110, 3143, 3742]);

export function resolveSelfPlayer(liveData: LiveGameData): LivePlayer | null {
  const activeRiotId = (
    liveData.activePlayer.riotId ??
    (liveData.activePlayer.riotIdGameName && liveData.activePlayer.riotIdTagLine
      ? `${liveData.activePlayer.riotIdGameName}#${liveData.activePlayer.riotIdTagLine}`
      : '')
  )
    .trim()
    .toLowerCase();

  if (activeRiotId) {
    const byRiotId = liveData.allPlayers.find((p) => {
      const pRiotId = (
        p.riotId ??
        (p.riotIdGameName && p.riotIdTagLine ? `${p.riotIdGameName}#${p.riotIdTagLine}` : '')
      )
        .trim()
        .toLowerCase();
      return pRiotId === activeRiotId;
    });
    if (byRiotId) return byRiotId;
  }

  const activeName = liveData.activePlayer.summonerName.trim();
  if (activeName) {
    const byName = liveData.allPlayers.find((p) => p.summonerName.trim() === activeName);
    if (byName) return byName;
  }

  return null;
}

const JUNGLE_PET_ITEM_IDS = new Set([1101, 1102, 1103]);

function hasSmiteInLivePlayer(player: LivePlayer): boolean {
  const s1 = `${player.summonerSpells?.summonerSpellOne?.rawDisplayName ?? ''} ${player.summonerSpells?.summonerSpellOne?.displayName ?? ''}`;
  const s2 = `${player.summonerSpells?.summonerSpellTwo?.rawDisplayName ?? ''} ${player.summonerSpells?.summonerSpellTwo?.displayName ?? ''}`;
  if (/smite/i.test(s1) || /smite/i.test(s2)) {
    return true;
  }
  return player.items.some((i) => JUNGLE_PET_ITEM_IDS.has(i.itemID));
}

/**
 * Determines whether the local player is actively playing Jungle in a live game.
 * Checks Smite / jungle pet first (catches Champ Select role swaps), then explicit
 * live position or LCU assignedPosition, avoiding false-positive jungle items on off-role games.
 */
export function isSelfJungleInLiveGame(
  liveData: LiveGameData,
  champSelect?: LcuChampSelectSession | null
): boolean {
  const self = resolveSelfPlayer(liveData);
  const localSlot = champSelect?.myTeam.find((s) => s.isLocalPlayer);
  if (localSlot && (localSlot.spell1Id === 11 || localSlot.spell2Id === 11)) {
    return true;
  }
  if (self && hasSmiteInLivePlayer(self)) {
    return true;
  }

  const normalizedPos = self?.position?.trim().toUpperCase() ?? '';
  if (normalizedPos === 'JUNGLE') {
    return true;
  }
  if (
    normalizedPos === 'TOP' ||
    normalizedPos === 'MIDDLE' ||
    normalizedPos === 'MID' ||
    normalizedPos === 'BOTTOM' ||
    normalizedPos === 'BOT' ||
    normalizedPos === 'UTILITY' ||
    normalizedPos === 'SUPPORT'
  ) {
    return false;
  }

  if (localSlot && localSlot.assignedPosition !== 'unknown') {
    return localSlot.assignedPosition === 'jungle';
  }

  if (self?.summonerSpells?.summonerSpellOne || self?.summonerSpells?.summonerSpellTwo) {
    return false;
  }

  return Boolean(self && findJungleChampionByName(self.championName));
}

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function findMetaByName(championName: string, rawChampionName?: string): ChampionMetaEntry | undefined {
  const candidates = [
    championName,
    rawChampionName?.replace(/^game_character_displayname_/i, ''),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = Object.values(CHAMPION_META_TABLE).find(
      (entry) =>
        entry.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized ||
        entry.key.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
    );
    if (found) return found;
  }
  return undefined;
}

/**
 * Deterministic Summoner's Rift objective respawn & spawn window tracker
 * built strictly from public Live Client Data clock + public kill events.
 */
export function computeObjectiveWindows(
  gameTime: number,
  events: LiveGameData['events']['Events'],
  allPlayers?: LivePlayer[],
  timings: ObjectiveTimingsConfig = DEFAULT_OBJECTIVE_TIMINGS
): ObjectiveWindow[] {
  const windows: ObjectiveWindow[] = [];

  // 1. Scuttle Crab
  if (gameTime < timings.scuttleInitialSec + 30) {
    const remaining = Math.max(0, timings.scuttleInitialSec - gameTime);
    const scuttleClock = formatClock(timings.scuttleInitialSec);
    windows.push({
      id: 'scuttle',
      name: 'Rift Scuttler',
      status: remaining === 0 ? 'live' : remaining <= 30 ? 'prep_vision' : 'upcoming',
      secondsRemaining: remaining,
      nextSpawnFormatted: scuttleClock,
      priority: remaining <= 30 ? 'high' : 'medium',
      actionText:
        remaining === 0
          ? 'Scuttle is LIVE — contest with lane priority or trade opposite crab.'
          : `Finish clear with 1 Smite charge saved for ${scuttleClock} Scuttle.`,
    });
  }

  // 2. Dragon
  const dragonKills = events.filter((e) => e.EventName === 'DragonKill');
  const lastDragonKill =
    dragonKills.length > 0
      ? dragonKills.reduce((latest, cur) => (cur.EventTime > latest.EventTime ? cur : latest))
      : null;

  let orderDragons = 0;
  let chaosDragons = 0;
  if (allPlayers && allPlayers.length > 0) {
    const teamByKiller = new Map<string, 'ORDER' | 'CHAOS'>();
    for (const p of allPlayers) {
      if (p.summonerName) teamByKiller.set(p.summonerName, p.team);
      if (p.riotIdGameName) teamByKiller.set(p.riotIdGameName, p.team);
      if (p.riotId) teamByKiller.set(p.riotId, p.team);
    }
    for (const dk of dragonKills) {
      const killerTeam = dk.KillerName ? teamByKiller.get(dk.KillerName) : undefined;
      if (killerTeam === 'ORDER') orderDragons += 1;
      else if (killerTeam === 'CHAOS') chaosDragons += 1;
    }
  }
  const hasExplicitElderKill = dragonKills.some(
    (d) => d.DragonType?.toLowerCase() === 'elder'
  );
  const maxTeamDragons = Math.max(orderDragons, chaosDragons);
  const isElderCandidate =
    hasExplicitElderKill ||
    (maxTeamDragons > 0 ? maxTeamDragons >= 4 : dragonKills.length >= 7);
  const isSoulPoint = !isElderCandidate && maxTeamDragons === 3;
  const dragonRespawnSec =
    lastDragonKill?.DragonType?.toLowerCase() === 'elder' || isElderCandidate
      ? timings.elderRespawnSec
      : timings.dragonRespawnSec;
  const nextDragonSpawn =
    lastDragonKill !== null
      ? lastDragonKill.EventTime + dragonRespawnSec
      : timings.dragonFirstSpawnSec;
  const dragonRem = Math.max(0, nextDragonSpawn - gameTime);

  windows.push({
    id: 'dragon',
    name: isElderCandidate
      ? 'Elder Dragon'
      : isSoulPoint
        ? 'Soul Point Dragon'
        : 'Elemental Dragon',
    status: dragonRem === 0 ? 'live' : dragonRem <= 60 ? 'prep_vision' : 'upcoming',
    secondsRemaining: dragonRem,
    nextSpawnFormatted: formatClock(nextDragonSpawn),
    priority: dragonRem <= 60 || isElderCandidate ? 'critical' : 'high',
    actionText:
      dragonRem === 0
        ? 'Dragon is UP — check bot/mid wave push before starting.'
        : dragonRem <= 60
          ? 'Recall, buy Control Ward, sweep pit & river 45s early.'
          : 'Cycle camps toward bot side ahead of Dragon spawn.',
  });

  // 2. Top River Objective Progression: Voidgrubs (8:00–14:45) -> Rift Herald (15:00–19:45) -> Baron Nashor (20:00+)
  const voidgrubKills = events.filter((e) => e.EventName === 'HordeKill');
  const heraldKills = events.filter((e) => e.EventName === 'HeraldKill');
  const baronKills = events.filter((e) => e.EventName === 'BaronKill');
  const voidgrubsDespawnSec =
    timings.voidgrubsDespawnSec ??
    Math.max(timings.voidgrubsSpawnSec + 60, timings.heraldSpawnSec - 15);

  if (gameTime < timings.heraldSpawnSec) {
    const grubsSpawn = timings.voidgrubsSpawnSec;
    const grubRem = Math.max(0, grubsSpawn - gameTime);
    const grubsClock = formatClock(grubsSpawn);
    if (gameTime < voidgrubsDespawnSec && voidgrubKills.length < 3) {
      windows.push({
        id: 'voidgrubs',
        name: 'Voidgrubs',
        status: grubRem === 0 ? 'live' : grubRem <= 50 ? 'prep_vision' : 'upcoming',
        secondsRemaining: grubRem,
        nextSpawnFormatted: grubsClock,
        priority: grubRem <= 50 ? 'high' : 'medium',
        actionText:
          grubRem === 0
            ? `Voidgrubs LIVE (despawn ${formatClock(voidgrubsDespawnSec)}) — secure all 3 grubs for turret siege.`
            : `Path top-side with top/mid prio before ${grubsClock} Voidgrubs.`,
      });
    } else {
      const heraldRem = Math.max(0, timings.heraldSpawnSec - gameTime);
      const heraldClock = formatClock(timings.heraldSpawnSec);
      windows.push({
        id: 'herald',
        name: 'Rift Herald',
        status: heraldRem <= 60 ? 'prep_vision' : 'upcoming',
        secondsRemaining: heraldRem,
        nextSpawnFormatted: heraldClock,
        priority: heraldRem <= 60 ? 'high' : 'medium',
        actionText: `Prepare Top river vision for ${heraldClock} Rift Herald spawn.`,
      });
    }
  } else if (gameTime < timings.heraldDespawnSec && heraldKills.length === 0) {
    windows.push({
      id: 'herald',
      name: 'Rift Herald',
      status: 'live',
      secondsRemaining: 0,
      nextSpawnFormatted: formatClock(timings.heraldSpawnSec),
      priority: 'high',
      actionText: `Rift Herald LIVE (despawns ${formatClock(timings.heraldDespawnSec)}) — use to crack Mid Tier-1 turret.`,
    });
  } else {
    const lastBaron =
      baronKills.length > 0 ? Math.max(...baronKills.map((e) => e.EventTime)) : null;
    const nextBaron =
      lastBaron !== null
        ? Math.max(timings.baronSpawnSec, lastBaron + timings.baronRespawnSec)
        : timings.baronSpawnSec;
    const baronRem = Math.max(0, nextBaron - gameTime);
    windows.push({
      id: 'baron',
      name: 'Baron Nashor',
      status: baronRem === 0 ? 'live' : baronRem <= 65 ? 'prep_vision' : 'upcoming',
      secondsRemaining: baronRem,
      nextSpawnFormatted: formatClock(nextBaron),
      priority: baronRem <= 65 ? 'critical' : 'high',
      actionText:
        baronRem === 0
          ? 'Baron is LIVE — sweep pit, bait or take after a pick / TP disadvantage.'
          : baronRem <= 65
            ? 'Clear Baron river vision & hold Control Ward + Smite.'
            : 'Keep top-side waves pushed while Baron timer winds down.',
    });
  }

  return windows.sort((a, b) => a.secondsRemaining - b.secondsRemaining);
}

export function assessLiveThreats(
  enemies: LivePlayer[]
): ThreatAssessment {
  let healingSources = 0;
  let apCarryScore = 0;
  let adCarryScore = 0;
  let critUsers = 0;
  let tankCount = 0;
  let heavyCcCount = 0;

  const reasons: string[] = [];

  for (const enemy of enemies) {
    const meta = findMetaByName(enemy.championName, enemy.rawChampionName);
    const kills = enemy.scores.kills;
    const itemIds = new Set(enemy.items.map((i) => i.itemID));

    if (
      meta?.hasHeavyHealing ||
      [...itemIds].some((id) => HEALING_THREAT_ITEM_IDS.has(id))
    ) {
      healingSources += 1;
    }

    if (meta?.damageProfile === 'ap') {
      apCarryScore += 1 + (kills >= 4 ? 1.5 : 0);
    } else if (meta?.damageProfile === 'ad') {
      adCarryScore += 1 + (kills >= 4 ? 1.5 : 0);
    }

    if (
      [...itemIds].some((id) => CRIT_THREAT_ITEM_IDS.has(id)) ||
      meta?.championClass === 'marksman'
    ) {
      critUsers += kills >= 3 ? 2 : 1;
    }

    if (
      meta?.championClass === 'tank' ||
      [...itemIds].some((id) => TANK_THREAT_ITEM_IDS.has(id))
    ) {
      tankCount += 1;
    }

    if ((meta?.hardCcScore ?? 0) >= 7) {
      heavyCcCount += 1;
    }
  }

  const healingThreat = healingSources >= 2;
  const apThreat = apCarryScore >= 3;
  const adThreat = adCarryScore >= 3;
  const critThreat = critUsers >= 3;
  const tankThreat = tankCount >= 2;
  const ccThreat = heavyCcCount >= 2;

  if (healingThreat) reasons.push('Multiple heavy-healing enemies detected -> Anti-Heal value high');
  if (apThreat) reasons.push('High/fed enemy AP damage -> Prioritize Magic Resist');
  if (adThreat) reasons.push('High/fed enemy AD damage -> Prioritize Armor / Anti-Burst');
  if (critThreat) reasons.push('Fed Crit threats -> Randuin’s Omen / Plated Steelcaps value');
  if (tankThreat) reasons.push('2+ frontline tanks -> Percent Armor/Magic Pen needed');
  if (ccThreat) reasons.push('Heavy hard CC -> Mercury’s Treads / Tenacity recommended');

  if (reasons.length === 0) {
    reasons.push('Balanced enemy threat profile -> Follow optimal core scaling path');
  }

  return {
    healingThreat,
    apThreat,
    adThreat,
    critThreat,
    tankThreat,
    ccThreat,
    reasons,
  };
}

function makeRecommendation(
  itemId: number,
  reason: string,
  currentGold: number
): ItemRecommendation | null {
  const item = resolveItemMetadata(itemId);
  if (!item) return null;
  const affordableComponents = (item.buildsFromIds ?? [])
    .map((id) => resolveItemMetadata(id))
    .filter(
      (comp): comp is ItemMetadata => comp !== undefined && comp.cost <= currentGold
    );

  return {
    item,
    reason,
    affordableNow: currentGold >= item.cost,
    goldNeeded: Math.max(0, item.cost - currentGold),
    affordableComponents,
  };
}

export function computeAdaptiveBuild(
  liveData: LiveGameData,
  profileOverride?: JungleChampionProfile
): AdaptiveBuildPlan {
  const selfPlayer = resolveSelfPlayer(liveData);

  const profile =
    profileOverride ??
    (selfPlayer
      ? findJungleChampionByName(selfPlayer.championName) ??
        (selfPlayer.rawChampionName
          ? findJungleChampionByName(
              selfPlayer.rawChampionName.replace(/^game_character_displayname_/i, '')
            )
          : undefined)
      : undefined);

  const enemies = selfPlayer
    ? liveData.allPlayers.filter((p) => p.team !== selfPlayer.team)
    : [];
  const threats = assessLiveThreats(enemies);

  const nonTrinketItems = getNonTrinketItems(selfPlayer?.items);
  const ownedIds = new Set(nonTrinketItems.map((i) => i.itemID));
  const ownedTrinketId = (selfPlayer?.items ?? []).find((i) => i.slot === 6)?.itemID;
  const currentGold = Math.floor(liveData.activePlayer.currentGold);
  const gameTime = liveData.gameData.gameTime;

  const isAp = profile?.damageProfile === 'ap';
  const isTank = profile?.damageProfile === 'tank';

  // Count completed non-boot, non-consumable items (~>= 2400g)
  const completedMajorItems = nonTrinketItems.filter(
    (item) =>
      item.price >= 2400 &&
      !isBootItem(item) &&
      !ITEM_CATALOG[item.itemID]?.tags.includes('boots')
  ).length;
  const ownedBoots =
    findOwnedBootItem(selfPlayer?.items) ??
    nonTrinketItems.find((item) => ITEM_CATALOG[item.itemID]?.tags.includes('boots'));
  const ownsCompletedBoots =
    hasCompletedBoots(selfPlayer?.items) ||
    nonTrinketItems.some(
      (item) => ITEM_CATALOG[item.itemID]?.tags.includes('boots') && item.itemID !== 1001 && item.itemID !== 2422
    );
  const occupiedSlots = nonTrinketItems.length;
  const isFullBuild =
    completedMajorItems >= 5 && (occupiedSlots >= 6 || Boolean(ownedBoots));

  // Build adaptive candidate queue
  const queueIds: Array<{ id: number; reason: string }> = [];

  if (profile) {
    // Core items first
    for (const coreId of profile.coreItemIds) {
      if (!ownedIds.has(coreId)) {
        queueIds.push({
          id: coreId,
          reason: ITEM_CATALOG[coreId]?.shortReason ?? 'Core jungle spike',
        });
      }
    }

    // Boot choice reacts to threats
    if (!ownsCompletedBoots) {
      let bootId = profile.bootItemId;
      let bootReason = 'Recommended mobility & spike boots';
      if (threats.ccThreat || threats.apThreat) {
        bootId = 3111;
        bootReason = 'Enemy heavy CC / AP -> Mercury’s Treads for Tenacity & MR';
      } else if (threats.adThreat || threats.critThreat) {
        bootId = 3047;
        bootReason = 'Fed AD / Auto-attackers -> Plated Steelcaps';
      }
      queueIds.splice(1, 0, { id: bootId, reason: bootReason });
    }
  }

  // Threat-reactive situational injections
  const hasAntiHeal = [...ownedIds].some((id) => ANTI_HEAL_ITEM_IDS.has(id));
  if (threats.healingThreat && !hasAntiHeal) {
    const antiHealId = isTank ? 3075 : isAp ? 3165 : 6609;
    queueIds.unshift({
      id: antiHealId,
      reason: 'Reactive pivot: Enemy comp has heavy healing/sustain',
    });
  }

  const hasMr = [...ownedIds].some((id) => MR_ITEM_IDS.has(id));
  if (threats.apThreat && !hasMr) {
    const mrId = isTank ? 2504 : isAp ? 3102 : 3156;
    queueIds.push({
      id: mrId,
      reason: 'Reactive pivot: Enemy AP carries are fed',
    });
  }

  const hasArmor = [...ownedIds].some((id) => ARMOR_ITEM_IDS.has(id));
  if ((threats.adThreat || threats.critThreat) && !hasArmor) {
    const armorId = threats.critThreat || isTank ? 3143 : isAp ? 3157 : 6333;
    queueIds.push({
      id: armorId,
      reason: threats.critThreat
        ? 'Reactive pivot: Reduce fed enemy Crit damage'
        : 'Reactive pivot: Survive fed AD burst',
    });
  }

  const hasPen = [...ownedIds].some((id) => PEN_ITEM_IDS.has(id));
  if (threats.tankThreat && !hasPen) {
    const penId = isAp ? 3135 : 3071;
    queueIds.push({
      id: penId,
      reason: 'Reactive pivot: Shred stacking enemy armor/MR tanks',
    });
  }

  if (profile) {
    for (const sitId of profile.situationalItemIds) {
      if (!ownedIds.has(sitId) && !queueIds.some((q) => q.id === sitId)) {
        queueIds.push({
          id: sitId,
          reason: ITEM_CATALOG[sitId]?.shortReason ?? 'Situational late-game power',
        });
      }
    }
  }

  // Deduplicate & map
  const seen = new Set<number>();
  const recommendations: ItemRecommendation[] = [];
  for (const entry of queueIds) {
    if (seen.has(entry.id) || ownedIds.has(entry.id)) continue;
    seen.add(entry.id);
    const rec = makeRecommendation(entry.id, entry.reason, currentGold);
    if (rec) recommendations.push(rec);
  }

  // Trinket advice
  const oracle = ITEM_CATALOG[3364]!;
  const stealth = ITEM_CATALOG[3340]!;
  const farsight = ITEM_CATALOG[3363]!;

  const selfTeam = selfPlayer?.team;
  const allyKills = liveData.allPlayers
    .filter((p) => p.team === selfTeam)
    .reduce((sum, p) => sum + p.scores.kills, 0);
  const enemyKills = enemies.reduce((sum, p) => sum + p.scores.kills, 0);

  let trinketAdvice = {
    item: stealth,
    reason: 'Keep Stealth Ward for 1:15 tracking & early river protection.',
  };
  if (gameTime >= 260 && ownedTrinketId !== 3364 && !(gameTime > 1500 && enemyKills - allyKills >= 8)) {
    trinketAdvice = {
      item: oracle,
      reason: 'Switch to Oracle Lens to sweep gank bushes and deny Dragon/Baron pit vision.',
    };
  } else if (gameTime > 1500 && enemyKills - allyKills >= 8) {
    trinketAdvice = {
      item: farsight,
      reason: 'Behind late-game: Farsight checks Baron/Elder safely without face-checking.',
    };
  } else if (ownedTrinketId === 3364) {
    trinketAdvice = {
      item: oracle,
      reason: 'Oracle Lens active — sweep before every objective and lane flank.',
    };
  }

  // Consumable advice
  const consumableAdvice: AdaptiveBuildPlan['consumableAdvice'] = [];
  if (gameTime < 450 && occupiedSlots < 6) {
    consumableAdvice.push({
      item: ITEM_CATALOG[2003]!,
      reason: 'Keep HP topped for early river skirmishes.',
    });
  }
  if (occupiedSlots < 6 && currentGold >= 75) {
    consumableAdvice.push({
      item: ITEM_CATALOG[2055]!,
      reason: 'Buy a Control Ward before recalling for Dragon/Grubs/Baron setup.',
    });
  }
  if (isFullBuild || gameTime >= 1800) {
    const elixirId = isTank ? 2138 : isAp ? 2139 : 2140;
    consumableAdvice.push({
      item: ITEM_CATALOG[elixirId]!,
      reason: 'Pop an Elixir before decisive Baron/Elder teamfights.',
    });
  }

  // Full build alternative swaps
  const fullBuildAlternatives: AdaptiveBuildPlan['fullBuildAlternatives'] = [];
  if (isFullBuild) {
    if (ownedBoots) {
      const bootSwapId = profile?.fullBuildBootReplacementId ?? 3742;
      const bootSwap = ITEM_CATALOG[bootSwapId] ?? ITEM_CATALOG[3742]!;
      fullBuildAlternatives.push({
        replaceTarget: ownedBoots.displayName,
        recommendedItem: bootSwap,
        reason:
          'At 6 items + excess gold: swap Boots for a Move-Speed + combat legendary item.',
      });
    }
    if (ownedIds.has(3026)) {
      const swapTarget = threats.apThreat ? ITEM_CATALOG[3156]! : ITEM_CATALOG[3053]!;
      fullBuildAlternatives.push({
        replaceTarget: 'Guardian Angel (if on 5m cooldown)',
        recommendedItem: swapTarget,
        reason: 'While GA revive is on cooldown, swap to a defensive shield item for the final fight.',
      });
    } else if (!ownedIds.has(3026) && !isAp && !isTank) {
      fullBuildAlternatives.push({
        replaceTarget: 'Lowest-impact situational item',
        recommendedItem: ITEM_CATALOG[3026]!,
        reason: 'Consider Guardian Angel for game-deciding Elder/Baron teamfights.',
      });
    }
  }

  return {
    threats,
    nextItem: recommendations[0] ?? null,
    upcomingQueue: recommendations.slice(1, 4),
    trinketAdvice,
    consumableAdvice,
    isFullBuild,
    fullBuildAlternatives,
  };
}

/**
 * Evaluates up to 2 capped personalized live guardrails strictly from public
 * Live Client scoreboard metrics paired with Confirmed personal EWM weaknesses.
 */
export function computePersonalizedLiveGuardrails(
  ctx: PersonalLiveGuardrailContext,
  maxGuardrails = 2
): MacroCue[] {
  const learning = ctx.personalLearning;
  const cap = Math.max(0, Math.min(2, maxGuardrails));
  if (!learning || cap <= 0) return [];
  const confirmedSet = new Set(
    learning.signatures.filter((s) => s.status === 'confirmed').map((s) => s.detectorId)
  );
  if (confirmedSet.size === 0) return [];

  const guardrails: MacroCue[] = [];
  const nextObj = ctx.objectives.find((o) => o.secondsRemaining > 0);

  if (
    confirmedSet.has('pre_obj_death') &&
    nextObj &&
    nextObj.secondsRemaining <= 90
  ) {
    const secs = Math.round(nextObj.secondsRemaining);
    guardrails.push({
      id: 'personal-pre-obj-guard',
      category: 'objective',
      priority: 'urgent',
      source: 'personal_guardrail',
      title: `Guardrail: Hold flash/position before ${nextObj.name} (${secs}s)`,
      detail: `Confirmed pre-objective death pattern (${learning.baselines.preObjectiveDeaths.shrunkBaseline}/g EWM). Reset early with Support before entering fog.`,
    });
  }

  if (confirmedSet.has('blind_river_vision') && ctx.gameTime >= 420) {
    const wardPerMin = ctx.wardScore / Math.max(1, ctx.gameTime / 60);
    if (wardPerMin < 0.75) {
      guardrails.push({
        id: 'personal-vision-guard',
        category: 'vision',
        priority: 'high',
        source: 'personal_guardrail',
        title: `Guardrail: River setup behind (${wardPerMin.toFixed(2)} ward/min)`,
        detail:
          'Confirmed blind-river leak: pick up 1 Control Ward on base and sweep pit approach first.',
      });
    }
  }

  if (confirmedSet.has('midgame_farm_drop') && ctx.gameTime >= 600) {
    const csPerMin = ctx.creepScore / Math.max(1, ctx.gameTime / 60);
    const farmFloor = Math.max(5.7, learning.baselines.csPerMin.priorTarget - 0.5);
    if (csPerMin < farmFloor) {
      guardrails.push({
        id: 'personal-farm-guard',
        category: 'clear',
        priority: 'normal',
        source: 'personal_guardrail',
        title: `Guardrail: Rebuild camp tempo (${csPerMin.toFixed(1)} CS/min)`,
        detail:
          'Confirmed mid-game farm drop: cycle spawned quadrant camps before shadowing even skirmishes.',
      });
    }
  }

  return guardrails.slice(0, cap);
}

export function computeMacroGuidance(
  liveData: LiveGameData,
  winPlan: WinConditionPlan | null,
  objectives: ObjectiveWindow[],
  personalLearning?: PersonalLearningSnapshot | null
): MacroCue[] {
  const gameTime = liveData.gameData.gameTime;
  const selfPlayer = resolveSelfPlayer(liveData);
  const currentGold = Math.floor(liveData.activePlayer.currentGold);
  const cues: MacroCue[] = [];

  // 1. Objective & Vision cue
  const topObjective = objectives[0];
  if (topObjective && (topObjective.status === 'prep_vision' || topObjective.status === 'live')) {
    const secs = Math.max(0, Math.round(topObjective.secondsRemaining));
    cues.push({
      id: 'obj-setup',
      category: 'objective',
      priority: 'urgent',
      source: 'standard',
      title: `${topObjective.name} (${topObjective.status === 'live' ? 'LIVE' : `in ${secs}s`})`,
      detail: topObjective.actionText,
    });
  }

  // 2. Recall / Tempo / Clear cue
  if (currentGold >= 1300 && topObjective && topObjective.secondsRemaining > 35) {
    cues.push({
      id: 'recall-spike',
      category: 'clear',
      priority: 'high',
      source: 'standard',
      title: `Spend ${currentGold}g before next objective`,
      detail: 'Clear remaining quadrant camps -> Reset & spend gold so you arrive at full strength.',
    });
  } else if (gameTime < 190) {
    cues.push({
      id: 'first-clear',
      category: 'clear',
      priority: 'high',
      source: 'standard',
      title: winPlan
        ? `Execute ${winPlan.strongSide.toUpperCase()} pathing tempo`
        : 'Execute disciplined opening clear',
      detail: 'Do not force low-percentage ganks before finishing your quadrant; keep Smite for 2:55 Scuttle.',
    });
  } else {
    cues.push({
      id: 'camp-sequencing',
      category: 'clear',
      priority: 'normal',
      source: 'standard',
      title: 'Sequence camps toward strong side',
      detail: winPlan
        ? `Clear camps from ${winPlan.weakSide.toUpperCase()} -> ${winPlan.strongSide.toUpperCase()} so you are naturally positioned for ganks & objectives.`
        : 'Clear toward your next spawning neutral objective so you arrive with spent gold and camp tempo.',
    });
  }

  // 3. Gank / Invade / Lane Push cue
  if (gameTime >= 200 && gameTime < 900) {
    cues.push({
      id: 'gank-push',
      category: 'gank',
      priority: 'high',
      source: 'standard',
      title: winPlan
        ? `Play around ${winPlan.strongSide.toUpperCase()} lane & tower plates`
        : 'Convert ganks into wave shove & tower plates',
      detail:
        'After a successful gank or enemy recall, help shove the wave into tower for plates & tempo before resetting.',
    });
  } else if (gameTime >= 900) {
    cues.push({
      id: 'cross-map',
      category: 'invade',
      priority: 'normal',
      source: 'standard',
      title: 'Cross-map trade & deep vision',
      detail:
        'Whenever enemy jungler shows on the opposite side of the map, immediately take their quadrant camps or push opposite lane/objective.',
    });
  }

  // 4. Vision control cue
  const wardScorePerMin =
    gameTime > 60 && selfPlayer ? (selfPlayer.scores.wardScore / (gameTime / 60)).toFixed(1) : '0.0';
  cues.push({
    id: 'vision-habit',
    category: 'vision',
    priority: Number(wardScorePerMin) < 0.8 && gameTime > 360 ? 'high' : 'normal',
    source: 'standard',
    title: `Vision Control (${wardScorePerMin} ward score/min)`,
    detail:
      'Place Control Wards in river/pit entrances 45s prior to Dragon/Baron; use Oracle Lens when entering enemy jungle.',
  });

  // 5. Push lanes reminder late
  if (gameTime >= 1100) {
    cues.push({
      id: 'wave-before-obj',
      category: 'push',
      priority: 'normal',
      source: 'standard',
      title: 'Push side & mid waves before grouping',
      detail: 'Push mid/side waves past river first so enemies lose CS & cannot contest Baron/Dragon unseen.',
    });
  }

  // 6. Capped (<= 2) personalized guardrails grounded in confirmed habits + public scoreboard
  if (selfPlayer) {
    const guardrails = computePersonalizedLiveGuardrails(
      {
        gameTime,
        wardScore: selfPlayer.scores.wardScore,
        creepScore: selfPlayer.scores.creepScore,
        objectives,
        personalLearning,
      },
      2
    );
    cues.push(...guardrails);
  }

  return cues;
}

/**
 * Estimates jungle companion / Smite damage progression from live match clock and
 * jungle CS tempo using embedded or hot-swapped signed patch-pack thresholds.
 */
export function computeSmiteProgression(
  liveData: LiveGameData,
  thresholds: SmiteThresholdsConfig = DEFAULT_SMITE_THRESHOLDS
): SmiteTierStatus {
  const selfPlayer = resolveSelfPlayer(liveData);
  const rawCs = selfPlayer?.scores.creepScore ?? 0;
  const rawGameTime = liveData.gameData.gameTime;
  const cs = Number.isFinite(rawCs) ? Math.max(0, rawCs) : 0;
  const mins = Number.isFinite(rawGameTime) ? Math.max(0, rawGameTime / 60) : 0;
  const estimatedTreats = Math.min(
    thresholds.primalStacks,
    Math.floor(cs / 3.6) + Math.floor(mins / 1.5)
  );

  if (estimatedTreats >= thresholds.primalStacks || (mins >= 18 && cs >= 105)) {
    return {
      tierName: 'Primal',
      damage: thresholds.primalDamage,
      estimatedStacksRemaining: 0,
      note: `Primal Smite active (${thresholds.primalDamage} true damage) — pair burst spells cleanly at ${thresholds.primalDamage} HP.`,
    };
  }
  if (estimatedTreats >= thresholds.unleashedStacks || (mins >= 10 && cs >= 55)) {
    const remaining = Math.max(1, thresholds.primalStacks - estimatedTreats);
    return {
      tierName: 'Unleashed',
      damage: thresholds.unleashedDamage,
      estimatedStacksRemaining: remaining,
      note: `~${remaining} companion treats left until ${thresholds.primalDamage} Primal Smite.`,
    };
  }
  const remaining = Math.max(1, thresholds.unleashedStacks - estimatedTreats);
  return {
    tierName: 'Base',
    damage: thresholds.baseDamage,
    estimatedStacksRemaining: remaining,
    note: `Keep cycling camps (~${remaining} treats left for ${thresholds.unleashedDamage} Unleashed Smite).`,
  };
}
