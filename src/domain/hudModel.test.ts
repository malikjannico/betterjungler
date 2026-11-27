import { describe, expect, it } from 'vitest';
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
  });
});
