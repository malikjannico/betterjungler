import { describe, expect, it } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import {
  analyzePostGameMatch,
  normalizeRiotCoordinate,
  toMatchSummaryRecord,
} from './postGameReviewEngine';

describe('postGameReviewEngine', () => {
  it('normalizes Riot Match-V5 coordinates (bot-left origin) to SVG [0..1000] (top-left origin)', () => {
    expect(normalizeRiotCoordinate(0, 0)).toEqual({ x: 0, y: 1000 });
    expect(normalizeRiotCoordinate(14870, 14870)).toEqual({ x: 1000, y: 0 });
    expect(normalizeRiotCoordinate(7435, 7435)).toEqual({ x: 500, y: 500 });
  });

  it('produces high grade, highlights, and zero pre-objective deaths on clean Viego win', () => {
    const winMatch = DEMO_POST_GAME_MATCHES[0]!;
    const report = analyzePostGameMatch(winMatch, 'PLATINUM IV');

    expect(report.kpis.preObjectiveDeaths).toBe(0);
    expect(report.kpis.goldDiffAt15).toBeGreaterThan(500);
    expect(report.kpis.objectiveSharePct).toBe(75);
    expect(['S', 'A']).toContain(report.grade);
    expect(report.highlights.length).toBeGreaterThanOrEqual(3);
    expect(report.pathPoints.length).toBe(winMatch.frames.length);
    expect(report.markers.length).toBeGreaterThanOrEqual(5);

    const summary = toMatchSummaryRecord(winMatch, report);
    expect(summary.matchId).toBe(winMatch.matchId);
    expect(summary.preObjectiveDeaths).toBe(0);
  });

  it('flags pre-objective deaths, low control wards, and actionable improvements on Amumu loss', () => {
    const lossMatch = DEMO_POST_GAME_MATCHES[1]!;
    const report = analyzePostGameMatch(lossMatch, 'PLATINUM IV');

    expect(report.kpis.preObjectiveDeaths).toBe(3);
    expect(report.mistakes.some((m) => m.id === 'mk-pre-obj-death')).toBe(true);
    expect(report.mistakes.some((m) => m.id === 'mk-vision')).toBe(true);
    expect(report.improvements.length).toBeGreaterThanOrEqual(2);
    expect(report.markers.some((m) => m.kind === 'pre_obj_death')).toBe(true);
  });
});
