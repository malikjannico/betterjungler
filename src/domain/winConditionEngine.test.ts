import { describe, expect, it } from 'vitest';
import { generateWinConditionPlan } from './winConditionEngine';

describe('winConditionEngine', () => {
  it('generates Blue-side win condition plan, routes, and ward spots', () => {
    const plan = generateWinConditionPlan({
      allyRoles: { top: 58, jungle: 234, middle: 61, bottom: 145, utility: 111 },
      enemyRoles: { top: 266, jungle: 56, middle: 517, bottom: 222, utility: 16 },
      playerChampionId: 234,
      mapSide: 'blue',
    });

    expect(plan.primaryWinCondition.length).toBeGreaterThan(20);
    expect(plan.enemyWinConditionToDeny.length).toBeGreaterThan(20);
    expect(plan.strongSide).toBe('bot');
    expect(plan.routes.length).toBeGreaterThanOrEqual(2);
    expect(plan.routes[0]?.side).toBe('blue');
    for (const step of plan.routes[0]!.steps) {
      expect(step.x).toBeGreaterThanOrEqual(0);
      expect(step.x).toBeLessThanOrEqual(1000);
      expect(step.y).toBeGreaterThanOrEqual(0);
      expect(step.y).toBeLessThanOrEqual(1000);
    }
    expect(plan.wardSpots.length).toBeGreaterThanOrEqual(4);
    expect(plan.enemyJunglePlaybook.enemyChampionName).toBe('Nocturne');
    expect(['low', 'medium', 'high']).toContain(plan.enemyJunglePlaybook.invadeRisk);
    expect(plan.enemyJunglePlaybook.wardTarget115.length).toBeGreaterThan(10);
    expect(plan.laneGankability.map((l) => l.lane)).toEqual(['top', 'middle', 'bottom']);
  });

  it('generates Red-side routes when playing on red side', () => {
    const plan = generateWinConditionPlan({
      allyRoles: { top: 122, jungle: 64, middle: 103, bottom: 81, utility: 117 },
      enemyRoles: { top: 516, jungle: 32, middle: 134, bottom: 21, utility: 89 },
      playerChampionId: 64,
      mapSide: 'red',
    });

    const recommended = plan.routes.find((r) => r.id === plan.recommendedRouteId);
    expect(recommended).toBeDefined();
    expect(recommended?.side).toBe('red');
    expect(recommended?.style).toBe('three_camp_gank');
  });
});
