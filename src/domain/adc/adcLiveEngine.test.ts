import { describe, expect, it } from 'vitest';
import { findAdcChampionById } from '../../data/adcKnowledgePack';
import { ADC_TIMINGS, buildAdcWardSpots, generateAdcGamePlan } from './adcGamePlanEngine';
import {
  ADC_FORBIDDEN_ITEM_IDS,
  ADC_ITEM_IDS,
  buildAdcLiveContext,
  computeAdcAdaptiveBuild,
  computeAdcMacroCues,
  computeAdcMacroGuidance,
  resolveAdcCsTarget,
  type AdcLiveContext,
} from './adcLiveEngine';
import type { ItemRecommendation, ObjectiveWindow } from '../../types/coaching';
import type { LiveEvent, LiveGameData, LiveItem, LivePlayer } from '../../types/riot';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function item(itemID: number, slot: number, price = 3000): LiveItem {
  return { itemID, displayName: `Item ${itemID}`, count: 1, slot, price };
}

function player(
  championName: string,
  team: 'ORDER' | 'CHAOS',
  opts: { kills?: number; items?: LiveItem[]; cs?: number; summonerName?: string } = {}
): LivePlayer {
  return {
    summonerName: opts.summonerName ?? `${championName}-${team}`,
    championName,
    team,
    position: '',
    level: 9,
    isDead: false,
    respawnTimer: 0,
    items: opts.items ?? [],
    scores: { kills: opts.kills ?? 0, deaths: 0, assists: 0, creepScore: opts.cs ?? 0, wardScore: 5 },
  };
}

function liveGame(opts: {
  selfChampion?: string;
  selfItems?: LiveItem[];
  selfCs?: number;
  enemies: LivePlayer[];
  gold?: number;
  gameTime?: number;
  level?: number;
  events?: LiveEvent[];
}): LiveGameData {
  const self = player(opts.selfChampion ?? 'Jinx', 'ORDER', {
    items: opts.selfItems ?? [],
    cs: opts.selfCs ?? 0,
    summonerName: 'Me',
  });
  return {
    activePlayer: {
      summonerName: 'Me',
      level: opts.level ?? 8,
      currentGold: opts.gold ?? 500,
      championStats: {
        attackDamage: 100,
        abilityPower: 0,
        armor: 40,
        magicResist: 30,
        currentHealth: 900,
        maxHealth: 900,
        moveSpeed: 340,
      },
    },
    allPlayers: [self, ...opts.enemies],
    events: { Events: opts.events ?? [] },
    gameData: { gameMode: 'CLASSIC', gameTime: opts.gameTime ?? 600, mapName: 'Map11', mapNumber: 11 },
  };
}

/** Owns Jinx's first core item so reactive pivots move to the front of the queue. */
const JINX_FIRST_ITEM = [item(3032, 0, 3000)];

function allRecommendedIds(build: { nextItem: ItemRecommendation | null; upcomingQueue: ItemRecommendation[] }) {
  return [build.nextItem, ...build.upcomingQueue].filter(Boolean).map((r) => r!.item.id);
}

// ---------------------------------------------------------------------------
// Game plan
// ---------------------------------------------------------------------------

describe('adcGamePlanEngine', () => {
  it('builds 4 bot-lane ward spots in [0..1000] map space, mirrored for Red side', () => {
    const blue = buildAdcWardSpots('blue');
    const red = buildAdcWardSpots('red');
    expect(blue.map((w) => w.id)).toEqual([
      'adc-tri-bush',
      'adc-river-pixel',
      'adc-lane-push-control',
      'adc-mid-swap-pink',
    ]);
    for (const w of [...blue, ...red]) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x).toBeLessThanOrEqual(1000);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeLessThanOrEqual(1000);
    }
    expect(blue[0]!.timing).toContain('2:15');
    expect(red[0]!.x).not.toBe(blue[0]!.x);
    expect(blue.filter((w) => w.kind === 'control')).toHaveLength(2);
  });

  it('plans a Lv2 all-in and flags a 2:15–2:55 gank window vs an early 3-camp jungler', () => {
    const plan = generateAdcGamePlan({
      playerChampionId: 119, // Draven
      allyRoles: { top: 86, jungle: 234, middle: 103, bottom: 119, utility: 89 },
      enemyRoles: { top: 86, jungle: 64, middle: 134, bottom: 222, utility: 89 }, // Lee Sin, Jinx + Leona
      mapSide: 'blue',
    });

    expect(plan.championName).toBe('Draven');
    expect(plan.wavePlan.minionSpawnSec).toBe(30);
    expect(plan.wavePlan.level2Rule).toMatch(/3 melee minions/);
    expect(plan.wavePlan.decision).toBe('push_lv2_all_in');
    expect(plan.botMatchupSummary.enemyBotLane?.confidence).toBe('likely');
    expect(plan.supportSynergyPlaybook.supportArchetype).toBe('engage');
    expect(plan.supportSynergyPlaybook.synergy?.isExplicitCombo).toBe(true);

    expect(plan.enemyJunglerThreat.enemyJunglerName).toBe('Lee Sin');
    expect(plan.enemyJunglerThreat.threatLevel).toBe('high');
    expect(plan.enemyJunglerThreat.dangerWindow).toEqual({
      startSec: 135,
      endSec: ADC_TIMINGS.scuttleSpawnSec,
      label: '2:15–2:55 early gank alert',
    });

    expect(plan.plateWindow.deadlineSec).toBe(840);
    expect(plan.dragonPriority.firstSpawnSec).toBe(300);
    expect(plan.midSwap.trigger).toMatch(/Bot Tier-1/);

    expect(plan.macroPhases.map((p) => [p.order, p.timeWindow])).toEqual([
      [1, '0:30–4:30'],
      [2, '4:30–14:00'],
      [3, '14:00–20:00'],
      [4, '20:00+'],
    ]);
    expect(plan.macroPhases[3]!.endSec).toBeNull();
    expect(plan.wardSpots).toHaveLength(4);
    expect(plan.primaryWinCondition).toMatch(/Level 2/);
    expect(plan.enemyWinConditionToDeny.length).toBeGreaterThan(0);
  });

  it('concedes Lv2 into a stronger duo and reads a top-side full-clear jungler as 2:45+', () => {
    const plan = generateAdcGamePlan({
      playerChampionId: 222, // Jinx
      allyRoles: { top: 86, bottom: 222, utility: 16 }, // Garen, Jinx + Soraka
      enemyRoles: { top: 122, jungle: 234, bottom: 81, utility: 117 }, // Darius, Viego, Ezreal + Lulu
      mapSide: 'red',
    });
    expect(plan.wavePlan.decision).toBe('concede_push_trim');
    expect(plan.enemyJunglerThreat.likelyFirstSide).toBe('top');
    expect(plan.enemyJunglerThreat.threatLevel).toBe('low');
    expect(plan.enemyJunglerThreat.dangerWindow.label).toBe('2:45+ pathing Bot');
    expect(plan.primaryWinCondition).toMatch(/Scale Jinx/);
    expect(plan.wardSpots[0]!.x).toBe(buildAdcWardSpots('red')[0]!.x);
  });
});

// ---------------------------------------------------------------------------
// Reactive itemization
// ---------------------------------------------------------------------------

describe('computeAdcAdaptiveBuild', () => {
  const jinx = findAdcChampionById(222)!;

  it('pivots into Mortal Reminder vs heavy healing', () => {
    const data = liveGame({
      selfItems: JINX_FIRST_ITEM,
      enemies: [player('Aatrox', 'CHAOS'), player('Soraka', 'CHAOS'), player('Sylas', 'CHAOS')],
    });
    const build = computeAdcAdaptiveBuild(data, jinx);
    expect(build.threats.healingThreat).toBe(true);
    expect(build.nextItem?.item.id).toBe(ADC_ITEM_IDS.mortalReminder);
    expect(build.reactivePivots.map((r) => r.item.id)).toContain(3033);
    // Last Whisper exclusivity: no LDR alongside Mortal Reminder.
    expect(allRecommendedIds(build)).not.toContain(ADC_ITEM_IDS.lordDominiks);
  });

  it("pivots into Lord Dominik's Regards vs 2+ tanks and Mercurial Scimitar (+QSS) vs heavy CC", () => {
    const data = liveGame({
      selfItems: JINX_FIRST_ITEM,
      gold: 1500,
      enemies: [player('Ornn', 'CHAOS'), player('Nautilus', 'CHAOS'), player('Leona', 'CHAOS')],
    });
    const build = computeAdcAdaptiveBuild(data, jinx);
    expect(build.threats.tankThreat).toBe(true);
    expect(build.threats.ccThreat).toBe(true);
    const pivots = build.reactivePivots.map((r) => r.item.id);
    expect(pivots).toEqual(expect.arrayContaining([3036, 3139]));
    const merc = build.reactivePivots.find((r) => r.item.id === ADC_ITEM_IDS.mercurialScimitar)!;
    expect(merc.reason).toMatch(/Quicksilver Sash/);
    expect(merc.affordableComponents.map((c) => c.id)).toContain(ADC_ITEM_IDS.quicksilverSash);
  });

  it('pivots into Immortal Shieldbow vs fed assassins / burst', () => {
    const data = liveGame({
      selfItems: JINX_FIRST_ITEM,
      enemies: [player('Zed', 'CHAOS', { kills: 6 }), player('Pyke', 'CHAOS', { kills: 4 })],
    });
    const build = computeAdcAdaptiveBuild(data, jinx);
    expect(build.threats.burstThreat).toBe(true);
    expect(build.threats.assassinCount).toBe(2);
    expect(build.nextItem?.item.id).toBe(ADC_ITEM_IDS.immortalShieldbow);
  });

  it('keeps the first core item first and recommends standard ADC boots', () => {
    const data = liveGame({ enemies: [player('Garen', 'CHAOS')] });
    const build = computeAdcAdaptiveBuild(data, jinx);
    expect(build.nextItem?.item.id).toBe(3032);
    expect(build.upcomingQueue[0]?.item.id).toBe(ADC_ITEM_IDS.berserkersGreaves);
  });

  it('never injects Chempunk Chainsword or jungle/tank items', () => {
    const data = liveGame({
      selfItems: JINX_FIRST_ITEM,
      enemies: [
        player('Aatrox', 'CHAOS', { kills: 5 }),
        player('Soraka', 'CHAOS'),
        player('Ornn', 'CHAOS'),
        player('Nautilus', 'CHAOS'),
        player('Zed', 'CHAOS', { kills: 5 }),
      ],
    });
    const build = computeAdcAdaptiveBuild(data, jinx);
    const ids = [
      ...allRecommendedIds(build),
      ...build.reactivePivots.map((r) => r.item.id),
      build.trinketAdvice.item.id,
    ];
    for (const id of ids) expect(ADC_FORBIDDEN_ITEM_IDS.has(id)).toBe(false);
    expect(ids).not.toContain(6609);
  });

  it('advises Stealth Ward early and Farsight Alteration on reset after Lv9 / 15:00', () => {
    const early = computeAdcAdaptiveBuild(liveGame({ enemies: [], level: 5, gameTime: 400 }), jinx);
    expect(early.trinketAdvice.item.id).toBe(ADC_ITEM_IDS.stealthWard);

    const late = computeAdcAdaptiveBuild(liveGame({ enemies: [], level: 9, gameTime: 700 }), jinx);
    expect(late.trinketAdvice.item.id).toBe(ADC_ITEM_IDS.farsightAlteration);
    expect(late.trinketAdvice.reason).toMatch(/face-check/);
  });
});

// ---------------------------------------------------------------------------
// Macro guidance
// ---------------------------------------------------------------------------

describe('computeAdcMacroGuidance', () => {
  const dragonSoon: ObjectiveWindow = {
    id: 'dragon',
    name: 'Elemental Dragon',
    status: 'upcoming',
    secondsRemaining: 90,
    nextSpawnFormatted: '11:00',
    priority: 'high',
    actionText: '',
  };

  it('cues a B.F. Sword recall spike at >= 1300g ahead of the next objective', () => {
    const cues = computeAdcMacroGuidance(liveGame({ enemies: [], gold: 1350, gameTime: 570 }), null, [dragonSoon]);
    const recall = cues.find((c) => c.id === 'adc-recall-spike');
    expect(recall).toBeDefined();
    expect(recall!.title).toMatch(/1350g ahead of Elemental Dragon/);
  });

  it('skips the recall cue below 1300g or when the objective is < 35s away', () => {
    const low = computeAdcMacroGuidance(liveGame({ enemies: [], gold: 1200 }), null, [dragonSoon]);
    expect(low.some((c) => c.id === 'adc-recall-spike')).toBe(false);

    const imminent = computeAdcMacroGuidance(liveGame({ enemies: [], gold: 2000 }), null, [
      { ...dragonSoon, status: 'prep_vision', secondsRemaining: 20 },
    ]);
    expect(imminent.some((c) => c.id === 'adc-recall-spike')).toBe(false);
    expect(imminent.some((c) => c.id === 'adc-obj-setup')).toBe(true);
  });

  it('compares CS/min to the personal ADC baseline, falling back to the division prior', () => {
    const data = liveGame({ enemies: [], selfCs: 50, gameTime: 600 }); // 5.0 CS/min
    const personal = computeAdcMacroGuidance(data, null, [], { adcMatchCount: 12, csPerMinBaseline: 7.2 });
    const cue = personal.find((c) => c.id === 'adc-cs-pace')!;
    expect(cue.priority).toBe('high');
    expect(cue.title).toMatch(/personal baseline/);

    expect(resolveAdcCsTarget({ adcMatchCount: 2, csPerMinBaseline: 9, targetDivision: 'gold' })).toEqual({
      target: 6.5,
      source: 'division',
    });
  });

  it('emits the 14:00 plate deadline and the Bot → Mid swap once Bot Tier-1 falls', () => {
    const plan = generateAdcGamePlan({
      playerChampionId: 222,
      allyRoles: { bottom: 222, utility: 117 },
      enemyRoles: { bottom: 51, utility: 99 },
      mapSide: 'blue',
    });
    const plates = computeAdcMacroGuidance(liveGame({ enemies: [], gameTime: 760 }), plan, []);
    const deadline = plates.find((c) => c.id === 'adc-plate-deadline')!;
    expect(deadline.priority).toBe('urgent');
    expect(deadline.title).toMatch(/14:00/);

    const swapped = computeAdcMacroGuidance(
      liveGame({
        enemies: [],
        gameTime: 700,
        events: [
          { EventID: 1, EventName: 'TurretKilled', EventTime: 690, TurretKilled: 'Turret_T2_R_03_A' } as LiveEvent,
        ],
      }),
      plan,
      []
    );
    const swap = swapped.find((c) => c.id === 'adc-mid-swap')!;
    expect(swap.priority).toBe('high');
    expect(swap.detail).toBe(plan.midSwap.instruction);
  });

  it('only builds the live context from public Live Client fields', () => {
    const ctx = buildAdcLiveContext(liveGame({ enemies: [], gold: 999.7, selfCs: 80 }));
    expect(Object.keys(ctx).sort()).toEqual(
      ['botTier1Destroyed', 'creepScore', 'currentGold', 'gameTime', 'level', 'team', 'wardScore'].sort()
    );
    expect(ctx.currentGold).toBe(999);
    expect(computeAdcMacroCues(ctx, null, []).length).toBeGreaterThan(0);
  });

  it('statically forbids hidden game state on AdcLiveContext (Riot compliance)', () => {
    const base: AdcLiveContext = {
      gameTime: 600,
      currentGold: 0,
      level: 8,
      creepScore: 60,
      wardScore: 4,
      team: 'ORDER',
      botTier1Destroyed: false,
    };
    // @ts-expect-error enemy cooldowns are hidden information
    const a: AdcLiveContext = { ...base, enemyCooldowns: { flash: 120 } };
    // @ts-expect-error enemy summoner spell timers are hidden information
    const b: AdcLiveContext = { ...base, enemySpellTimers: [300] };
    // @ts-expect-error enemy positions in fog are hidden information
    const c: AdcLiveContext = { ...base, enemyPositions: [{ x: 1, y: 2 }] };
    // @ts-expect-error fog-of-war units are hidden information
    const d: AdcLiveContext = { ...base, fogOfWarUnits: [] };
    // @ts-expect-error enemy ward positions are hidden information
    const e: AdcLiveContext = { ...base, enemyWardPositions: [] };
    expect([a, b, c, d, e]).toHaveLength(5);
  });
});
