import { describe, expect, it } from 'vitest';
import { DEMO_LP_HISTORY, DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import {
  aggregateDeathHeatmap,
  buildGoldXpSeries,
  computeLpDeltaSummary,
} from './trendAnalyticsEngine';

describe('trendAnalyticsEngine', () => {
  it('builds minute-by-minute Gold & XP diff series and peak lead', () => {
    const winMatch = DEMO_POST_GAME_MATCHES[0]!;
    const summary = buildGoldXpSeries(winMatch);

    expect(summary.points.length).toBe(winMatch.frames.length);
    expect(summary.maxLead).toBeGreaterThan(2000);
    expect(summary.points.find((p) => p.minute === 15)?.goldDiff).toBe(920);
  });

  it('aggregates multi-game death heatmap and detects pre-objective danger zones', () => {
    const heatmap = aggregateDeathHeatmap(DEMO_POST_GAME_MATCHES);

    expect(heatmap.totalDeaths).toBe(5);
    expect(heatmap.preObjectiveDeaths).toBe(4);
    expect(heatmap.topDangerZone).not.toBeNull();
    expect(heatmap.zoneCounts['Top River / Baron']).toBeGreaterThanOrEqual(2);
  });

  it('computes net LP gain and current streak from LP history', () => {
    const summary = computeLpDeltaSummary(DEMO_LP_HISTORY);

    expect(summary.netLpChange).toBe(122);
    expect(summary.streakText).toBe('3W streak');
    expect(summary.currentLabel).toContain('GOLD II');
  });
});
