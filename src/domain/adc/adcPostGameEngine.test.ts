import { describe, expect, it } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from '../postGameFixtures';
import { analyzePostGameMatch } from '../postGameReviewEngine';
import { computePersonalLearningSnapshot } from '../personalLearningEngine';
import type { AdcDivisionBenchmark, SqlPersonalLearningSummary } from '../../types/coaching';
import type { MatchV5Detail } from '../../types/riot';
import {
  ADC_BENCHMARKS_PROVISIONAL,
  evaluateAdcDivisionBenchmarks,
  generateAutoAdcClimbGoals,
  resolveAdcBenchmark,
} from './adcBenchmarks';
import {
  computeAdcPersonalLearningSnapshot,
  detectAdcMatchMistakes,
  findAdcIsolatedDeaths,
  findAdcPreObjectiveDeaths,
} from './adcDetectors';
import {
  ADC_DEMO_MATCHES,
  ADC_FIXTURE_CAITLYN_PRE14_LOSS as CAIT,
  ADC_FIXTURE_JINX_CARRY_WIN as JINX,
} from './adcFixtures';
import { extractAdcMatchKpis, isAdcMatch, toAdcMatchSummary } from './adcKpis';
import { analyzeAdcPostGameMatch } from './adcPostGameEngine';

const DIV = 'PLATINUM IV';

/** Jungle fixtures carry no `role` (Jungle by convention); add an explicit one too. */
const JUNGLE_MATCHES: MatchV5Detail[] = [
  ...DEMO_POST_GAME_MATCHES,
  { ...DEMO_POST_GAME_MATCHES[1]!, matchId: 'EUW1_JG_EXPLICIT', role: 'JUNGLE' },
];

/** A Top game with Caitlyn's terrible stats — would trip every detector if it leaked in. */
const TOP_MATCH: MatchV5Detail = { ...CAIT, matchId: 'EUW1_TOP_1', role: 'TOP' };
const MID_MATCH: MatchV5Detail = { ...CAIT, matchId: 'EUW1_MID_1', role: 'MIDDLE' };
const SUPPORT_MATCH: MatchV5Detail = { ...CAIT, matchId: 'EUW1_SUP_1', role: 'UTILITY' };
const OFF_ROLE = [TOP_MATCH, MID_MATCH, SUPPORT_MATCH];

function stripLaneOpponentGold(match: MatchV5Detail): MatchV5Detail {
  return {
    ...match,
    frames: match.frames.map((f) => {
      const copy = { ...f };
      delete copy.laneOpponentGold;
      return copy;
    }),
  };
}

function stripAllyPositions(match: MatchV5Detail): MatchV5Detail {
  return {
    ...match,
    frames: match.frames.map((f) => {
      const copy = { ...f };
      delete copy.allyPositions;
      return copy;
    }),
  };
}

describe('ADC KPI extraction', () => {
  it('extracts exact KPIs for the Jinx carry win', () => {
    const k = extractAdcMatchKpis(JINX);
    expect(k.csAt10).toBe(84);
    expect(k.csAt10Minute).toBe(10);
    expect(k.csPerMin).toBe(8.6);
    expect(k.goldDiffAt15).toBe(750); // 6900 - 6150 (lane), NOT 6900 - 6800 (jungler)
    expect(k.goldDiffSource).toBe('lane_opponent');
    expect(k.damageSharePct).toBe(33.1);
    expect(k.damagePerMin).toBe(1080);
    expect(k.deathsPre14).toBe(0);
    expect(k.turretPlates).toBe(3);
    expect(k.level2TimeSec).toBe(112);
    expect(k.killParticipationPct).toBe(69);
  });

  it('extracts exact KPIs for the Caitlyn pre-14 death loss', () => {
    const k = extractAdcMatchKpis(CAIT);
    expect(k.csAt10).toBe(55);
    expect(k.csPerMin).toBe(5.9);
    expect(k.goldDiffAt15).toBe(-950); // 5100 - 6050 vs Draven
    expect(k.goldDiffSource).toBe('lane_opponent');
    expect(k.damageSharePct).toBe(19.5);
    expect(k.deathsPre14).toBe(3); // 4:10, 9:20, 13:10 — deaths at 24:10 / 27:40 excluded
    expect(k.turretPlates).toBe(0);
    expect(k.killParticipationPct).toBe(56);
  });

  it('falls back to enemy jungler gold only when lane opponent gold is missing', () => {
    const k = extractAdcMatchKpis(stripLaneOpponentGold(CAIT));
    expect(k.goldDiffAt15).toBe(-200); // 5100 - 5300
    expect(k.goldDiffSource).toBe('enemy_jungler_fallback');
  });

  it('falls back to counting TURRET_PLATE_DESTROYED events when turretPlatesTaken is absent', () => {
    expect(extractAdcMatchKpis({ ...JINX, turretPlatesTaken: undefined }).turretPlates).toBe(3);
  });

  it('returns null damage share when team damage is missing or zero', () => {
    expect(extractAdcMatchKpis({ ...JINX, teamTotalDamage: 0 }).damageSharePct).toBeNull();
    expect(extractAdcMatchKpis({ ...JINX, teamTotalDamage: undefined }).damageSharePct).toBeNull();
  });

  it('does not report CS@10 or GD@15 for games that ended before those minutes', () => {
    const short = { ...CAIT, durationSeconds: 560 };
    const k = extractAdcMatchKpis(short);
    expect(k.csAt10).toBeNull();
    expect(k.goldDiffAt15).toBeNull();
    expect(k.goldDiffSource).toBe('unavailable');
  });
});

describe('ADC role gate', () => {
  it('accepts only explicit BOTTOM / BOT / ADC roles', () => {
    expect(isAdcMatch({ role: 'BOTTOM' })).toBe(true);
    expect(isAdcMatch({ role: 'bot' })).toBe(true);
    expect(isAdcMatch({ role: ' ADC ' })).toBe(true);
    for (const role of ['JUNGLE', 'TOP', 'MIDDLE', 'UTILITY', 'SUPPORT', '', undefined, null]) {
      expect(isAdcMatch({ role })).toBe(false);
    }
  });
});

describe('ADC mistake detectors', () => {
  it('fires all 5 detectors on the Caitlyn loss with correct timestamps', () => {
    const hits = detectAdcMatchMistakes(CAIT, DIV);
    const byId = Object.fromEntries(hits.map((h) => [h.detectorId, h]));
    expect(Object.keys(byId).sort()).toEqual([
      'adc_cs_deficit_10',
      'adc_isolated_death',
      'adc_lane_death_pre_14',
      'adc_low_damage_share',
      'adc_pre_obj_death',
    ]);
    expect(byId.adc_cs_deficit_10!.timestampSec).toBe(600);
    expect(byId.adc_lane_death_pre_14!.timestampSec).toBe(560); // anchored on 2nd lane death
    expect(byId.adc_lane_death_pre_14!.allTimestampsSec).toEqual([250, 560, 790]);
    expect(byId.adc_low_damage_share!.timestampSec).toBe(900);
    expect(byId.adc_pre_obj_death!.allTimestampsSec).toEqual([560]); // 50s before enemy Dragon
    expect(byId.adc_isolated_death!.allTimestampsSec).toEqual([1450]);
  });

  it('fires nothing on the clean Jinx carry (including a non-isolated death past river)', () => {
    expect(detectAdcMatchMistakes(JINX, DIV)).toEqual([]);
    expect(findAdcIsolatedDeaths(JINX)).toEqual([]);
  });

  it('CS@10 floor tracks the target division', () => {
    const cs66 = {
      ...JINX,
      frames: JINX.frames.map((f) => (f.minute === 10 ? { ...f, cs: 66 } : f)),
    };
    // 66 >= GOLD floor (66) but < PLATINUM floor (70)
    expect(detectAdcMatchMistakes(cs66, 'GOLD II').map((h) => h.detectorId)).not.toContain(
      'adc_cs_deficit_10'
    );
    expect(detectAdcMatchMistakes(cs66, DIV).map((h) => h.detectorId)).toContain(
      'adc_cs_deficit_10'
    );
  });

  it('a single lane death does not trigger adc_lane_death_pre_14', () => {
    const oneDeath = {
      ...CAIT,
      events: CAIT.events.filter(
        (e) => !(e.type === 'CHAMPION_KILL' && e.victimId === 9 && (e.timestampSec === 560 || e.timestampSec === 790))
      ),
    };
    expect(detectAdcMatchMistakes(oneDeath, DIV).map((h) => h.detectorId)).not.toContain(
      'adc_lane_death_pre_14'
    );
  });

  it('low damage share needs a >=15:00 game', () => {
    const short = { ...CAIT, durationSeconds: 880 };
    expect(detectAdcMatchMistakes(short, DIV).map((h) => h.detectorId)).not.toContain(
      'adc_low_damage_share'
    );
  });

  it('pre-objective window: 55s before an enemy take counts, 56s does not; own-team takes never count', () => {
    const withDeathAt = (deathTs: number, killerTeamId: number): MatchV5Detail => ({
      ...JINX,
      events: [
        { type: 'CHAMPION_KILL', timestampSec: deathTs, killerId: 8, victimId: 4, position: { x: 9000, y: 5000 } },
        { type: 'ELITE_MONSTER_KILL', timestampSec: 1100, killerId: 7, killerTeamId, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
      ],
    });
    expect(findAdcPreObjectiveDeaths(withDeathAt(1045, 200))).toEqual([1045]);
    expect(findAdcPreObjectiveDeaths(withDeathAt(1044, 200))).toEqual([]);
    expect(findAdcPreObjectiveDeaths(withDeathAt(1045, 100))).toEqual([]);
    // 45s before the 20:00 Baron spawn
    expect(findAdcPreObjectiveDeaths(withDeathAt(1155, 100))).toEqual([1155]);
    expect(findAdcPreObjectiveDeaths(withDeathAt(1154, 100))).toEqual([]);
  });

  it('enemy Void Grubs (HORDE) are not a Dragon/Baron/Herald objective', () => {
    const grubs: MatchV5Detail = {
      ...JINX,
      events: [
        { type: 'CHAMPION_KILL', timestampSec: 450, killerId: 8, victimId: 4, position: { x: 9000, y: 5000 } },
        { type: 'ELITE_MONSTER_KILL', timestampSec: 480, killerId: 7, killerTeamId: 200, monsterType: 'HORDE', position: { x: 4850, y: 10450 } },
      ],
    };
    expect(findAdcPreObjectiveDeaths(grubs)).toEqual([]);
  });

  it('isolated-death detector stays silent without ally position data (never guesses)', () => {
    const noAllies = stripAllyPositions(CAIT);
    expect(findAdcIsolatedDeaths(noAllies)).toEqual([]);
    expect(detectAdcMatchMistakes(noAllies, DIV).map((h) => h.detectorId)).not.toContain(
      'adc_isolated_death'
    );
  });

  it('isolated-death ignores laning-phase deaths and deaths on your own half', () => {
    const allyFarAway = [{ x: 1000, y: 1000 }];
    const m: MatchV5Detail = {
      ...CAIT,
      frames: [
        { ...CAIT.frames[0]!, minute: 12, allyPositions: allyFarAway },
        { ...CAIT.frames[0]!, minute: 26, allyPositions: allyFarAway },
      ],
      events: [
        // pre-14 death past river -> laning phase, ignored
        { type: 'CHAMPION_KILL', timestampSec: 730, killerId: 2, victimId: 9, position: { x: 4000, y: 3000 } },
        // late death on red's own half -> not past river
        { type: 'CHAMPION_KILL', timestampSec: 1570, killerId: 2, victimId: 9, position: { x: 11000, y: 11000 } },
      ],
    };
    expect(findAdcIsolatedDeaths(m)).toEqual([]);
  });

  it('never evaluates Jungle or Off-Role matches', () => {
    for (const m of [...JUNGLE_MATCHES, ...OFF_ROLE]) {
      expect(detectAdcMatchMistakes(m, DIV)).toEqual([]);
    }
  });
});

describe('analyzeAdcPostGameMatch', () => {
  it('grades the Jinx carry S with lane / plate / damage highlights and no mistakes', () => {
    const r = analyzeAdcPostGameMatch(JINX, DIV);
    expect(r.isAdc).toBe(true);
    expect(r.role).toBe('bottom');
    expect(r.grade).toBe('S');
    expect(r.targetTier).toBe('PLATINUM');
    expect(r.isProvisional).toBe(true);
    expect(r.championName).toBe('Jinx');
    expect(r.laneOpponentName).toBe('Ezreal');
    expect(r.mistakes).toEqual([]);
    expect(r.mistakeHits).toEqual([]);
    expect(r.highlights.map((h) => h.id)).toEqual(
      expect.arrayContaining(['adc-hl-cs10', 'adc-hl-gd15', 'adc-hl-plates', 'adc-hl-damage', 'adc-hl-clean-lane'])
    );
    expect(r.improvements.length).toBeGreaterThan(0);
    expect(r.focusSuggestion).toBeUndefined();
    expect(r.kpiBreakdown.find((k) => k.key === 'csAt10')).toMatchObject({
      value: 84,
      benchmark: 70,
      status: 'ahead',
    });
  });

  it('grades the Caitlyn loss D with every detector surfaced as a mistake + improvement', () => {
    const r = analyzeAdcPostGameMatch(CAIT, DIV);
    expect(r.grade).toBe('D');
    expect(r.mistakes.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        'mk-adc_cs_deficit_10',
        'mk-adc_lane_death_pre_14',
        'mk-adc_low_damage_share',
        'mk-adc_pre_obj_death',
        'mk-adc_isolated_death',
        'mk-adc-gd15',
      ])
    );
    for (const id of ['adc_cs_deficit_10', 'adc_lane_death_pre_14', 'adc_low_damage_share', 'adc_pre_obj_death', 'adc_isolated_death']) {
      expect(r.improvements.some((i) => i.id === `imp-${id}` && i.severity === 'action')).toBe(true);
    }
    expect(r.mistakes.find((m) => m.id === 'mk-adc-gd15')!.title).toContain('Draven');
    expect(r.kpiBreakdown.find((k) => k.key === 'deathsPre14')).toMatchObject({
      value: 3,
      status: 'behind',
      lowerIsBetter: true,
    });
    expect(r.focusSuggestion).toBeDefined();
  });

  it('builds normalized path points and timeline markers (kills, deaths, pre-obj, isolated, wards, objectives, plates)', () => {
    const jinx = analyzeAdcPostGameMatch(JINX, DIV);
    expect(jinx.pathPoints).toHaveLength(JINX.frames.length);
    expect(jinx.laneOpponentPathPoints).toHaveLength(JINX.frames.length);
    for (const p of [...jinx.pathPoints, ...jinx.markers]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1000);
    }
    const jinxKinds = jinx.markers.map((m) => m.kind);
    expect(jinxKinds.filter((k) => k === 'plate')).toHaveLength(3);
    expect(jinxKinds).toEqual(
      expect.arrayContaining(['kill', 'death', 'ward', 'control_ward', 'objective', 'plate'])
    );
    // Markers are chronological
    const ts = jinx.markers.map((m) => m.timestampSec);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));

    const cait = analyzeAdcPostGameMatch(CAIT, DIV);
    expect(cait.markers.find((m) => m.timestampSec === 560)!.kind).toBe('pre_obj_death');
    expect(cait.markers.find((m) => m.timestampSec === 1450)!.kind).toBe('isolated_death');
    expect(cait.markers.find((m) => m.timestampSec === 250)!.kind).toBe('death');
    // Enemy ADC's plate on our tower is not our plate
    expect(cait.markers.some((m) => m.kind === 'plate')).toBe(false);
    expect(cait.markers.find((m) => m.timestampSec === 610)!.label).toContain('Lost DRAGON');
  });

  it('returns N/A with no findings for Jungle and Off-Role matches', () => {
    for (const m of [...JUNGLE_MATCHES, ...OFF_ROLE]) {
      const r = analyzeAdcPostGameMatch(m, DIV);
      expect(r.isAdc).toBe(false);
      expect(r.grade).toBe('N/A');
      expect(r.mistakes).toEqual([]);
      expect(r.highlights).toEqual([]);
      expect(r.mistakeHits).toEqual([]);
      expect(r.kpiBreakdown).toEqual([]);
    }
  });

  it('leaves the Jungle post-game engine untouched for ADC matches (still N/A there)', () => {
    const jungleView = analyzePostGameMatch(JINX, DIV);
    expect(jungleView.isJungle).toBe(false);
    expect(jungleView.grade).toBe('N/A');
  });
});

describe('ADC benchmarks', () => {
  it('provisional table spans the agreed SILVER..MASTER ranges and is monotonic', () => {
    const s = ADC_BENCHMARKS_PROVISIONAL.SILVER;
    const m = ADC_BENCHMARKS_PROVISIONAL.MASTER;
    expect([s.csAt10, m.csAt10]).toEqual([62, 82]);
    expect([s.csPerMin, m.csPerMin]).toEqual([6.3, 8.6]);
    expect([s.goldDiffAt15, m.goldDiffAt15]).toEqual([-220, 420]);
    expect([s.damageSharePct, m.damageSharePct]).toEqual([23, 30]);
    expect([s.deathsPre14, m.deathsPre14]).toEqual([1.9, 0.9]);
    expect([s.turretPlates, m.turretPlates]).toEqual([1.0, 2.4]);
    expect([s.killParticipationPct, m.killParticipationPct]).toEqual([54, 68]);

    const order = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'] as const;
    for (let i = 1; i < order.length; i += 1) {
      const lo = ADC_BENCHMARKS_PROVISIONAL[order[i - 1]!];
      const hi = ADC_BENCHMARKS_PROVISIONAL[order[i]!];
      for (const key of ['csAt10', 'csPerMin', 'goldDiffAt15', 'damageSharePct', 'turretPlates', 'killParticipationPct'] as const) {
        expect(hi[key]).toBeGreaterThan(lo[key]);
      }
      expect(hi.deathsPre14).toBeLessThan(lo.deathsPre14);
    }
  });

  it('is provisional until every KPI is calibrated by the pack', () => {
    expect(resolveAdcBenchmark(DIV).isProvisional).toBe(true);
    const partial = resolveAdcBenchmark(DIV, { PLATINUM: { csAt10: 72 } });
    expect(partial.isProvisional).toBe(true);
    expect(partial.benchmark.csAt10).toBe(72);
    expect(partial.benchmark.csPerMin).toBe(7.2);

    const full: AdcDivisionBenchmark = { csAt10: 71, csPerMin: 7.3, goldDiffAt15: 50, damageSharePct: 26.5, deathsPre14: 1.4, turretPlates: 1.7, killParticipationPct: 61 };
    const calibrated = resolveAdcBenchmark(DIV, { PLATINUM: full });
    expect(calibrated.isProvisional).toBe(false);
    expect(calibrated.benchmark).toEqual(full);
    // Full division key wins over the bare tier key
    expect(resolveAdcBenchmark(DIV, { PLATINUM: full, 'PLATINUM IV': { ...full, csAt10: 69 } }).benchmark.csAt10).toBe(69);
    // Overrides for another tier do not apply
    expect(resolveAdcBenchmark(DIV, { GOLD: full }).isProvisional).toBe(true);
  });

  it('evaluateAdcDivisionBenchmarks only averages ADC matches', () => {
    const mixed = [...ADC_DEMO_MATCHES, ...JUNGLE_MATCHES, ...OFF_ROLE];
    const evaluation = evaluateAdcDivisionBenchmarks(mixed, DIV);
    const adcOnly = evaluateAdcDivisionBenchmarks(ADC_DEMO_MATCHES, DIV);
    expect(evaluation).toEqual(adcOnly);
    expect(evaluation.role).toBe('bottom');
    expect(evaluation.matchCount).toBe(2);
    expect(evaluation.winRatePct).toBe(50);
    expect(evaluation.isProvisional).toBe(true);
    const cs10 = evaluation.comparisons.find((c) => c.metric === 'csAt10')!;
    expect(cs10.currentValue).toBe(70); // (84 + 55) / 2 = 69.5 -> 70
    expect(cs10.sampleN).toBe(2);
    const gd = evaluation.comparisons.find((c) => c.metric === 'goldDiffAt15')!;
    expect(gd.currentValue).toBe(-100); // (750 - 950) / 2
    const dmg = evaluation.comparisons.find((c) => c.metric === 'damageSharePct')!;
    expect(dmg.currentValue).toBe(26.3); // (33.1 + 19.5) / 2

    const none = evaluateAdcDivisionBenchmarks([...JUNGLE_MATCHES, ...OFF_ROLE], DIV);
    expect(none.matchCount).toBe(0);
    expect(none.overallReadinessPct).toBe(0);
    expect(none.comparisons.every((c) => c.gapText === 'Sync ADC matches to measure')).toBe(true);
  });

  it('generateAutoAdcClimbGoals emits role: bottom goals for the weakest KPIs', () => {
    const summaries = [CAIT, TOP_MATCH].map((m) => toAdcMatchSummary(m));
    const goals = generateAutoAdcClimbGoals(summaries, DIV, undefined, '2026-11-27T00:00:00.000Z');
    expect(goals.length).toBeGreaterThan(0);
    expect(goals.length).toBeLessThanOrEqual(3);
    for (const g of goals) {
      expect(g.role).toBe('bottom');
      expect(g.source).toBe('auto');
      expect(g.status).toBe('active');
      expect(g.id).toMatch(/^auto-adc-platinum-/);
      expect(g.createdAt).toBe('2026-11-27T00:00:00.000Z');
    }
    // Worst bottlenecks in Caitlyn's game: GD@15 (-950g) & plates (0) at the 10% floor, then deaths (3 vs 1.5)
    expect(goals.map((g) => g.metric)).toEqual(['goldDiffAt15', 'turretPlates', 'deathsPre14']);
    expect(goals[2]!.lowerIsBetter).toBe(true);
    expect(goals[2]!.title).toBe('Keep deaths before 14:00 <= 1.5/game');
    // The TOP copy did not double-count: current values come from Caitlyn alone
    expect(goals.find((g) => g.metric === 'turretPlates')!.currentValue).toBe(0);

    expect(generateAutoAdcClimbGoals([toAdcMatchSummary(TOP_MATCH)], DIV)).toEqual([]);
    expect(generateAutoAdcClimbGoals([], DIV)).toEqual([]);
  });
});

describe('computeAdcPersonalLearningSnapshot', () => {
  it('excludes Jungle and Off-Role matches from baselines and detector counts', () => {
    const mixed = [...ADC_DEMO_MATCHES, ...JUNGLE_MATCHES, ...OFF_ROLE];
    const snap = computeAdcPersonalLearningSnapshot(mixed, DIV, null);
    const pure = computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, null);

    expect(snap.role).toBe('bottom');
    expect(snap.adcMatchCount).toBe(2);
    expect(snap.excludedMatchCount).toBe(JUNGLE_MATCHES.length + OFF_ROLE.length);
    expect(snap.baselines).toEqual(pure.baselines);
    expect(snap.signatures).toEqual(pure.signatures);
    for (const sig of snap.signatures) {
      expect(sig.role).toBe('bottom');
      expect(sig.totalMatches).toBe(2);
      expect(sig.hitMatches).toBe(1); // only Caitlyn — the TOP/MID/SUP clones never count
      expect(sig.detectorId.startsWith('adc_')).toBe(true);
    }
    expect(snap.signatures).toHaveLength(5);
  });

  it('computes shrunk EWM baselines for all 7 ADC KPIs, pulled toward the division prior', () => {
    const snap = computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, null);
    expect(Object.keys(snap.baselines).sort()).toEqual(
      ['csAt10', 'csPerMin', 'damageSharePct', 'deathsPre14', 'goldDiffAt15', 'killParticipationPct', 'turretPlates']
    );
    const cs10 = snap.baselines.csAt10;
    expect(cs10.priorTarget).toBe(70);
    // Jinx (newer, 84) weighs more than Caitlyn (older, 55) -> raw EWM above the simple mean
    expect(cs10.ewmValue).toBeGreaterThan(69.5);
    // Shrinkage keeps a 2-game sample close to the prior
    expect(Math.abs(cs10.shrunkBaseline - 70)).toBeLessThan(Math.abs(cs10.ewmValue - 70) + 1e-9);
    expect(snap.baselines.deathsPre14.priorTarget).toBe(1.5);
    expect(snap.isProvisional).toBe(true);
  });

  it('only 1 hit in 2 games stays "monitoring" — no confirmed leak, no focus goal', () => {
    const snap = computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, null);
    expect(snap.signatures.every((s) => s.status === 'monitoring')).toBe(true);
    expect(snap.proposedFocus).toBeNull();
  });

  it('a repeated pattern becomes confirmed and proposes a role: bottom focus goal', () => {
    const repeats = Array.from({ length: 6 }, (_, i) => ({
      ...CAIT,
      matchId: `EUW1_CAIT_${i}`,
      playedAt: `2026-11-2${i}T18:00:00Z`,
    }));
    const snap = computeAdcPersonalLearningSnapshot([...repeats, ...JUNGLE_MATCHES], DIV, null);
    expect(snap.adcMatchCount).toBe(6);
    expect(snap.signatures.every((s) => s.status === 'confirmed')).toBe(true);
    expect(snap.proposedFocus).not.toBeNull();
    const goal = snap.proposedFocus!.goal;
    expect(goal.role).toBe('bottom');
    expect(goal.isFocusGoal).toBe(true);
    expect(goal.id).toMatch(/^adc-m13-adc_/);
    expect(['csAt10', 'csPerMin', 'goldDiffAt15', 'damageSharePct', 'deathsPre14', 'turretPlates', 'killParticipationPct']).toContain(goal.metric);
    expect(snap.proposedFocus!.reason).toContain('6/6 ADC games');
  });

  it('uses BOTTOM-scoped SQL depth but ignores a Jungle-scoped SQL summary', () => {
    const adcSql: SqlPersonalLearningSummary = {
      jungleMatchCount: 20, // BOTTOM-scoped: holds the ADC match count
      baselines: [{ key: 'cs_at_10', value: 60, sampleN: 20, updatedAt: '2026-11-27T00:00:00Z' }],
      mistakeSignatures: [{ detectorId: 'adc_cs_deficit_10', hitMatches: 12, totalHits: 12, lastTimestampSec: 600 }],
    };
    const snap = computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, adcSql);
    expect(snap.usedSqlDepth).toBe(true);
    expect(snap.adcMatchCount).toBe(20);
    expect(snap.baselines.csAt10.ewmValue).toBe(60);
    const cs = snap.signatures.find((s) => s.detectorId === 'adc_cs_deficit_10')!;
    expect(cs.hitMatches).toBe(12);
    expect(cs.status).toBe('confirmed');

    const jungleSql: SqlPersonalLearningSummary = {
      jungleMatchCount: 40,
      baselines: [
        { key: 'cs_per_min', value: 5.1, sampleN: 40, updatedAt: '2026-11-27T00:00:00Z' },
        { key: 'objective_share_pct', value: 51, sampleN: 40, updatedAt: '2026-11-27T00:00:00Z' },
      ],
      mistakeSignatures: [{ detectorId: 'pre_obj_death', hitMatches: 20, totalHits: 25, lastTimestampSec: 300 }],
    };
    const isolated = computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, jungleSql);
    expect(isolated.usedSqlDepth).toBe(false);
    expect(isolated).toEqual(computeAdcPersonalLearningSnapshot(ADC_DEMO_MATCHES, DIV, null));
  });

  it('does not change the Jungle personal-learning snapshot when ADC matches are present', () => {
    const jungleOnly = computePersonalLearningSnapshot(DEMO_POST_GAME_MATCHES, DEMO_POST_GAME_MATCHES, DIV, null);
    const withAdc = computePersonalLearningSnapshot(
      [...DEMO_POST_GAME_MATCHES, ...ADC_DEMO_MATCHES],
      DEMO_POST_GAME_MATCHES,
      DIV,
      null
    );
    expect(withAdc.baselines).toEqual(jungleOnly.baselines);
    expect(withAdc.signatures).toEqual(jungleOnly.signatures);
    expect(withAdc.jungleMatchCount).toBe(jungleOnly.jungleMatchCount);
  });
});
