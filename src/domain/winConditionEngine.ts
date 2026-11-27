import {
  buildRoutesForSide,
  buildWardSpotsForSide,
  findJungleChampionById,
  getChampionMeta,
} from '../data/jungleKnowledgePack';
import { pickFirstClear } from './jungleRoutingEngine';
import { analyzeTeamComposition } from './champSelectEngine';
import type {
  EnemyJunglePlaybook,
  LaneGankabilityRow,
  WinConditionPlan,
} from '../types/coaching';
import type { LaneRole, MapSide } from '../types/riot';

export interface WinConditionInput {
  allyRoles: Partial<Record<LaneRole, number>>;
  enemyRoles: Partial<Record<LaneRole, number>>;
  playerChampionId: number;
  mapSide: MapSide;
}

function scoreLanePlayability(
  allyId: number | undefined,
  enemyId: number | undefined
): number {
  let score = 0;
  if (allyId) {
    const ally = getChampionMeta(allyId);
    score += ally.hardCcScore * 0.8 + ally.engageScore * 0.4;
    if (ally.volatileLane) score += 4;
    if (ally.powerSpike === 'late') score += 2; // Protect/accelerate carry
  }
  if (enemyId) {
    const enemy = getChampionMeta(enemyId);
    if (enemy.volatileLane) score += 3;
    if (enemy.frontlineScore <= 3 && enemy.hardCcScore <= 3) score += 2; // Easy gank target
  }
  return score;
}

export function generateWinConditionPlan(input: WinConditionInput): WinConditionPlan {
  const allyIds = Object.values(input.allyRoles).filter(
    (id): id is number => typeof id === 'number' && id > 0
  );
  const enemyIds = Object.values(input.enemyRoles).filter(
    (id): id is number => typeof id === 'number' && id > 0
  );

  const allyAnalysis = analyzeTeamComposition(allyIds);
  const enemyAnalysis = analyzeTeamComposition(enemyIds);
  const playerProfile = findJungleChampionById(input.playerChampionId);

  const botScore =
    scoreLanePlayability(input.allyRoles.bottom, input.enemyRoles.bottom) +
    scoreLanePlayability(input.allyRoles.utility, input.enemyRoles.utility) * 0.9;
  const topScore = scoreLanePlayability(input.allyRoles.top, input.enemyRoles.top);

  const strongSide: 'top' | 'bot' = botScore >= topScore ? 'bot' : 'top';
  const weakSide: 'top' | 'bot' = strongSide === 'bot' ? 'top' : 'bot';

  const strongSideReason =
    strongSide === 'bot'
      ? 'Bot lane offers higher gank setup/CC, volatile 2v2 trading, and direct Dragon stacking priority.'
      : 'Top lane matchup is volatile melee-vs-melee where an early gank snowballs grubs/herald control.';

  const primaryWinCondition =
    allyAnalysis.latePower > enemyAnalysis.latePower + 1
      ? `Outscale via ${allyAnalysis.archetype}: Farm efficiently, trade cross-map when weak early, stack Dragons, and fight 5v5 on 2–3 item spikes.`
      : allyAnalysis.earlyPower > enemyAnalysis.earlyPower + 1
        ? `Accelerate through ${strongSide.toUpperCase()} side: Force early Voidgrubs/Dragons on cooldown, convert kills into Tier-1 plates, and close before enemy carries scale.`
        : `Win through ${allyAnalysis.archetype}: Play toward ${strongSide.toUpperCase()} prio, secure Vision before every neutral objective, and force decisive numbers-advantage fights.`;

  const enemyWinConditionToDeny =
    enemyAnalysis.archetype === 'Dive & Pick'
      ? 'Enemy wants side-lane picks & chaotic dives — drop deep wards on flank angles and group before objectives.'
      : enemyAnalysis.archetype === 'Early Snowball'
        ? 'Enemy wants early river skirmishes & invades — drop an early entrance ward before 0:55 buff spawn and trade opposite-side camps/objectives.'
        : 'Enemy wants to stall for 5v5 scaling — punish greedy wave clears, take Voidgrubs/Dragons on spawn, and deny free Baron setup.';

  const enemyJgProfile = input.enemyRoles.jungle
    ? findJungleChampionById(input.enemyRoles.jungle)
    : undefined;
  const enemyJgName =
    enemyJgProfile?.name ??
    (input.enemyRoles.jungle ? getChampionMeta(input.enemyRoles.jungle).name : 'Enemy Jungler');
  const enemyBotFocus =
    scoreLanePlayability(input.enemyRoles.bottom, input.allyRoles.bottom) +
      scoreLanePlayability(input.enemyRoles.utility, input.allyRoles.utility) * 0.9 >=
    scoreLanePlayability(input.enemyRoles.top, input.allyRoles.top);
  const earlyAggressive =
    enemyJgProfile?.preferredFirstClear === 'three_camp_gank' ||
    enemyJgProfile?.powerSpike === 'early';
  const invadeRisk: 'low' | 'medium' | 'high' =
    enemyJgProfile?.preferredFirstClear === 'three_camp_gank'
      ? 'high'
      : enemyJgProfile?.powerSpike === 'early'
        ? 'medium'
        : 'low';

  const strongLanePriority = Math.min(
    10,
    Math.max(1, Math.round(strongSide === 'bot' ? botScore / 1.9 : topScore))
  );
  const firstClearDecision = pickFirstClear({
    champion: playerProfile,
    strongSide,
    strongLanePriority,
    invadeRisk,
  });

  const routes = buildRoutesForSide(
    input.mapSide,
    strongSide,
    firstClearDecision.style,
    firstClearDecision.reason
  );
  const recommendedRoute = routes[0]!;

  const wardSpots = buildWardSpotsForSide(input.mapSide);

  const phasePlaybook = {
    early: `Start ${recommendedRoute.descriptor}. Ward enemy raptors/entrance before 0:55 buff spawn if facing an early invader. Path toward ${strongSide.toUpperCase()} for 2:55 Scuttle and first Dragon/Grubs prio.`,
    mid: `Swap to Oracle Lens after first/second recall. Play around ${strongSide.toUpperCase()} Tier-1 turret push, sync camp clears with Dragon/Herald timers (arrive 45s early with a Control Ward).`,
    late: `Shadow your main carry, clear vision around Baron/Elder 60s before spawn, and never risk a 50/50 Smite while your strong side wave is pushed against you.`,
  };

  const enemyJunglePlaybook: EnemyJunglePlaybook = {
    enemyChampionName: enemyJgName,
    expectedStart: earlyAggressive
      ? `${enemyJgName} favors a 3-camp Level 3 rush -> expect 2:30 ${enemyBotFocus ? 'Bot' : 'Top'} gank or buff invade.`
      : `${enemyJgName} typically full-clears ${enemyBotFocus ? 'Top → Bot' : 'Bot → Top'} for 2:55 Scuttle.`,
    wardTarget115: earlyAggressive
      ? 'Enemy Raptor bush or your opposite-side river pixel brush before 0:55'
      : 'Enemy Raptor bush before 0:55 to reveal clear direction',
    invadeRisk,
    counterPlan: earlyAggressive
      ? 'Ping vulnerable side laners at 2:20, keep your second buff warded, or cross-invade if they show opposite.'
      : 'Match their camp tempo, save 1 Smite charge for 2:55 Crab, and contest with adjacent lane priority.',
  };

  const midScore = scoreLanePlayability(input.allyRoles.middle, input.enemyRoles.middle);
  const laneName = (id: number | undefined, fallback: string) =>
    id ? getChampionMeta(id).name : fallback;

  const laneGankability: LaneGankabilityRow[] = [
    {
      lane: 'top',
      allyLabel: laneName(input.allyRoles.top, 'Ally Top'),
      enemyLabel: laneName(input.enemyRoles.top, 'Enemy Top'),
      priorityScore: Math.min(10, Math.round(topScore)),
      verdict: strongSide === 'top' ? 'Strong Side' : topScore >= 5 ? 'Playable' : 'Weak Side',
      tip:
        strongSide === 'top'
          ? 'Snowball early melee trades & convert into 6:00 Voidgrubs.'
          : 'Avoid low-odds dives; help break freezes only on Top quadrant cycles.',
    },
    {
      lane: 'middle',
      allyLabel: laneName(input.allyRoles.middle, 'Ally Mid'),
      enemyLabel: laneName(input.enemyRoles.middle, 'Enemy Mid'),
      priorityScore: Math.min(10, Math.round(midScore)),
      verdict: midScore >= 6 ? 'Strong Side' : midScore >= 3 ? 'Playable' : 'Weak Side',
      tip: 'Mid priority unlocks first move to Scuttle, Dragon, and Voidgrubs.',
    },
    {
      lane: 'bottom',
      allyLabel: `${laneName(input.allyRoles.bottom, 'Bot')} + ${laneName(input.allyRoles.utility, 'Sup')}`,
      enemyLabel: `${laneName(input.enemyRoles.bottom, 'Enemy Bot')} + ${laneName(input.enemyRoles.utility, 'Enemy Sup')}`,
      priorityScore: Math.min(10, Math.max(1, Math.round(botScore / 1.9))),
      verdict: strongSide === 'bot' ? 'Strong Side' : botScore >= 9 ? 'Playable' : 'Weak Side',
      tip:
        strongSide === 'bot'
          ? 'Chain Support CC and crash waves directly into Dragon setups.'
          : 'Path through cautiously if Dragon is contested; trade Top Grubs when behind.',
    },
  ];

  return {
    allyAnalysis,
    enemyAnalysis,
    primaryWinCondition,
    enemyWinConditionToDeny,
    strongSide,
    weakSide,
    strongSideReason,
    phasePlaybook,
    enemyJunglePlaybook,
    laneGankability,
    routes,
    recommendedRouteId: recommendedRoute.id,
    wardSpots,
  };
}
