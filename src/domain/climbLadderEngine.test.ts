import { describe, expect, it } from 'vitest';
import {
  evaluateDivisionProgress,
  evaluateFocusGoalAgainstMatch,
  isSessionTilting,
  parseTargetTier,
  setSingleFocusGoal,
  syncGoalsWithRollingProgress,
} from './climbLadderEngine';
import { DEMO_POST_GAME_MATCHES, DEMO_ROLLING_SUMMARIES } from './postGameFixtures';

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

  it('enforces a single Match Focus goal and grades PASS / MISS against post-game KPIs', () => {
    const goals = [
      {
        id: 'focus-cs',
        targetDivision: 'PLATINUM IV',
        metric: 'csPerMin' as const,
        title: 'Reach 6.5 CS/m',
        targetValue: 6.5,
        currentValue: 6.1,
        unit: 'CS/m',
        lowerIsBetter: false,
        status: 'active' as const,
        source: 'auto' as const,
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      {
        id: 'focus-deaths',
        targetDivision: 'PLATINUM IV',
        metric: 'preObjectiveDeaths' as const,
        title: 'Cap pre-objective deaths at 1',
        targetValue: 1,
        currentValue: 2,
        unit: 'deaths',
        lowerIsBetter: true,
        status: 'active' as const,
        source: 'custom' as const,
        createdAt: '2026-11-27T00:00:00.000Z',
        isFocusGoal: true,
      },
    ];

    const switched = setSingleFocusGoal(goals, 'focus-cs');
    expect(switched.find((g) => g.id === 'focus-cs')?.isFocusGoal).toBe(true);
    expect(switched.find((g) => g.id === 'focus-deaths')?.isFocusGoal).toBe(false);

    const toggledOff = setSingleFocusGoal(switched, 'focus-cs');
    expect(toggledOff.every((g) => !g.isFocusGoal)).toBe(true);

    const passEval = evaluateFocusGoalAgainstMatch(switched[0]!, {
      csPerMin: 7.1,
      goldDiffAt15: 400,
      objectiveSharePct: 60,
      preObjectiveDeaths: 0,
      visionPerMin: 1.2,
      killParticipationPct: 65,
    });
    expect(passEval.passed).toBe(true);

    const missEval = evaluateFocusGoalAgainstMatch(goals[1]!, {
      csPerMin: 5.5,
      goldDiffAt15: -200,
      objectiveSharePct: 40,
      preObjectiveDeaths: 3,
      visionPerMin: 0.7,
      killParticipationPct: 50,
    });
    expect(missEval.passed).toBe(false);
  });

  it('triggers calm session stop-loss guard strictly on 3 consecutive recent losses within a 4h session window', () => {
    const refNow = Date.parse('2026-11-27T20:30:00Z');
    expect(
      isSessionTilting([{ win: false }, { win: false }, { win: false }, { win: true }])
    ).toBe(true);
    expect(isSessionTilting([{ win: true }, { win: false }, { win: false }])).toBe(false);
    expect(isSessionTilting([{ win: false }, { win: false }])).toBe(false);
    // 3 losses spaced > 4 hours apart should NOT trigger tilt guard
    expect(
      isSessionTilting(
        [
          { win: false, playedAt: '2026-11-27T20:00:00Z' },
          { win: false, playedAt: '2026-11-27T19:00:00Z' },
          { win: false, playedAt: '2026-11-27T12:00:00Z' },
        ],
        refNow
      )
    ).toBe(false);
    // 3 losses from last week should NOT trigger tilt guard today
    expect(
      isSessionTilting(
        [
          { win: false, playedAt: '2026-11-20T20:00:00Z' },
          { win: false, playedAt: '2026-11-20T19:00:00Z' },
          { win: false, playedAt: '2026-11-20T18:00:00Z' },
        ],
        refNow
      )
    ).toBe(false);
    // 3 losses within 4 hours DO trigger tilt guard regardless of array order
    expect(
      isSessionTilting(
        [
          { win: false, playedAt: '2026-11-27T17:30:00Z' },
          { win: false, playedAt: '2026-11-27T19:30:00Z' },
          { win: false, playedAt: '2026-11-27T18:30:00Z' },
        ],
        refNow
      )
    ).toBe(true);
    expect(isSessionTilting(DEMO_POST_GAME_MATCHES)).toBe(false);
  });
});
