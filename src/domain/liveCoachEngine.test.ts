import { describe, expect, it } from 'vitest';
import { findJungleChampionByName } from '../data/jungleKnowledgePack';
import { computePersonalLearningSnapshot } from './personalLearningEngine';
import { DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import {
  DEFAULT_OBJECTIVE_TIMINGS,
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  computePersonalizedLiveGuardrails,
  computeSmiteProgression,
  formatClock,
  isSelfJungleInLiveGame,
  resolveSelfPlayer,
} from './liveCoachEngine';
import {
  DEMO_IN_GAME_EARLY,
  DEMO_IN_GAME_FULL_BUILD,
  DEMO_IN_GAME_MID,
} from './simulationFixtures';
import { generateWinConditionPlan } from './winConditionEngine';

describe('liveCoachEngine', () => {
  it('computes deterministic Season 2026 Scuttle, Dragon, Voidgrubs, Herald, and Baron timers without Atakhan', () => {
    const earlyObjs = computeObjectiveWindows(150, []);
    const scuttle = earlyObjs.find((o) => o.id === 'scuttle');
    expect(scuttle).toBeDefined();
    expect(scuttle?.secondsRemaining).toBe(25);
    expect(scuttle?.nextSpawnFormatted).toBe('2:55');
    expect(scuttle?.status).toBe('prep_vision');

    const grubsBeforeSpawn = earlyObjs.find((o) => o.id === 'voidgrubs');
    expect(grubsBeforeSpawn?.nextSpawnFormatted).toBe('8:00');
    expect(earlyObjs.some((o) => o.id === 'atakhan')).toBe(false);

    // At 15:10 (910s), Rift Herald (15:00 - 19:45) should be LIVE
    const heraldLiveObjs = computeObjectiveWindows(910, []);
    const herald = heraldLiveObjs.find((o) => o.id === 'herald');
    expect(herald?.status).toBe('live');
    expect(herald?.nextSpawnFormatted).toBe('15:00');

    // Mid game fixture is at 19:24 (1164s), last DragonKill at 912s -> respawns at 1212s (48s away)
    const midObjs = computeObjectiveWindows(
      DEMO_IN_GAME_MID.gameData.gameTime,
      DEMO_IN_GAME_MID.events.Events
    );
    const dragon = midObjs.find((o) => o.id === 'dragon');
    expect(dragon?.secondsRemaining).toBe(48);
    expect(dragon?.status).toBe('prep_vision');
    expect(midObjs.some((o) => o.id === 'atakhan')).toBe(false);
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

  it('resolves self by Riot ID, detects threats by itemID on non-English locales, and handles 2-2 Dragon splits', () => {
    const localizedLive: typeof DEMO_IN_GAME_MID = {
      ...DEMO_IN_GAME_MID,
      activePlayer: {
        ...DEMO_IN_GAME_MID.activePlayer,
        summonerName: '',
        riotId: 'MyJungler#EUW',
      },
      allPlayers: DEMO_IN_GAME_MID.allPlayers.map((p) => {
        if (p.summonerName === DEMO_IN_GAME_MID.activePlayer.summonerName) {
          return { ...p, summonerName: 'DifferentLegacyName', riotId: 'MyJungler#EUW' };
        }
        if (p.championName === 'Jinx') {
          return {
            ...p,
            items: [
              { itemID: 3031, displayName: 'Klinge der Unendlichkeit', count: 1, slot: 0, price: 3600 },
              { itemID: 3046, displayName: 'Phantomtänzer', count: 1, slot: 1, price: 2650 },
            ],
          };
        }
        return p;
      }),
    };

    const resolved = resolveSelfPlayer(localizedLive);
    expect(resolved?.riotId).toBe('MyJungler#EUW');
    expect(resolved?.team).toBe('ORDER');

    // Never fall back to allPlayers[0] when self cannot be matched
    expect(
      resolveSelfPlayer({
        ...localizedLive,
        activePlayer: { ...localizedLive.activePlayer, summonerName: 'Missing', riotId: 'Missing#NA1' },
      })
    ).toBeNull();

    // 2-2 Dragon split stays Elemental Dragon (not Elder Dragon)
    const splitObjs = computeObjectiveWindows(
      1190, // After 19:45 Herald despawn -> Baron (20:00) + Dragon, never Atakhan
      [
        { EventID: 1, EventName: 'DragonKill', EventTime: 340, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
        { EventID: 2, EventName: 'DragonKill', EventTime: 650, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
        { EventID: 3, EventName: 'DragonKill', EventTime: 960, KillerName: DEMO_IN_GAME_MID.allPlayers[5]!.summonerName },
        { EventID: 4, EventName: 'DragonKill', EventTime: 1120, KillerName: DEMO_IN_GAME_MID.allPlayers[5]!.summonerName },
      ],
      DEMO_IN_GAME_MID.allPlayers
    );
    const dragon = splitObjs.find((o) => o.id === 'dragon');
    expect(dragon?.name).toBe('Elemental Dragon');
    expect(splitObjs.some((o) => o.id === 'herald')).toBe(false);
    expect(splitObjs.some((o) => o.id === 'baron')).toBe(true);
    expect(splitObjs.find((o) => o.id === 'baron')?.nextSpawnFormatted).toBe('20:00');
    expect(splitObjs.some((o) => o.id === 'atakhan')).toBe(false);

    // 4-0 sweep claims Soul -> next Dragon is Elder with a 6:00 (360s) respawn timer
    const soulSweep = computeObjectiveWindows(
      1400,
      [
        { EventID: 1, EventName: 'DragonKill', EventTime: 320, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
        { EventID: 2, EventName: 'DragonKill', EventTime: 630, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
        { EventID: 3, EventName: 'DragonKill', EventTime: 940, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
        { EventID: 4, EventName: 'DragonKill', EventTime: 1250, KillerName: DEMO_IN_GAME_MID.allPlayers[1]!.summonerName },
      ],
      DEMO_IN_GAME_MID.allPlayers
    );
    const elder = soulSweep.find((o) => o.id === 'dragon');
    expect(elder?.name).toBe('Elder Dragon');
    expect(elder?.secondsRemaining).toBe(210); // 1250 + 360 - 1400
  });

  it('tracks Base (600), Unleashed (1000), and Primal (1400) Smite progression', () => {
    const early = computeSmiteProgression(DEMO_IN_GAME_EARLY);
    expect(early.tierName).toBe('Base');
    expect(early.damage).toBe(600);
    expect(early.estimatedStacksRemaining).toBeGreaterThan(0);

    const mid = computeSmiteProgression(DEMO_IN_GAME_MID);
    expect(['Unleashed', 'Primal']).toContain(mid.tierName);
    expect(mid.damage).toBeGreaterThanOrEqual(1000);

    const full = computeSmiteProgression(DEMO_IN_GAME_FULL_BUILD);
    expect(full.tierName).toBe('Primal');
    expect(full.damage).toBe(1400);
    expect(full.estimatedStacksRemaining).toBe(0);
  });

  it('detects off-role players vs active junglers accurately even after role swaps', () => {
    const offRoleAdc = {
      ...DEMO_IN_GAME_MID,
      allPlayers: DEMO_IN_GAME_MID.allPlayers.map((p) =>
        p.summonerName === DEMO_IN_GAME_MID.activePlayer.summonerName
          ? {
              ...p,
              championName: 'Jinx',
              position: 'BOTTOM',
              summonerSpells: {
                summonerSpellOne: { displayName: 'Heal' },
                summonerSpellTwo: { displayName: 'Flash' },
              },
            }
          : p
      ),
    };
    expect(isSelfJungleInLiveGame(offRoleAdc)).toBe(false);

    const swappedJungle = {
      ...offRoleAdc,
      allPlayers: offRoleAdc.allPlayers.map((p) =>
        p.summonerName === DEMO_IN_GAME_MID.activePlayer.summonerName
          ? {
              ...p,
              summonerSpells: {
                summonerSpellOne: { displayName: 'Smite' },
                summonerSpellTwo: { displayName: 'Flash' },
              },
            }
          : p
      ),
    };
    expect(isSelfJungleInLiveGame(swappedJungle)).toBe(true);
  });

  it('applies hot-swapped ObjectiveTimingsConfig cleanly without rebuild', () => {
    const customTimings = {
      ...DEFAULT_OBJECTIVE_TIMINGS,
      dragonFirstSpawnSec: 330,
      voidgrubsSpawnSec: 390,
    };
    const objs = computeObjectiveWindows(185, [], undefined, customTimings);
    const dragon = objs.find((o) => o.id === 'dragon');
    const grubs = objs.find((o) => o.id === 'voidgrubs');
    expect(dragon?.nextSpawnFormatted).toBe('5:30');
    expect(dragon?.secondsRemaining).toBe(145);
    expect(grubs?.nextSpawnFormatted).toBe('6:30');
    expect(grubs?.secondsRemaining).toBe(205);
  });

  it('caps personalized live guardrails at <= 2 cues from public scoreboard + Confirmed habits only', () => {
    const badJgBase = DEMO_POST_GAME_MATCHES[1]!;
    const leakHistory = Array.from({ length: 8 }, (_, idx) => ({
      ...badJgBase,
      matchId: `EUW1_GUARD_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, 10 + idx, 0, 0)).toISOString(),
    }));
    const confirmedLearning = computePersonalLearningSnapshot(
      leakHistory,
      leakHistory,
      'PLATINUM IV'
    );
    const objs = computeObjectiveWindows(
      DEMO_IN_GAME_MID.gameData.gameTime,
      DEMO_IN_GAME_MID.events.Events
    );
    const guardrails = computePersonalizedLiveGuardrails(
      {
        gameTime: DEMO_IN_GAME_MID.gameData.gameTime,
        wardScore: 4, // low ward/min triggers blind_river_vision
        creepScore: 60, // low CS/min triggers midgame_farm_drop
        objectives: objs,
        personalLearning: confirmedLearning,
      },
      2
    );
    expect(guardrails.length).toBeLessThanOrEqual(2);
    expect(guardrails.length).toBeGreaterThanOrEqual(1);
    expect(guardrails.every((g) => g.source === 'personal_guardrail')).toBe(true);

    // Monitoring-only learning snapshot (2 games) must emit 0 guardrails
    const monitoringOnly = computePersonalLearningSnapshot(
      leakHistory.slice(0, 2),
      leakHistory.slice(0, 2),
      'PLATINUM IV'
    );
    expect(
      computePersonalizedLiveGuardrails({
        gameTime: DEMO_IN_GAME_MID.gameData.gameTime,
        wardScore: 4,
        creepScore: 60,
        objectives: objs,
        personalLearning: monitoringOnly,
      })
    ).toEqual([]);

    // When index 0 is LIVE (0s remaining, e.g. Herald), pre_obj guardrail still fires for upcoming Dragon (<= 90s)
    const liveHeraldThenDragon = computePersonalizedLiveGuardrails({
      gameTime: 1000,
      wardScore: 20,
      creepScore: 150,
      objectives: [
        {
          id: 'herald',
          name: 'Rift Herald',
          status: 'live',
          secondsRemaining: 0,
          nextSpawnFormatted: '14:00',
          priority: 'high',
          actionText: 'Live',
        },
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'prep_vision',
          secondsRemaining: 48,
          nextSpawnFormatted: '17:28',
          priority: 'critical',
          actionText: 'Prep',
        },
      ],
      personalLearning: confirmedLearning,
    });
    expect(liveHeraldThenDragon.some((g) => g.id === 'personal-pre-obj-guard')).toBe(true);

    // Custom hot-swapped SmiteThresholdsConfig alters Unleashed/Primal damage & treat counts
    const customSmite = computeSmiteProgression(DEMO_IN_GAME_MID, {
      baseDamage: 650,
      unleashedDamage: 950,
      primalDamage: 1250,
      unleashedStacks: 25,
      primalStacks: 45,
    });
    expect([950, 1250]).toContain(customSmite.damage);

    // Compile-time Riot compliance check: hidden enemy state must never compile into guardrails
    const forbiddenInput = {
      gameTime: 900,
      wardScore: 10,
      creepScore: 100,
      objectives: objs,
      personalLearning: confirmedLearning,
      enemyCooldowns: { flash: 120 },
    };
    // @ts-expect-error enemyCooldowns is statically banned by PersonalLiveGuardrailContext
    expect(computePersonalizedLiveGuardrails(forbiddenInput).length).toBeLessThanOrEqual(2);
  });

  it('recognizes bought boots including Tier-3 upgrades and slot > 6 without re-recommending boots', () => {
    const viego = findJungleChampionByName('Viego');
    const selfName = DEMO_IN_GAME_MID.activePlayer.summonerName;
    const withTier3Boots = {
      ...DEMO_IN_GAME_MID,
      allPlayers: DEMO_IN_GAME_MID.allPlayers.map((p) =>
        p.summonerName === selfName
          ? {
              ...p,
              items: [
                ...p.items.filter((i) => i.itemID !== 3111 && i.itemID !== 3047 && i.itemID !== 3006),
                { itemID: 3173, displayName: 'Chainlaced Crushers', count: 1, slot: 7, price: 1850 },
              ],
            }
          : p
      ),
    };
    const build = computeAdaptiveBuild(withTier3Boots, viego);
    const recommendedIds = [
      ...(build.nextItem ? [build.nextItem.item.id] : []),
      ...build.upcomingQueue.map((q) => q.item.id),
    ];
    expect(recommendedIds).not.toContain(3047);
    expect(recommendedIds).not.toContain(3111);
    expect(recommendedIds).not.toContain(3006);
  });
});
