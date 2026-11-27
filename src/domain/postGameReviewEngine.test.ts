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
    expect(report.kpis.csAt5).toBeGreaterThan(0);
    expect(report.kpis.csAt10).toBeGreaterThan(report.kpis.csAt5!);
    expect(report.kpis.goldDiffAt15).toBeGreaterThan(500);
    expect(report.kpis.objectiveSharePct).toBe(75);
    expect(['S', 'A']).toContain(report.grade);
    expect(report.highlights.length).toBeGreaterThanOrEqual(3);
    expect(report.pathPoints.length).toBe(winMatch.frames.length);
    expect(report.enemyPathPoints.length).toBe(winMatch.frames.length);
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

  it('handles Match-V5 WARD_PLACED events lacking position without crashing', () => {
    const matchWithNullWardPos = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      events: [
        ...DEMO_POST_GAME_MATCHES[0]!.events,
        {
          type: 'WARD_PLACED' as const,
          timestampSec: 410,
          creatorId: DEMO_POST_GAME_MATCHES[0]!.playerParticipantId,
          wardType: 'CONTROL_WARD',
        },
      ],
    };

    const report = analyzePostGameMatch(matchWithNullWardPos, 'PLATINUM IV');
    expect(report.kpis.controlWardsBought).toBe(matchWithNullWardPos.controlWardsBought);
    expect(report.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))).toBe(true);
  });

  it('safely handles null frame positions and non-finite coordinates', () => {
    expect(normalizeRiotCoordinate(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      x: 500,
      y: 500,
    });

    const base = DEMO_POST_GAME_MATCHES[0]!;
    const corruptFramesMatch = {
      ...base,
      frames: base.frames.map((frame, idx) =>
        idx === 1
          ? {
              ...frame,
              position: null as unknown as { x: number; y: number },
              enemyJunglerPosition: { x: Number.NaN, y: 2000 },
            }
          : frame
      ),
    };

    const report = analyzePostGameMatch(corruptFramesMatch, 'PLATINUM IV');
    expect(report.pathPoints.length).toBe(base.frames.length - 1);
    expect(report.enemyPathPoints.length).toBe(base.frames.length - 1);
    expect(
      report.pathPoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ).toBe(true);
  });

  it('never extrapolates missing @4 or @10 CS frames or leaks undefined into findings', () => {
    const base = DEMO_POST_GAME_MATCHES[0]!;
    const missing4And10 = {
      ...base,
      frames: base.frames.filter((f) => f.minute !== 4 && f.minute !== 10),
    };
    const report = analyzePostGameMatch(missing4And10, 'PLATINUM IV');
    expect(report.kpis.csAt4).toBeUndefined();
    expect(report.kpis.csAt10).toBeUndefined();
    expect(report.kpis.csAt10Minute).toBeUndefined();
    for (const f of [...report.highlights, ...report.mistakes, ...report.improvements]) {
      expect(f.detail).not.toContain('undefined');
    }
  });
});
