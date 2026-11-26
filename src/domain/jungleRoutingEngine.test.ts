import { describe, expect, it } from 'vitest';
import {
  buildMultiClearRoutes,
  buildOfficialWardSpots,
  selectLiveActiveRoute,
} from './jungleRoutingEngine';
import { computeObjectiveWindows } from './liveCoachEngine';

describe('jungleRoutingEngine', () => {
  it('builds all 4 jungle clear stages with exact official map11.png coordinates', () => {
    const blueRoutes = buildMultiClearRoutes('blue', 'bot', 'full_clear');
    expect(blueRoutes.some((r) => r.stage === 'clear_1')).toBe(true);
    expect(blueRoutes.some((r) => r.stage === 'clear_2')).toBe(true);
    expect(blueRoutes.some((r) => r.stage === 'objective_sync')).toBe(true);
    expect(blueRoutes.some((r) => r.stage === 'late_baron')).toBe(true);

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

  it('dynamically switches active route as live game time and objectives progress', () => {
    const routes = buildMultiClearRoutes('blue', 'bot', 'full_clear');

    // Early game (< 3:55) -> Clear 1
    const c1 = selectLiveActiveRoute(120, [], routes);
    expect(c1.stage).toBe('clear_1');

    // Second clear window (4:15 = 255s) -> Clear 2 Respawn Sequence
    const c2 = selectLiveActiveRoute(255, [], routes);
    expect(c2.stage).toBe('clear_2');

    // Mid-early (8:00 = 480s) with Dragon next -> Dragon Objective Sync
    const objs = computeObjectiveWindows(480, []);
    const c3 = selectLiveActiveRoute(480, objs, routes);
    expect(c3.stage).toBe('objective_sync');

    // Late game (24:00 = 1440s) -> Late Baron / Cross-Map
    const c4 = selectLiveActiveRoute(1440, [], routes);
    expect(c4.stage).toBe('late_baron');
  });
});
