import { describe, expect, it } from 'vitest';
import { findJungleChampionByName } from '../data/jungleKnowledgePack';
import {
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  formatClock,
} from './liveCoachEngine';
import {
  DEMO_IN_GAME_EARLY,
  DEMO_IN_GAME_FULL_BUILD,
  DEMO_IN_GAME_MID,
} from './simulationFixtures';
import { generateWinConditionPlan } from './winConditionEngine';

describe('liveCoachEngine', () => {
  it('computes deterministic Scuttle, Dragon, and Voidgrubs/Baron timers', () => {
    const earlyObjs = computeObjectiveWindows(185, []);
    const scuttle = earlyObjs.find((o) => o.id === 'scuttle');
    expect(scuttle).toBeDefined();
    expect(scuttle?.secondsRemaining).toBe(25);
    expect(scuttle?.status).toBe('prep_vision');

    // Mid game fixture is at 19:24 (1164s), last DragonKill at 912s -> respawns at 1212s (48s away)
    const midObjs = computeObjectiveWindows(
      DEMO_IN_GAME_MID.gameData.gameTime,
      DEMO_IN_GAME_MID.events.Events
    );
    const dragon = midObjs.find((o) => o.id === 'dragon');
    expect(dragon?.secondsRemaining).toBe(48);
    expect(dragon?.status).toBe('prep_vision');
    expect(formatClock(1164)).toBe('19:24');
  });

  it('triggers reactive anti-heal, MR, Oracle Lens, and Control Ward recommendations', () => {
    const viego = findJungleChampionByName('Viego');
    const build = computeAdaptiveBuild(DEMO_IN_GAME_MID, viego);

    // Enemy team has Aatrox + Soraka + Sylas -> heavy healing & fed Sylas AP
    expect(build.threats.healingThreat).toBe(true);
    expect(build.threats.apThreat).toBe(true);
    expect(build.nextItem?.item.id).toBe(6609); // Chempunk Chainsword
    expect(build.trinketAdvice.item.id).toBe(3364); // Oracle Lens
    expect(build.consumableAdvice.some((c) => c.item.id === 2055)).toBe(true); // Control Ward
  });

  it('recommends Elixir and Full-Build Boot/GA replacements at 6 items', () => {
    const viego = findJungleChampionByName('Viego');
    const fullBuild = computeAdaptiveBuild(DEMO_IN_GAME_FULL_BUILD, viego);

    expect(fullBuild.isFullBuild).toBe(true);
    expect(fullBuild.fullBuildAlternatives.length).toBeGreaterThanOrEqual(2);
    expect(
      fullBuild.fullBuildAlternatives.some((a) => a.recommendedItem.id === 3742)
    ).toBe(true); // Dead Man's Plate boot swap
    expect(fullBuild.consumableAdvice.some((c) => c.item.id === 2140)).toBe(true); // Elixir of Wrath
  });

  it('produces compliant macro cues without enemy cooldown tracking', () => {
    const winPlan = generateWinConditionPlan({
      allyRoles: { top: 58, jungle: 234, middle: 61, bottom: 145, utility: 111 },
      enemyRoles: { top: 266, jungle: 56, middle: 517, bottom: 222, utility: 16 },
      playerChampionId: 234,
      mapSide: 'blue',
    });
    const objs = computeObjectiveWindows(
      DEMO_IN_GAME_EARLY.gameData.gameTime,
      DEMO_IN_GAME_EARLY.events.Events
    );
    const cues = computeMacroGuidance(DEMO_IN_GAME_EARLY, winPlan, objs);
    expect(cues.length).toBeGreaterThanOrEqual(3);
  });
});
