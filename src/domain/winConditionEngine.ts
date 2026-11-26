import {
  buildRoutesForSide,
  buildWardSpotsForSide,
  findJungleChampionById,
  getChampionMeta,
} from '../data/jungleKnowledgePack';
import { analyzeTeamComposition } from './champSelectEngine';
import type { WinConditionPlan } from '../types/coaching';
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
        ? 'Enemy wants early river skirmishes & invades — track their start with a 1:15 ward and trade opposite-side camps/objectives.'
        : 'Enemy wants to stall for 5v5 scaling — punish greedy wave clears, take Voidgrubs/Dragons on spawn, and deny free Baron setup.';

  const routes = buildRoutesForSide(input.mapSide, strongSide);
  const preferredStyle = playerProfile?.preferredFirstClear ?? 'full_clear';
  const recommendedRoute =
    routes.find((r) => r.style === preferredStyle) ?? routes[0]!;

  const wardSpots = buildWardSpotsForSide(input.mapSide);

  const phasePlaybook = {
    early: `Start ${recommendedRoute.label}. Ward enemy raptors/entrance at 1:15 if facing an early invader. Path toward ${strongSide.toUpperCase()} for 3:30 Scuttle and first Dragon/Grubs prio.`,
    mid: `Swap to Oracle Lens after first/second recall. Play around ${strongSide.toUpperCase()} Tier-1 turret push, sync camp clears with Dragon/Herald timers (arrive 45s early with a Control Ward).`,
    late: `Shadow your main carry, clear vision around Baron/Elder 60s before spawn, and never risk a 50/50 Smite while your strong side wave is pushed against you.`,
  };

  return {
    allyAnalysis,
    enemyAnalysis,
    primaryWinCondition,
    enemyWinConditionToDeny,
    strongSide,
    weakSide,
    strongSideReason,
    phasePlaybook,
    routes,
    recommendedRouteId: recommendedRoute.id,
    wardSpots,
  };
}
