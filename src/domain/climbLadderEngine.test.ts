import { describe, expect, it } from 'vitest';
import {
  evaluateDivisionProgress,
  parseTargetTier,
  syncGoalsWithRollingProgress,
} from './climbLadderEngine';
import { DEMO_ROLLING_SUMMARIES } from './postGameFixtures';

describe('climbLadderEngine', () => {
  it('parses target division strings into benchmark tiers', () => {
    expect(parseTargetTier('PLATINUM IV')).toBe('PLATINUM');
    expect(parseTargetTier('Diamond II')).toBe('DIAMOND');
    expect(parseTargetTier('Master')).toBe('MASTER');
  });

  it('identifies bottlenecks and generates top 3 focused climb goals', () => {
    const evaluation = evaluateDivisionProgress(DEMO_ROLLING_SUMMARIES, 'PLATINUM IV');

    expect(evaluation.targetTier).toBe('PLATINUM');
    expect(evaluation.matchCount).toBe(DEMO_ROLLING_SUMMARIES.length);
    expect(evaluation.comparisons.length).toBe(6);

    const preObjComp = evaluation.comparisons.find(
      (c) => c.metric === 'preObjectiveDeaths'
    );
    expect(preObjComp?.lowerIsBetter).toBe(true);
    expect(preObjComp?.status).not.toBe('on_track');

    expect(evaluation.suggestedGoals.length).toBeGreaterThanOrEqual(1);
    expect(evaluation.suggestedGoals.length).toBeLessThanOrEqual(3);
  });

  it('auto-syncs active goals against rolling progress and marks met targets completed', () => {
    const evaluation = evaluateDivisionProgress(DEMO_ROLLING_SUMMARIES, 'PLATINUM IV');
    const synced = syncGoalsWithRollingProgress(
      [
        {
          id: 'g-cs',
          targetDivision: 'PLATINUM IV',
          metric: 'csPerMin',
          title: 'Reach 5.0 CS/m',
          targetValue: 5.0,
          currentValue: 4.5,
          unit: 'CS/m',
          lowerIsBetter: false,
          status: 'active',
          source: 'custom',
          createdAt: '2026-11-26T00:00:00.000Z',
        },
        {
          id: 'g-deaths',
          targetDivision: 'PLATINUM IV',
          metric: 'preObjectiveDeaths',
          title: 'Zero pre-objective deaths',
          targetValue: 0,
          currentValue: 2,
          unit: 'deaths',
          lowerIsBetter: true,
          status: 'active',
          source: 'custom',
          createdAt: '2026-11-26T00:00:00.000Z',
        },
      ],
      evaluation.comparisons
    );

    const csGoal = synced.find((g) => g.id === 'g-cs');
    const deathGoal = synced.find((g) => g.id === 'g-deaths');
    expect(csGoal?.status).toBe('completed');
    expect(deathGoal?.status).toBe('active');

    const frozenWithoutMatches = syncGoalsWithRollingProgress(
      [csGoal!].map((g) => ({ ...g, status: 'active' as const })),
      evaluation.comparisons,
      false
    );
    expect(frozenWithoutMatches[0]?.status).toBe('active');
  });
});
