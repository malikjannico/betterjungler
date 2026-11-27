import { describe, expect, it } from 'vitest';
import {
  buildMultiClearRoutes,
  buildOfficialWardSpots,
  pickFirstClear,
  selectLiveActiveRoute,
} from './jungleRoutingEngine';
import { computeObjectiveWindows } from './liveCoachEngine';

describe('jungleRoutingEngine', () => {
  it('builds strictly 4 routes (one per Clear number 1..4) with exact official map11.png coordinates', () => {
    const blueRoutes = buildMultiClearRoutes('blue', 'bot', 'full_clear');
    expect(blueRoutes).toHaveLength(4);
    expect(blueRoutes.map((r) => r.clearNumber)).toEqual([1, 2, 3, 4]);
    expect(blueRoutes.map((r) => r.shortLabel)).toEqual([
      'Clear 1',
      'Clear 2',
      'Clear 3',
      'Clear 4',
    ]);
    expect(blueRoutes.map((r) => r.stage)).toEqual([
      'clear_1',
      'clear_2',
      'objective_sync',
      'late_baron',
    ]);

    for (const route of blueRoutes) {
      expect(route.whyThisClear.length).toBeGreaterThan(15);
      for (const step of route.steps) {
        expect(step.x).toBeGreaterThanOrEqual(0);
        expect(step.x).toBeLessThanOrEqual(1000);
        expect(step.y).toBeGreaterThanOrEqual(0);
        expect(step.y).toBeLessThanOrEqual(1000);
      }
    }

    const redWards = buildOfficialWardSpots('red');
    expect(redWards.length).toBeGreaterThanOrEqual(4);
  });

  it('dynamically swaps Clear 3 and adapts Clear 2 to Clear 1 style', () => {
    const fullClearRoutes = buildMultiClearRoutes('blue', 'bot', 'full_clear');
    expect(fullClearRoutes[1]?.id).toContain('respawn');

    const threeCampRoutes = buildMultiClearRoutes('red', 'top', 'three_camp_gank');
    expect(threeCampRoutes[0]?.id).toBe('red-clear1-3camp');
    expect(threeCampRoutes[0]?.steps.map((s) => s.campName)).toEqual([
      'Red Buff',
      'Raptors',
      'Krugs',
      'Gank Top / Invade',
    ]);
    expect(threeCampRoutes[1]?.id).toContain('cleanup');

    // Early game (< 3:20) -> Clear 1
    expect(selectLiveActiveRoute(120, [], fullClearRoutes).stage).toBe('clear_1');
    // Second clear window (4:05 = 245s) -> Clear 2
    expect(selectLiveActiveRoute(245, [], fullClearRoutes).stage).toBe('clear_2');
    // Mid-early (8:00 = 480s) with Dragon next -> Dragon Objective Sync
    const objs = computeObjectiveWindows(480, []);
    const c3 = selectLiveActiveRoute(480, objs, fullClearRoutes);
    expect(c3.stage).toBe('objective_sync');
    expect(c3.objectiveFocus).toBe('dragon');
    // Late game (24:00 = 1440s) -> Late Baron / Cross-Map
    expect(selectLiveActiveRoute(1440, [], fullClearRoutes).stage).toBe('late_baron');

    const decision = pickFirstClear({
      strongSide: 'bot',
      strongLanePriority: 6,
      invadeRisk: 'high',
    });
    expect(decision.style).toBe('full_clear');

    const midRoutes = buildMultiClearRoutes('blue', 'mid', 'full_clear');
    expect(midRoutes[0]?.descriptor).toContain('Mid Focus');
  });
});
