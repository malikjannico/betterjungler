import {
  CHAMPION_META_TABLE,
  ITEM_CATALOG,
  findJungleChampionByName,
  resolveItemMetadata,
} from '../data/jungleKnowledgePack';
import type {
  AdaptiveBuildPlan,
  ChampionMetaEntry,
  ItemMetadata,
  ItemRecommendation,
  JungleChampionProfile,
  MacroCue,
  ObjectiveWindow,
  SmiteTierStatus,
  ThreatAssessment,
  WinConditionPlan,
} from '../types/coaching';
import type { LiveGameData, LivePlayer } from '../types/riot';

const ANTI_HEAL_ITEM_IDS = new Set([3123, 3916, 3076, 3075, 6609, 3165]);
const MR_ITEM_IDS = new Set([3111, 3155, 3156, 2504, 3001, 6664, 3102]);
const ARMOR_ITEM_IDS = new Set([3047, 3068, 3075, 3143, 3110, 6333, 3157, 3026, 3742]);
const PEN_ITEM_IDS = new Set([3071, 3153, 6694, 3036, 3135, 6653]);

// Locale-independent enemy threat item ID sets (Riot official item IDs)
const HEALING_THREAT_ITEM_IDS = new Set([3072, 6610, 6692, 4633, 6617, 3153, 3074, 6630]);
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
  allPlayers?: LivePlayer[]
): ObjectiveWindow[] {
  const windows: ObjectiveWindow[] = [];

  // 1. Scuttle Crab (initial 3:30 = 210s)
  if (gameTime < 240) {
    const remaining = Math.max(0, 210 - gameTime);
    windows.push({
      id: 'scuttle',
      name: 'Rift Scuttler',
      status: remaining === 0 ? 'live' : remaining <= 30 ? 'prep_vision' : 'upcoming',
      secondsRemaining: remaining,
      nextSpawnFormatted: formatClock(210),
      priority: remaining <= 30 ? 'high' : 'medium',
      actionText:
        remaining === 0
          ? 'Scuttle is LIVE — contest with lane priority or trade opposite crab.'
          : 'Finish clear with 1 Smite charge saved for 3:30 Scuttle.',
    });
  }

  // 2. Dragon (first 5:00 = 300s, Elemental respawn 5:00 = 300s, Elder respawn 6:00 = 360s)
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
    lastDragonKill?.DragonType?.toLowerCase() === 'elder' || isElderCandidate ? 360 : 300;
  const nextDragonSpawn = lastDragonKill !== null ? lastDragonKill.EventTime + dragonRespawnSec : 300;
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

  // 2b. Atakhan (20:00 = 1200s until slain)
  const atakhanKills = events.filter((e) => e.EventName === 'AtakhanKill');
  if (gameTime >= 1020 && atakhanKills.length === 0) {
    const atakhanRem = Math.max(0, 1200 - gameTime);
    windows.push({
      id: 'atakhan',
      name: 'Atakhan',
      status: atakhanRem === 0 ? 'live' : atakhanRem <= 60 ? 'prep_vision' : 'upcoming',
      secondsRemaining: atakhanRem,
      nextSpawnFormatted: formatClock(1200),
      priority: atakhanRem <= 60 ? 'critical' : 'high',
      actionText:
        atakhanRem === 0
          ? 'Atakhan is LIVE — clear side waves & secure river vision before starting.'
          : 'Prepare side-river Control Ward ahead of 20:00 Atakhan spawn.',
    });
  }

  // 3. Voidgrubs (6:00 = 360s) / Rift Herald (14:00–24:45 = 840..1485s) / Baron (25:00 = 1500s)
  const voidgrubKills = events.filter((e) => e.EventName === 'HordeKill');
  const heraldKills = events.filter((e) => e.EventName === 'HeraldKill');
  const baronKills = events.filter((e) => e.EventName === 'BaronKill');

  if (gameTime < 840) {
    const grubsSpawn = 360;
    const grubRem = Math.max(0, grubsSpawn - gameTime);
    if (gameTime < 660 && voidgrubKills.length < 3) {
      windows.push({
        id: 'voidgrubs',
        name: 'Voidgrubs',
        status: grubRem === 0 ? 'live' : grubRem <= 50 ? 'prep_vision' : 'upcoming',
        secondsRemaining: grubRem,
        nextSpawnFormatted: formatClock(grubsSpawn),
        priority: grubRem <= 50 ? 'high' : 'medium',
        actionText:
          grubRem === 0
            ? 'Voidgrubs LIVE — secure at least 3+ grubs for turret siege plates.'
            : 'Path top-side with top/mid prio before 6:00.',
      });
    } else {
      const heraldRem = Math.max(0, 840 - gameTime);
      windows.push({
        id: 'herald',
        name: 'Rift Herald',
        status: heraldRem <= 60 ? 'prep_vision' : 'upcoming',
        secondsRemaining: heraldRem,
        nextSpawnFormatted: formatClock(840),
        priority: heraldRem <= 60 ? 'high' : 'medium',
        actionText: 'Prepare Top river vision for 14:00 Rift Herald spawn.',
      });
    }
  } else if (gameTime < 1485 && heraldKills.length === 0) {
    windows.push({
      id: 'herald',
      name: 'Rift Herald',
      status: 'live',
      secondsRemaining: 0,
      nextSpawnFormatted: formatClock(840),
      priority: 'high',
      actionText: 'Rift Herald LIVE (despawns 24:45) — use to crack Mid Tier-1 turret.',
    });
  } else {
    const lastBaron =
      baronKills.length > 0 ? Math.max(...baronKills.map((e) => e.EventTime)) : null;
    const nextBaron = lastBaron !== null ? Math.max(1500, lastBaron + 360) : 1500;
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

  const ownedIds = new Set(
    (selfPlayer?.items ?? []).filter((i) => i.slot < 6).map((i) => i.itemID)
  );
  const ownedTrinketId = (selfPlayer?.items ?? []).find((i) => i.slot === 6)?.itemID;
  const currentGold = Math.floor(liveData.activePlayer.currentGold);
  const gameTime = liveData.gameData.gameTime;

  const isAp = profile?.damageProfile === 'ap';
  const isTank = profile?.damageProfile === 'tank';

  // Count completed non-boot, non-consumable items (~>= 2400g)
  const completedMajorItems = (selfPlayer?.items ?? []).filter(
    (item) =>
      item.slot < 6 &&
      item.price >= 2400 &&
      !ITEM_CATALOG[item.itemID]?.tags.includes('boots')
  ).length;
  const ownedBoots = (selfPlayer?.items ?? []).find(
    (item) => item.slot < 6 && ITEM_CATALOG[item.itemID]?.tags.includes('boots')
  );
  const occupiedSlots = (selfPlayer?.items ?? []).filter((i) => i.slot < 6).length;
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
    if (!ownedBoots) {
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

export function computeMacroGuidance(
  liveData: LiveGameData,
  winPlan: WinConditionPlan,
  objectives: ObjectiveWindow[]
): MacroCue[] {
  const gameTime = liveData.gameData.gameTime;
  const selfPlayer = resolveSelfPlayer(liveData);
  const currentGold = Math.floor(liveData.activePlayer.currentGold);
  const cues: MacroCue[] = [];

  // 1. Objective & Vision cue
  const topObjective = objectives[0];
  if (topObjective && (topObjective.status === 'prep_vision' || topObjective.status === 'live')) {
    cues.push({
      id: 'obj-setup',
      category: 'objective',
      priority: 'urgent',
      title: `${topObjective.name} (${topObjective.status === 'live' ? 'LIVE' : `in ${topObjective.secondsRemaining}s`})`,
      detail: topObjective.actionText,
    });
  }

  // 2. Recall / Tempo / Clear cue
  if (currentGold >= 1300 && topObjective && topObjective.secondsRemaining > 35) {
    cues.push({
      id: 'recall-spike',
      category: 'clear',
      priority: 'high',
      title: `Spend ${currentGold}g before next objective`,
      detail: 'Clear remaining quadrant camps -> Reset & spend gold so you arrive at full strength.',
    });
  } else if (gameTime < 225) {
    cues.push({
      id: 'first-clear',
      category: 'clear',
      priority: 'high',
      title: `Execute ${winPlan.strongSide.toUpperCase()} pathing tempo`,
      detail: 'Do not force low-percentage ganks before finishing your quadrant; keep Smite for 3:30 Scuttle.',
    });
  } else {
    cues.push({
      id: 'camp-sequencing',
      category: 'clear',
      priority: 'normal',
      title: 'Sequence camps toward strong side',
      detail: `Clear camps from ${winPlan.weakSide.toUpperCase()} -> ${winPlan.strongSide.toUpperCase()} so you are naturally positioned for ganks & objectives.`,
    });
  }

  // 3. Gank / Invade / Lane Push cue
  if (gameTime >= 200 && gameTime < 900) {
    cues.push({
      id: 'gank-push',
      category: 'gank',
      priority: 'high',
      title: `Play around ${winPlan.strongSide.toUpperCase()} lane & tower plates`,
      detail:
        'After a successful gank or enemy recall, help shove the wave into tower for plates & tempo before resetting.',
    });
  } else if (gameTime >= 900) {
    cues.push({
      id: 'cross-map',
      category: 'invade',
      priority: 'normal',
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
      title: 'Push side & mid waves before grouping',
      detail: 'Push mid/side waves past river first so enemies lose CS & cannot contest Baron/Dragon unseen.',
    });
  }

  return cues;
}

/**
 * Estimates jungle companion / Smite damage progression (600 -> 900 -> 1200)
 * from live match clock and jungle CS tempo.
 */
export function computeSmiteProgression(liveData: LiveGameData): SmiteTierStatus {
  const selfPlayer = resolveSelfPlayer(liveData);
  const rawCs = selfPlayer?.scores.creepScore ?? 0;
  const rawGameTime = liveData.gameData.gameTime;
  const cs = Number.isFinite(rawCs) ? Math.max(0, rawCs) : 0;
  const mins = Number.isFinite(rawGameTime) ? Math.max(0, rawGameTime / 60) : 0;
  const estimatedTreats = Math.min(
    40,
    Math.floor(cs / 3.6) + Math.floor(mins / 1.5)
  );

  if (estimatedTreats >= 40 || (mins >= 18 && cs >= 105)) {
    return {
      tierName: 'Primal',
      damage: 1200,
      estimatedStacksRemaining: 0,
      note: 'Primal Smite active (1200 true damage) — pair burst spells cleanly at 1200 HP.',
    };
  }
  if (estimatedTreats >= 20 || (mins >= 10 && cs >= 55)) {
    const remaining = Math.max(1, 40 - estimatedTreats);
    return {
      tierName: 'Unleashed',
      damage: 900,
      estimatedStacksRemaining: remaining,
      note: `~${remaining} companion treats left until 1200 Primal Smite.`,
    };
  }
  const remaining = Math.max(1, 20 - estimatedTreats);
  return {
    tierName: 'Base',
    damage: 600,
    estimatedStacksRemaining: remaining,
    note: `Keep cycling camps (~${remaining} treats left for 900 Unleashed Smite).`,
  };
}
