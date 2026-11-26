import { describe, expect, it } from 'vitest';
import { evaluateDivisionProgress, parseTargetTier } from './climbLadderEngine';
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
});
