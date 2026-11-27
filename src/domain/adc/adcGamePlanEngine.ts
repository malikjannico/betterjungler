/**
 * ADC Win Plan engine — parallel to `winConditionEngine.ts` (Jungle), never imported by it.
 *
 * Read-only reuse only: the Jungle knowledge pack classifies non-bot champions (enemy jungler,
 * solo lanes) and the ADC draft engine supplies 2v2 matchup / support synergy scoring. Neither
 * Jungle module is modified, so Jungle plans stay byte-identical.
 */
import {
  findAdcChampionById,
  SUPPORT_ARCHETYPES,
  type AdcChampionProfile,
} from '../../data/adcKnowledgePack';
import { findJungleChampionById, getChampionMeta } from '../../data/jungleKnowledgePack';
import { computeBotMatchup, computeSupportSynergy, inferEnemyBotLane } from './adcDraftEngine';
import type { WardSpot } from '../../types/coaching';
import type { LaneRole, MapSide } from '../../types/riot';
import type {
  AdcBotMatchupSummary,
  AdcJunglerThreatTiming,
  AdcMatchupVerdict,
  AdcSupportSynergyPlaybook,
  AdcWavePlan,
  AdcWinConditionPlan,
  MacroPhasePlan,
  SupportArchetype,
} from './types';

// ---------------------------------------------------------------------------
// Season 2026 timings (seconds)
// ---------------------------------------------------------------------------

export const ADC_TIMINGS = {
  minionSpawnSec: 30,
  earlyGankWindowStartSec: 135, // 2:15
  scuttleSpawnSec: 175, // 2:55
  fullClearBotArrivalSec: 165, // 2:45
  firstDragonSec: 300, // 5:00
  laningPhaseEndSec: 270, // 4:30
  plateFallSec: 840, // 14:00
  baronSpawnSec: 1200, // 20:00
} as const;

export interface AdcGamePlanInput {
  allyRoles: Partial<Record<LaneRole, number>>;
  enemyRoles: Partial<Record<LaneRole, number>>;
  playerChampionId: number;
  mapSide: MapSide;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// ---------------------------------------------------------------------------
// Ward spots
// ---------------------------------------------------------------------------

/**
 * Calibrated Bot-lane ward spots in official Summoner's Rift (`map11.png`) SVG space [0..1000]
 * (top-left origin, Blue base bottom-left [~100,900], Red base top-right [~900,100]).
 */
export function buildAdcWardSpots(side: MapSide): WardSpot[] {
  const isBlue = side === 'blue';
  if (isBlue) {
    return [
      {
        id: 'adc-river-brush',
        label: 'Bot River Entrance Brush',
        kind: 'stealth',
        phase: 'early',
        x: 742,
        y: 762,
        timing: '2:15 – 2:30 (pre-Level 3 gank)',
        reason:
          'Spots river ganks and early jungler flanks before the 2:30–2:55 Scuttle window without overextending.',
      },
      {
        id: 'adc-tri-brush',
        label: 'Blue Bot Tri-Brush (Dive Flank)',
        kind: 'control',
        phase: 'objective',
        x: 702,
        y: 822,
        timing: 'First reset (~4:30) with Control Ward',
        reason:
          'Secures your tower flank against 3-man dives through your bot jungle when pushing or freezing.',
      },
      {
        id: 'adc-dragon-pixel',
        label: 'Dragon River Pixel Brush',
        kind: 'stealth',
        phase: 'objective',
        x: 622,
        y: 658,
        timing: '4:15 (45s before 5:00 Dragon)',
        reason:
          'Tracks mid roams and enemy jungler rotations ahead of first Dragon setup; let Support ward deeper if uncontested.',
      },
      {
        id: 'adc-mid-swap-pink',
        label: 'Bot-Mid River Side Brush (Mid Swap)',
        kind: 'control',
        phase: 'mid_late',
        x: 445,
        y: 562,
        timing: '14:00+ after Bot → Mid swap',
        reason:
          'Anchors one side of mid lane so you can clear waves safely and shadow jungle hovers after swapping Mid.',
      },
    ];
  }

  return [
    {
      id: 'adc-tri-brush',
      label: 'Red Bot Tri-Brush (Mandatory Flank)',
      kind: 'stealth',
      phase: 'early',
      x: 822,
      y: 668,
      timing: '2:15 – 2:30 (pre-Level 3 gank)',
      reason:
        'Mandatory Red-side ward: covers blast-cone and tri-brush dives behind your turret before Scuttle.',
    },
    {
      id: 'adc-river-brush',
      label: 'Bot River Entrance Brush',
      kind: 'stealth',
      phase: 'early',
      x: 742,
      y: 762,
      timing: '2:45+ when pushing wave',
      reason:
        'Covers river approach when your duo holds wave priority past the midpoint of bot lane.',
    },
    {
      id: 'adc-dragon-pixel',
      label: 'Dragon Pit / Pixel Brush',
      kind: 'control',
      phase: 'objective',
      x: 622,
      y: 658,
      timing: '4:15 (45s before 5:00 Dragon)',
      reason:
        'Denies pit vision before first Dragon contest and spots mid-lane river rotations early.',
    },
    {
      id: 'adc-mid-swap-pink',
      label: 'Top-Mid River Side Brush (Mid Swap)',
      kind: 'control',
      phase: 'mid_late',
      x: 555,
      y: 438,
      timing: '14:00+ after Bot → Mid swap',
      reason:
        'Covers the top-mid river flank toward Herald/Baron while farming mid waves safely.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function championName(id: number | undefined, fallback: string): string {
  if (!id) return fallback;
  return (
    findAdcChampionById(id)?.name ??
    SUPPORT_ARCHETYPES[id]?.name ??
    findJungleChampionById(id)?.name ??
    getChampionMeta(id).name
  );
}

/** Level-2 strength proxy for supports by archetype (1..10). */
const SUPPORT_LEVEL2: Record<SupportArchetype, number> = {
  engage: 8,
  catcher: 7,
  poke: 5,
  enchanter: 4,
};

function supportLevel2(id: number | undefined): number {
  const support = id ? SUPPORT_ARCHETYPES[id] : undefined;
  return support ? SUPPORT_LEVEL2[support.archetype] : 5;
}

/** How attractive a lane is to gank / play through from a jungler's POV (mirrors Jungle heuristic). */
function lanePlayability(allyId: number | undefined, enemyId: number | undefined): number {
  let score = 0;
  if (allyId) {
    const ally = getChampionMeta(allyId);
    score += ally.hardCcScore * 0.8 + ally.engageScore * 0.4;
    if (ally.volatileLane) score += 4;
  }
  if (enemyId) {
    const enemy = getChampionMeta(enemyId);
    if (enemy.volatileLane) score += 3;
    if (enemy.frontlineScore <= 3 && enemy.hardCcScore <= 3) score += 2;
  }
  return score;
}

function fallbackProfile(championId: number): AdcChampionProfile {
  // Unknown / off-meta bot laner: neutral defaults so the plan still renders.
  const name = championName(championId, 'Your ADC');
  return {
    championId,
    key: name.replace(/[^A-Za-z0-9]/g, ''),
    name,
    metaTier: 'B',
    metaScore: 75,
    archetype: 'utility',
    rangeTier: 'medium',
    level2Strength: 5,
    damageProfile: 'ad',
    scalingProfile: 'mid',
    preferredSupports: ['enchanter', 'engage'],
    strongIntoIds: [],
    weakIntoIds: [],
    synergizesWithIds: [],
    recommendedSpells: [7, 4],
    recommendedRunes: {
      name: `BetterJungler ADC: ${name}`,
      primaryStyleId: 8000,
      subStyleId: 8200,
      selectedPerkIds: [8008, 8009, 9104, 8014, 8226, 8236, 5005, 5008, 5001],
      summaryLabels: [],
    },
    coreItemIds: [3032, 3031],
    situationalItemIds: [3036, 3033, 3072, 3026, 6673, 3139],
    bootItemId: 3006,
  };
}

// ---------------------------------------------------------------------------
// Plan sections
// ---------------------------------------------------------------------------

function buildBotMatchupSummary(
  adc: AdcChampionProfile,
  input: AdcGamePlanInput,
  enemyIds: number[]
): AdcBotMatchupSummary {
  const enemyBotLane = inferEnemyBotLane(enemyIds, {
    explicit: { adcId: input.enemyRoles.bottom, supportId: input.enemyRoles.utility },
    isRankedSoloDuo: true,
  });
  const matchup = enemyBotLane ? computeBotMatchup(adc, enemyBotLane) : null;

  const enemyAdc = enemyBotLane?.adcId ? findAdcChampionById(enemyBotLane.adcId) : undefined;
  const allyLv2 = adc.level2Strength + supportLevel2(input.allyRoles.utility);
  const enemyLv2 = (enemyAdc?.level2Strength ?? 5) + supportLevel2(enemyBotLane?.supportId);
  const level2Delta = allyLv2 - enemyLv2;

  let verdict: AdcMatchupVerdict = 'unknown';
  if (matchup) {
    verdict = matchup.points >= 13 ? 'favored' : matchup.points <= 7 ? 'unfavored' : 'even';
  }

  const allySup = championName(input.allyRoles.utility, 'your Support');
  const duo = enemyBotLane?.label ?? 'Enemy bot lane unknown';
  const verdictText: Record<AdcMatchupVerdict, string> = {
    favored: 'You are favored 2v2 — play for lane priority and trade on enemy cooldown windows.',
    even: 'Skill matchup — win it through wave control and jungle tracking, not coinflip all-ins.',
    unfavored: 'Unfavored 2v2 — farm safely, trade only with your jungler nearby, and scale.',
    unknown: 'Matchup unclear — play the first wave cautiously and read their level-2 intent.',
  };
  const notes = matchup?.notes.length ? ` ${matchup.notes.join('; ')}.` : '';

  return {
    enemyBotLane,
    matchup,
    verdict,
    level2Delta,
    summary: `${adc.name} + ${allySup} vs ${duo}. ${verdictText[verdict]}${notes}`,
  };
}

const SUPPORT_PLAYBOOKS: Record<SupportArchetype, string> = {
  engage:
    'Engage support: hold the wave near the middle, let them start on the enemy ADC and follow instantly with full DPS — do not auto the wave while they engage.',
  catcher:
    'Catcher support: stand behind minions so hooks/bindings have angles; walk up the moment a pick lands and keep the enemy support from blocking it.',
  enchanter:
    'Enchanter support: you are the damage — trade auto-for-auto with their shields/heals up and punish the enemy when their cooldowns are spent.',
  poke:
    'Poke support: chip the enemy duo below 60% with long-range trades, then threaten all-ins; avoid long fights where their sustain out-trades you.',
};

function buildSupportPlaybook(
  adc: AdcChampionProfile,
  supportId: number | undefined
): AdcSupportSynergyPlaybook {
  const synergy = supportId ? computeSupportSynergy(adc, supportId) : null;
  if (!synergy) {
    return {
      synergy: null,
      supportName: supportId ? championName(supportId, 'Support') : null,
      supportArchetype: null,
      playbook:
        'No standard support detected — play range-safe, farm under pressure, and ping your jungler before every trade.',
      allInWindows: ['Level 6 with your jungler nearby'],
    };
  }

  const windows: string[] = [];
  if (synergy.supportArchetype === 'engage' || synergy.supportArchetype === 'catcher') {
    windows.push('Level 2 (1st wave + 3 melees of wave 2)', 'Enemy Flash down', 'Level 6');
  } else {
    windows.push('Enemy support key ability on cooldown', 'Level 6', 'First completed item');
  }

  const combo = synergy.comboNote ? ` Combo: ${synergy.comboNote}.` : '';
  const fit =
    synergy.affinityRank < 0
      ? ` ${synergy.supportName} isn't a natural fit for ${adc.name} — lean on safe farming over forced plays.`
      : '';

  return {
    synergy,
    supportName: synergy.supportName,
    supportArchetype: synergy.supportArchetype,
    playbook: `${SUPPORT_PLAYBOOKS[synergy.supportArchetype]}${combo}${fit}`,
    allInWindows: windows,
  };
}

function buildWavePlan(adc: AdcChampionProfile, level2Delta: number): AdcWavePlan {
  const level2Rule =
    'Level 2 = full 1st wave (6 minions) + the 3 melee minions of the 2nd wave (minions spawn 0:30).';
  if (level2Delta >= 1) {
    return {
      minionSpawnSec: ADC_TIMINGS.minionSpawnSec,
      level2Rule,
      decision: 'push_lv2_all_in',
      instruction: `Hard-push wave 1 with your Support and auto the 2nd wave's melees: hit Level 2 first and all-in the moment the level-up lands (${adc.name} + Support win the race by ~${level2Delta}).`,
    };
  }
  return {
    minionSpawnSec: ADC_TIMINGS.minionSpawnSec,
    level2Rule,
    decision: 'concede_push_trim',
    instruction:
      'Concede the Level-2 race: last-hit wave 1 outside tower range, step back as their 2nd-wave melees die, and trim the wave until both lanes are Level 3.',
  };
}

function buildJunglerThreat(input: AdcGamePlanInput): AdcJunglerThreatTiming {
  const enemyJgId = input.enemyRoles.jungle;
  const enemyJg = enemyJgId ? findJungleChampionById(enemyJgId) : undefined;
  const enemyJgName = championName(enemyJgId, 'Enemy Jungler');
  const enemyJgMeta = enemyJgId ? getChampionMeta(enemyJgId) : undefined;

  // Enemy strong side from the bot laner's POV: where do the enemy's lanes want their jungler?
  const enemyBotScore =
    lanePlayability(input.enemyRoles.bottom, input.allyRoles.bottom) +
    lanePlayability(input.enemyRoles.utility, input.allyRoles.utility) * 0.9;
  const enemyTopScore = lanePlayability(input.enemyRoles.top, input.allyRoles.top);
  const likelyFirstSide: 'bot' | 'top' = enemyBotScore / 1.9 >= enemyTopScore * 0.9 ? 'bot' : 'top';

  const earlyAggressive =
    enemyJg?.preferredFirstClear === 'three_camp_gank' ||
    (enemyJg?.powerSpike ?? enemyJgMeta?.powerSpike) === 'early';

  if (earlyAggressive && likelyFirstSide === 'bot') {
    return {
      enemyJunglerName: enemyJgName,
      threatLevel: 'high',
      likelyFirstSide,
      dangerWindow: {
        startSec: ADC_TIMINGS.earlyGankWindowStartSec,
        endSec: ADC_TIMINGS.scuttleSpawnSec,
        label: '2:15–2:55 early gank alert',
      },
      safeUntilSec: ADC_TIMINGS.earlyGankWindowStartSec,
      instruction: `${enemyJgName} likely 3-camps toward Bot: have the tri-brush warded by 2:15, don't push past the middle of lane 2:15–2:55, and hold Flash for the Level-3 gank.`,
    };
  }

  return {
    enemyJunglerName: enemyJgName,
    threatLevel: likelyFirstSide === 'bot' ? 'medium' : 'low',
    likelyFirstSide,
    dangerWindow: {
      startSec: ADC_TIMINGS.fullClearBotArrivalSec,
      endSec: ADC_TIMINGS.laningPhaseEndSec,
      label: '2:45+ pathing Bot',
    },
    safeUntilSec: ADC_TIMINGS.fullClearBotArrivalSec,
    instruction:
      likelyFirstSide === 'bot'
        ? `${enemyJgName} likely full-clears into Bot side: trade freely before 2:45, then respect river after Scuttle (2:55) and track their first appearance.`
        : `${enemyJgName} likely starts toward Top: your early lane is a safe window — push for priority, but still respect 2:45+ if they show Bot-side Scuttle.`,
  };
}

function buildMacroPhases(
  adc: AdcChampionProfile,
  wave: AdcWavePlan,
  threat: AdcJunglerThreatTiming,
  dragonPriority: 'high' | 'medium' | 'low'
): MacroPhasePlan[] {
  const lateCarry = adc.scalingProfile === 'late' || adc.archetype === 'hypercarry';
  return [
    {
      id: 'laning_lv2',
      order: 1,
      label: 'Laning & Lv2',
      timeWindow: '0:30–4:30',
      startSec: ADC_TIMINGS.minionSpawnSec,
      endSec: ADC_TIMINGS.laningPhaseEndSec,
      focus: wave.decision === 'push_lv2_all_in' ? 'Win the Level-2 race' : 'Concede Level 2, farm safely',
      actions: [
        wave.instruction,
        `Jungler threat: ${threat.dangerWindow.label} — ${threat.instruction}`,
        'Crash a wave before your first reset so you never lose CS/XP under tower.',
      ],
    },
    {
      id: 'plates_first_drakes',
      order: 2,
      label: 'Plates & First Drakes',
      timeWindow: '4:30–14:00',
      startSec: ADC_TIMINGS.laningPhaseEndSec,
      endSec: ADC_TIMINGS.plateFallSec,
      focus:
        dragonPriority === 'high'
          ? 'Convert lane priority into plates and Dragons'
          : 'Farm to item spikes, give Dragon only when prio is lost',
      actions: [
        'Buy a Control Ward every reset; place it in the bot lane brush or Dragon-side river.',
        `Shove the wave 45s before 5:00 Dragon so you and your Support move first (priority: ${dragonPriority}).`,
        'Every enemy back or kill = hit tower plates; plates fall at 14:00.',
      ],
    },
    {
      id: 'mid_lane_rotation',
      order: 3,
      label: 'Mid-Lane Rotation',
      timeWindow: '14:00–20:00',
      startSec: ADC_TIMINGS.plateFallSec,
      endSec: ADC_TIMINGS.baronSpawnSec,
      focus: 'Bot → Mid swap once Bot Tier-1 drops',
      actions: [
        'Once Bot Tier-1 falls, swap to Mid; let a solo laner hold the side wave.',
        'Farm side waves only with vision and your Support nearby — never alone past river.',
        'Group for Dragon 60s before spawn; rotate with your Support, not after them.',
      ],
    },
    {
      id: 'teamfight_baron_elder',
      order: 4,
      label: 'Teamfight Positioning around Baron & Elder',
      timeWindow: '20:00+',
      startSec: ADC_TIMINGS.baronSpawnSec,
      endSec: null,
      focus: lateCarry ? 'Front-to-back DPS — you are the win condition' : 'Siege & pick follow-up',
      actions: [
        'Hit the closest safe target; never walk past your frontline to reach the backline.',
        'Swap to Farsight Alteration to scout Baron/Elder brushes instead of face-checking.',
        lateCarry
          ? 'Avoid side-lane deaths before Baron/Elder — your death loses the fight.'
          : 'Use your range to poke structures after a pick; reset before the next objective.',
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateAdcGamePlan(input: AdcGamePlanInput): AdcWinConditionPlan {
  const adc = findAdcChampionById(input.playerChampionId) ?? fallbackProfile(input.playerChampionId);
  const enemyIds = Object.values(input.enemyRoles).filter(
    (id): id is number => typeof id === 'number' && id > 0
  );

  const botMatchupSummary = buildBotMatchupSummary(adc, input, enemyIds);
  const supportSynergyPlaybook = buildSupportPlaybook(adc, input.allyRoles.utility);
  const wavePlan = buildWavePlan(adc, botMatchupSummary.level2Delta);
  const enemyJunglerThreat = buildJunglerThreat(input);

  // Dragon priority: bot 2v2 strength, softened by enemy jungle pressure on bot.
  let dragonScore =
    botMatchupSummary.verdict === 'favored' ? 2 : botMatchupSummary.verdict === 'unfavored' ? -2 : 0;
  dragonScore += clamp(Math.round(botMatchupSummary.level2Delta / 3), -1, 1);
  if (enemyJunglerThreat.threatLevel === 'high') dragonScore -= 1;
  const dragonLevel: 'high' | 'medium' | 'low' =
    dragonScore >= 2 ? 'high' : dragonScore <= -2 ? 'low' : 'medium';
  const dragonPriority = {
    firstSpawnSec: ADC_TIMINGS.firstDragonSec,
    priority: dragonLevel,
    instruction:
      dragonLevel === 'high'
        ? 'Bot has priority: shove at 4:15, ward pixel brush, and start 5:00 Dragon with your jungler.'
        : dragonLevel === 'low'
          ? 'Bot is weak side: farm safely and trade Dragon for Voidgrubs/plates instead of a losing 5:00 fight.'
          : 'Contest 5:00 Dragon only if bot wave is pushed and your jungler is bot side.',
  };

  const plateWindow = {
    deadlineSec: ADC_TIMINGS.plateFallSec,
    instruction:
      'Bot Tier-1 plates fall at 14:00 — convert every kill, enemy recall, or Dragon trade into plate damage before the deadline.',
  };

  const midSwap = {
    trigger: 'Bot Tier-1 turret destroyed (or plates fallen at 14:00)',
    instruction:
      'Swap to Mid lane with your Support: take the Mid wave, let the solo laner catch Bot, and play around the next Dragon/Baron from the center.',
  };

  const macroPhases = buildMacroPhases(adc, wavePlan, enemyJunglerThreat, dragonLevel);
  const wardSpots = buildAdcWardSpots(input.mapSide);

  const enemyBotLane = botMatchupSummary.enemyBotLane;
  const dangerChampionIds = [enemyBotLane?.adcId, enemyBotLane?.supportId, input.enemyRoles.jungle]
    .filter((id): id is number => typeof id === 'number' && id > 0);

  const lateCarry = adc.scalingProfile === 'late' || adc.archetype === 'hypercarry';
  const primaryWinCondition = lateCarry
    ? `Scale ${adc.name} to 2–3 items safely: farm, trade Dragons only with priority, and win front-to-back fights around Baron/Elder.`
    : adc.archetype === 'lane_bully' || adc.scalingProfile === 'early'
      ? `Snowball ${adc.name}'s early lane: win Level 2, take plates before 14:00, and convert Bot priority into Dragons.`
      : `Play ${adc.name} for mid-game tempo: secure first item, swap Mid at Bot Tier-1, and siege with Dragon/Baron pressure.`;

  const enemyArchetype = enemyBotLane?.supportArchetype;
  const enemyWinConditionToDeny =
    enemyArchetype === 'engage' || enemyArchetype === 'catcher'
      ? `Deny the enemy ${enemyBotLane?.supportName ?? 'support'}'s picks: stay behind minions, respect ${enemyJunglerThreat.dangerWindow.label}, and never get caught in side lanes before objectives.`
      : enemyArchetype === 'poke'
        ? 'Deny siege poke: don’t sit at low HP in lane, all-in when their skillshots miss, and reset before objectives.'
        : enemyJunglerThreat.threatLevel === 'high'
          ? `Deny ${enemyJunglerThreat.enemyJunglerName}'s early Bot snowball: ward tri-brush by 2:15 and play safe until 2:55.`
          : 'Deny enemy scaling: punish passive wave clears, take plates, and keep Dragon priority.';

  const keyRules = [
    wavePlan.level2Rule,
    `Danger: ${enemyJunglerThreat.dangerWindow.label}.`,
    'Plates fall at 14:00 — don’t give them away for free.',
    'Bot → Mid swap once Bot Tier-1 drops.',
  ];

  return {
    championId: adc.championId,
    championName: adc.name,
    mapSide: input.mapSide,
    archetype: adc.archetype,
    laneGamePlan: `${wavePlan.instruction} ${supportSynergyPlaybook.playbook}`,
    powerSpikes: [
      { label: 'Level 2', itemIds: [], note: wavePlan.level2Rule },
      { label: 'First item', itemIds: adc.coreItemIds.slice(0, 1), note: 'Reset on B.F. Sword gold (1300g) and spike before Dragon.' },
      { label: 'Two-item spike', itemIds: adc.coreItemIds.slice(0, 2), note: 'Group mid and force objectives.' },
    ],
    teamfightRole: lateCarry
      ? 'Primary front-to-back DPS — protect your position over chasing kills.'
      : 'Secondary damage & siege — follow picks and poke structures.',
    enemyBotLane,
    dangerChampionIds,
    keyRules,
    botMatchupSummary,
    supportSynergyPlaybook,
    wavePlan,
    enemyJunglerThreat,
    plateWindow,
    dragonPriority,
    midSwap,
    macroPhases,
    wardSpots,
    primaryWinCondition,
    enemyWinConditionToDeny,
  };
}
