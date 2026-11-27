import { describe, expect, it } from 'vitest';
import { evaluateFocusGoalAgainstMatch } from './climbLadderEngine';
import { DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import {
  analyzeMultiSessionTilt,
  classifyMistakeConfidence,
  computeEwmBaseline,
  computePercentile,
  computePersonalLearningSnapshot,
  computeWilsonLowerBound,
  detectMatchMistakeSignatures,
} from './personalLearningEngine';

// Deterministic Mulberry32 PRNG for reproducible Monte Carlo calibration verification
function makePrng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('personalLearningEngine', () => {
  it('weights recent games higher in EWMA, shrinks toward tier prior, and computes quartile bands', () => {
    // Newest 4 games are 7.6 CS/min, older 4 games are 5.6 CS/min
    const res = computeEwmBaseline([7.6, 7.6, 7.6, 7.6, 5.6, 5.6, 5.6, 5.6], 6.6, 8, 6);
    expect(res.ewm).toBeGreaterThan(6.6);
    expect(res.ewm).toBeLessThan(7.2);
    expect(res.shrunk).toBeGreaterThan(6.6);
    expect(res.shrunk).toBeLessThan(res.ewm);
    expect(res.recentDelta).toBeGreaterThan(1.0);

    // Fewer than 6 samples reports 0 trendDelta instead of comparing against own EWMA
    expect(computeEwmBaseline([7.0, 6.2, 6.0], 6.6).recentDelta).toBe(0);

    expect(computePercentile([4, 6, 8, 10], 0.25)).toBeCloseTo(5.5, 5);
    expect(computePercentile([4, 6, 8, 10], 0.5)).toBeCloseTo(7.0, 5);
    expect(computePercentile([4, 6, 8, 10], 0.75)).toBeCloseTo(8.5, 5);
  });

  it('meets <5% false-positive Confirmed rate under null variance (n=15, 19 & 25) and >=80% recall across 1,000 independent seeds', () => {
    const seeds = 1000;
    const pNull = 0.15;

    for (const sampleSize of [15, 19, 25]) {
      let falsePositives = 0;
      for (let seed = 1; seed <= seeds; seed += 1) {
        const rand = makePrng(seed * 7919 + sampleSize);
        let hits = 0;
        for (let g = 0; g < sampleSize; g += 1) {
          if (rand() < pNull) hits += 1;
        }
        if (classifyMistakeConfidence(hits, sampleSize, pNull) === 'confirmed') {
          falsePositives += 1;
        }
      }
      expect(falsePositives / seeds).toBeLessThan(0.05);
    }

    // Planted leak at ~2.8x null rate (0.42) across n=25 matches and 1,000 independent seeds
    let detectedLeaks = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
      const rand = makePrng(seed * 104729 + 31);
      let hits = 0;
      for (let g = 0; g < 25; g += 1) {
        if (rand() < 0.42) hits += 1;
      }
      if (classifyMistakeConfidence(hits, 25, pNull) === 'confirmed') {
        detectedLeaks += 1;
      }
    }
    expect(detectedLeaks / seeds).toBeGreaterThanOrEqual(0.8);
    expect(computeWilsonLowerBound(8, 25)).toBeGreaterThan(0.15);
    expect(computeWilsonLowerBound(2, 25)).toBeLessThan(0.15);
    // Emerging classification requires statistical Wilson-80 floor and never generates proposedFocus
    expect(classifyMistakeConfidence(3, 10, pNull)).toBe('emerging');
    expect(classifyMistakeConfidence(2, 10, pNull)).toBe('monitoring');
  });

  it('handles empty inputs, excludes remakes/non-jungle games/invalid dates, and grades earlyDeaths goals accurately', () => {
    const empty = computePersonalLearningSnapshot([], [], 'PLATINUM IV');
    expect(empty.jungleMatchCount).toBe(0);
    expect(empty.signatures).toEqual([]);
    expect(empty.proposedFocus).toBeNull();
    expect(empty.baselines.csPerMin.shrunkBaseline).toBe(6.6);
    expect(empty.tiltAnalytics.sessionCount).toBe(0);

    const badJgBase = DEMO_POST_GAME_MATCHES[1]!;
    const adcCopy = {
      ...badJgBase,
      matchId: 'EUW1_ADC_ONLY',
      role: 'BOTTOM',
    };
    const remakeCopy = {
      ...badJgBase,
      matchId: 'EUW1_REMAKE',
      durationSeconds: 195,
      teamObjectives: 0,
      enemyObjectives: 0,
      frames: [],
    };
    const invalidDateGame = {
      ...badJgBase,
      matchId: 'EUW1_BAD_DATE',
      playedAt: 'not-a-valid-date',
    };
    expect(detectMatchMistakeSignatures(adcCopy)).toEqual([]);
    expect(detectMatchMistakeSignatures(remakeCopy)).toEqual([]);
    expect(detectMatchMistakeSignatures(badJgBase).length).toBeGreaterThanOrEqual(2);

    const repeatedLeaks = Array.from({ length: 8 }, (_, idx) => ({
      ...badJgBase,
      matchId: `EUW1_LEAK_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, idx, 0, 0)).toISOString(),
    }));

    const snapshot = computePersonalLearningSnapshot(
      [...repeatedLeaks, remakeCopy, invalidDateGame],
      [...repeatedLeaks, adcCopy, remakeCopy, invalidDateGame],
      'PLATINUM IV'
    );
    expect(snapshot.jungleMatchCount).toBe(9);
    expect(Number.isFinite(snapshot.baselines.goldDiffAt15.shrunkBaseline)).toBe(true);
    const preObjSig = snapshot.signatures.find((s) => s.detectorId === 'pre_obj_death');
    expect(preObjSig?.status).toBe('confirmed');
    expect(preObjSig?.hitMatches).toBe(9);
    expect(snapshot.proposedFocus).not.toBeNull();
    expect(snapshot.proposedFocus?.goal.isFocusGoal).toBe(true);

    // early_death_before_10 uses dedicated earlyDeaths KPI for accurate Post-Game grading
    const earlyOnlyMatches = Array.from({ length: 6 }, (_, idx) => ({
      ...DEMO_POST_GAME_MATCHES[0]!,
      matchId: `EUW1_EARLY_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, idx, 0, 0)).toISOString(),
      events: [
        { type: 'CHAMPION_KILL' as const, timestampSec: 210, victimId: 2, position: { x: 4000, y: 4000 } },
        { type: 'CHAMPION_KILL' as const, timestampSec: 460, victimId: 2, position: { x: 5000, y: 5000 } },
      ],
    }));
    const earlySnapshot = computePersonalLearningSnapshot(
      earlyOnlyMatches,
      earlyOnlyMatches,
      'PLATINUM IV'
    );
    expect(earlySnapshot.proposedFocus?.sourceDetectorId).toBe('early_death_before_10');
    expect(earlySnapshot.proposedFocus?.goal.metric).toBe('earlyDeaths');
    const missEarly = evaluateFocusGoalAgainstMatch(earlySnapshot.proposedFocus!.goal, {
      csPerMin: 7.0,
      goldDiffAt15: 200,
      objectiveSharePct: 60,
      preObjectiveDeaths: 0,
      earlyDeaths: 2,
      visionPerMin: 1.0,
      killParticipationPct: 60,
    });
    expect(missEarly.passed).toBe(false);
  });

  it('merges SQLite full-history depth cleanly when SQLite has more jungle games than memory', () => {
    const cleanMatch = DEMO_POST_GAME_MATCHES[0]!;
    const merged = computePersonalLearningSnapshot([cleanMatch], [cleanMatch], 'PLATINUM IV', {
      jungleMatchCount: 25,
      baselines: [{ key: 'cs_per_min', value: 7.4, sampleN: 25, updatedAt: '2026-11-27T00:00:00Z' }],
      mistakeSignatures: [
        { detectorId: 'pre_obj_death', hitMatches: 9, totalHits: 12, lastTimestampSec: 525 },
      ],
    });
    expect(merged.jungleMatchCount).toBe(25);
    expect(merged.baselines.csPerMin.ewmValue).toBe(7.4);
    expect(merged.baselines.csPerMin.shrunkBaseline).toBeCloseTo(7.1, 0);
    expect(merged.baselines.csPerMin.effectiveN).toBeGreaterThan(15);
    expect(merged.baselines.csPerMin.effectiveN).toBeLessThanOrEqual(24);
    expect(merged.signatures.find((s) => s.detectorId === 'pre_obj_death')?.status).toBe('confirmed');
  });

  it('splits discrete sessions by 2h inactivity gaps and flags requeue tilt & block fatigue', () => {
    const summary = analyzeMultiSessionTilt([
      // Session 1: 4 games stacked back-to-back with post-loss collapse
      { win: true, playedAt: '2026-11-27T10:00:00Z' },
      { win: false, playedAt: '2026-11-27T10:40:00Z' },
      { win: false, playedAt: '2026-11-27T11:20:00Z' },
      { win: false, playedAt: '2026-11-27T12:00:00Z' },
      // 4h gap -> Session 2: fresh wins
      { win: true, playedAt: '2026-11-27T16:30:00Z' },
      { win: true, playedAt: '2026-11-27T17:10:00Z' },
    ]);

    expect(summary.sessionCount).toBe(2);
    expect(summary.freshGames).toBe(4);
    expect(summary.freshWrPct).toBe(75);
    expect(summary.extendedGames).toBe(2);
    expect(summary.extendedWrPct).toBe(0);
    expect(summary.postLossGames).toBe(2);
    expect(summary.postLossWrPct).toBe(0);

    const shortSummary = analyzeMultiSessionTilt([
      { win: true, playedAt: '2026-11-27T10:00:00Z', durationSeconds: 1800 },
      { win: false, playedAt: '2026-11-27T10:40:00Z', durationSeconds: 180 }, // remake excluded
    ]);
    expect(shortSummary.freshGames).toBe(1);
    expect(shortSummary.advisory).toContain('3+ completed games');
  });
});
