import { describe, expect, it } from 'vitest';
import { generateAdcGamePlan } from './adc/adcGamePlanEngine';
import { deriveHudCards } from './hudModel';
import { buildMultiClearRoutes } from './jungleRoutingEngine';

describe('hudModel', () => {
  it('shows only armed status chip when idle without fake placeholders', () => {
    const model = deriveHudCards({
      phase: 'idle',
      gameTime: 0,
      objectives: [],
      buildPlan: null,
      topCue: null,
      openingRoute: null,
      hotkey: 'Alt+J',
    });

    expect(model.statusChip.label).toBe('HUD armed · appears in game');
    expect(model.routeCard).toBeNull();
    expect(model.objectiveCard).toBeNull();
    expect(model.buyCard).toBeNull();
    expect(model.cueCard).toBeNull();
  });

  it('shows opening Clear 1 route card before 1:30 and switches to Objective + Buy afterwards', () => {
    const clear1 = buildMultiClearRoutes('blue', 'bot', 'full_clear')[0]!;
    const early = deriveHudCards({
      phase: 'in_game',
      gameTime: 45,
      objectives: [
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'upcoming',
          secondsRemaining: 255,
          nextSpawnFormatted: '5:00',
          priority: 'medium',
          actionText: 'Path bot',
        },
      ],
      buildPlan: null,
      topCue: null,
      openingRoute: clear1,
      hotkey: 'Alt+J',
    });

    expect(early.routeCard).not.toBeNull();
    expect(early.objectiveCard).toBeNull();

    const mid = deriveHudCards({
      phase: 'in_game',
      gameTime: 620,
      objectives: [
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'prep_vision',
          secondsRemaining: 42,
          nextSpawnFormatted: '11:02',
          priority: 'high',
          actionText: 'Drop vision',
        },
      ],
      buildPlan: {
        threats: {
          healingThreat: false,
          apThreat: false,
          adThreat: true,
          critThreat: false,
          tankThreat: false,
          ccThreat: false,
          reasons: [],
        },
        nextItem: {
          item: { id: 6672, name: 'Kraken Slayer', cost: 3100, tags: [], shortReason: '' },
          reason: 'Core',
          affordableNow: false,
          goldNeeded: 420,
          affordableComponents: [],
        },
        upcomingQueue: [],
        trinketAdvice: {
          item: { id: 3364, name: 'Oracle Lens', cost: 0, tags: ['trinket'], shortReason: '' },
          reason: 'Sweep',
        },
        consumableAdvice: [],
        isFullBuild: false,
        fullBuildAlternatives: [],
      },
      topCue: {
        id: 'cue-1',
        category: 'objective',
        priority: 'urgent',
        title: 'Setup Dragon Vision',
        detail: 'Sweep river pit before spawn.',
      },
      openingRoute: clear1,
      hotkey: 'Alt+J',
    });

    expect(mid.routeCard).toBeNull();
    expect(mid.objectiveCard?.kind).toBe('dragon');
    expect(mid.objectiveCard?.shortName).toBe('DRG');
    expect(mid.objectiveCard?.actionChip).toBe('RESET · WARD · SWEEP');
    expect(mid.objectiveCard?.timerText).toBe('0:42');
    expect(mid.buyCard?.goldStatusText).toBe('−420g');
    expect(mid.cueCard?.urgent).toBe(true);

    const earlyPostRoute = deriveHudCards({
      phase: 'in_game',
      gameTime: 150,
      objectives: [
        {
          id: 'scuttle',
          name: 'Rift Scuttler',
          status: 'live',
          secondsRemaining: 0,
          nextSpawnFormatted: '03:30',
          priority: 'high',
          actionText: 'Secure top/bot river crab',
        },
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'upcoming',
          secondsRemaining: 150,
          nextSpawnFormatted: '05:00',
          priority: 'medium',
          actionText: 'Track first spawn',
        },
      ],
      buildPlan: null,
      topCue: null,
      openingRoute: clear1,
      hotkey: 'Alt+J',
    });

    expect(earlyPostRoute.objectiveCard?.kind).toBe('scuttle');
    expect(earlyPostRoute.objectiveCard?.shortName).toBe('SCT');
    expect(earlyPostRoute.objectiveCard?.secondary?.kind).toBe('dragon');
    expect(earlyPostRoute.objectiveCard?.secondary?.shortName).toBe('DRG');

    // Off-role live mode hides opening route, build buyCard, and jungle cueCard while keeping global objectives
    const offRoleHud = deriveHudCards({
      phase: 'in_game',
      gameTime: 45,
      objectives: earlyPostRoute.objectiveCard ? [
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'upcoming',
          secondsRemaining: 255,
          nextSpawnFormatted: '5:00',
          priority: 'medium',
          actionText: 'Global objective',
        },
      ] : [],
      buildPlan: null,
      topCue: {
        id: 'c1',
        category: 'clear',
        priority: 'urgent',
        title: 'Jungle Cue',
        detail: 'Should be suppressed off-role',
      },
      openingRoute: clear1,
      hotkey: 'Alt+J',
      isOffRole: true,
    });
    expect(offRoleHud.statusChip.isOffRole).toBe(true);
    expect(offRoleHud.routeCard).toBeNull();
    expect(offRoleHud.buyCard).toBeNull();
    expect(offRoleHud.cueCard).toBeNull();
    expect(offRoleHud.objectiveCard?.shortName).toBe('DRG');

    // Coached ADC live mode hides jungle opening route/Smite while showing Objective + ADC Next Item + ADC Cue
    const adcHud = deriveHudCards({
      phase: 'in_game',
      gameTime: 650,
      objectives: [
        {
          id: 'dragon',
          name: 'Elemental Dragon',
          status: 'prep_vision',
          secondsRemaining: 42,
          nextSpawnFormatted: '11:32',
          priority: 'high',
          actionText: 'Shove bot wave',
        },
      ],
      buildPlan: {
        threats: {
          healingThreat: false,
          apThreat: false,
          adThreat: true,
          critThreat: false,
          tankThreat: false,
          ccThreat: false,
          reasons: [],
        },
        nextItem: {
          item: { id: 3032, name: 'Yun Tal Wildarrows', cost: 3000, tags: [], shortReason: '' },
          reason: 'Core',
          affordableNow: false,
          goldNeeded: 650,
          affordableComponents: [],
        },
        upcomingQueue: [],
        trinketAdvice: {
          item: { id: 3363, name: 'Farsight Alteration', cost: 0, tags: ['trinket'], shortReason: '' },
          reason: 'Safe ward',
        },
        consumableAdvice: [],
        isFullBuild: false,
        fullBuildAlternatives: [],
      },
      topCue: {
        id: 'adc-recall-spike',
        category: 'clear',
        priority: 'high',
        title: 'Recall spike: 1350g',
        detail: 'B.F. Sword spike — crash wave and reset.',
      },
      openingRoute: clear1,
      hotkey: 'Alt+J',
      activeRole: 'bottom',
    });
    expect(adcHud.statusChip.isOffRole).toBe(false);
    expect(adcHud.statusChip.activeRole).toBe('bottom');
    expect(adcHud.routeCard).toBeNull();
    expect(adcHud.objectiveCard?.shortName).toBe('DRG');
    expect(adcHud.buyCard?.itemId).toBe(3032);
    expect(adcHud.cueCard?.title).toContain('Recall spike');
  });

  it('derives CS/min vs target, Skill Order, and Lv2/Macro Game Plan widgets for coached roles and suppresses them on off-role', () => {
    const adcPlan = generateAdcGamePlan({
      playerChampionId: 145, // Kai'Sa
      allyRoles: { bottom: 145, utility: 89 },
      enemyRoles: { jungle: 64, bottom: 222, utility: 117 },
      mapSide: 'blue',
    });
    const adcFull = deriveHudCards({
      phase: 'in_game',
      gameTime: 180,
      objectives: [],
      buildPlan: null,
      topCue: null,
      openingRoute: null,
      hotkey: 'Alt+J',
      activeRole: 'bottom',
      creepScore: 24,
      targetCsPerMin: 7.2,
      targetDivisionLabel: 'EMERALD IV',
      skillOrder: {
        championName: "Kai'Sa",
        nextSkill: 'W',
        unspentPoints: 1,
        currentLevels: { Q: 1, W: 0, E: 0, R: 0 },
        maxOrderLabel: 'R > Q > E > W',
        priorityList: ['R', 'Q', 'E', 'W'],
        promptLabel: 'LEVEL W NOW',
      },
      adcWinPlan: adcPlan,
    });

    expect(adcFull.csCard?.csPerMin).toBe(8);
    expect(adcFull.csCard?.status).toBe('ahead');
    expect(adcFull.skillOrderCard?.nextSkill).toBe('W');
    expect(adcFull.gamePlanCard?.phaseTitle).toBe('Level-2 Plan');
    expect(adcFull.gamePlanCard?.powerSpikeLabel.length).toBeGreaterThan(4);

    const offRole = deriveHudCards({
      phase: 'in_game',
      gameTime: 180,
      objectives: [],
      buildPlan: null,
      topCue: null,
      openingRoute: null,
      hotkey: 'Alt+J',
      activeRole: 'off_role',
      creepScore: 24,
      skillOrder: adcFull.skillOrderCard,
      adcWinPlan: null,
    });
    expect(offRole.csCard).toBeNull();
    expect(offRole.skillOrderCard).toBeNull();
    expect(offRole.gamePlanCard).toBeNull();
  });
});
