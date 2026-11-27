// Read-only reuse of pure helpers; the Jungle post-game evaluation itself is never called.
import { formatChampionName } from '../championNames';
import { formatClock } from '../liveCoachEngine';
import { normalizeRiotCoordinate } from '../postGameReviewEngine';
import type {
  AdcDivisionBenchmark,
  AdcKpiKey,
  NormalizedMapPoint,
  ReviewFinding,
} from '../../types/coaching';
import type { MatchV5Detail, MatchV5TimelinePosition } from '../../types/riot';
import { ADC_KPI_KEYS, ADC_KPI_META, resolveAdcBenchmark } from './adcBenchmarks';
import {
  ADC_DETECTOR_CATALOG,
  detectAdcMatchMistakes,
  findAdcIsolatedDeaths,
  findAdcPreObjectiveDeaths,
} from './adcDetectors';
import { extractAdcMatchKpis, isAdcMatch } from './adcKpis';
import type {
  AdcBenchmarkOverrides,
  AdcMatchKpis,
  AdcMistakeDetectorId,
  AdcMistakeHit,
  AdcPostGameReviewReport,
  AdcTimelineMarker,
} from './adcReviewTypes';
import type { AdcPostGameKpi } from './types';

/** Weights of each KPI in the ADC grade (sum = 1). Missing KPIs are renormalised away. */
export const ADC_GRADE_WEIGHTS: Record<AdcKpiKey, number> = {
  csAt10: 0.15,
  csPerMin: 0.15,
  goldDiffAt15: 0.15,
  damageSharePct: 0.2,
  deathsPre14: 0.15,
  turretPlates: 0.05,
  killParticipationPct: 0.15,
};

/** How far past the benchmark counts as "ahead" rather than merely "on track". */
const AHEAD_MARGIN: Record<AdcKpiKey, number> = {
  csAt10: 6,
  csPerMin: 0.5,
  goldDiffAt15: 250,
  damageSharePct: 3,
  deathsPre14: 0.5,
  turretPlates: 1,
  killParticipationPct: 6,
};

const MAX_KPI_SCORE = 1.25;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function kpiValue(kpis: AdcMatchKpis, key: AdcKpiKey): number | null {
  const v = kpis[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 1.0 = exactly at benchmark, capped at 1.25. */
function scoreKpi(key: AdcKpiKey, value: number, bench: number): number {
  if (key === 'goldDiffAt15') return clamp(1 + (value - bench) / 800, 0, MAX_KPI_SCORE);
  if (key === 'deathsPre14') return clamp(1 + (bench - value) * 0.35, 0, MAX_KPI_SCORE);
  return clamp(bench > 0 ? value / bench : 1, 0, MAX_KPI_SCORE);
}

function buildKpiBreakdown(kpis: AdcMatchKpis, bench: AdcDivisionBenchmark): AdcPostGameKpi[] {
  const out: AdcPostGameKpi[] = [];
  for (const key of ADC_KPI_KEYS) {
    const value = kpiValue(kpis, key);
    if (value === null) continue;
    const target = bench[key];
    const lowerIsBetter = ADC_KPI_META[key].lowerIsBetter;
    const margin = AHEAD_MARGIN[key];
    const status: AdcPostGameKpi['status'] = lowerIsBetter
      ? value <= target - margin
        ? 'ahead'
        : value <= target
          ? 'on_track'
          : 'behind'
      : value >= target + margin
        ? 'ahead'
        : value >= target
          ? 'on_track'
          : 'behind';
    out.push({ key, value, benchmark: target, lowerIsBetter, status });
  }
  return out;
}

function toPoints(
  frames: MatchV5Detail['frames'],
  pick: (f: MatchV5Detail['frames'][number]) => MatchV5TimelinePosition | null | undefined
): NormalizedMapPoint[] {
  return frames.flatMap((f) => {
    const p = pick(f);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return [];
    const n = normalizeRiotCoordinate(p.x, p.y);
    return [{ minute: f.minute, x: n.x, y: n.y }];
  });
}

function buildMarkers(match: MatchV5Detail): AdcTimelineMarker[] {
  const me = match.playerParticipantId;
  const teamId = match.mapSide === 'red' ? 200 : 100;
  const preObj = new Set(findAdcPreObjectiveDeaths(match));
  const isolated = new Set(findAdcIsolatedDeaths(match));
  const markers: AdcTimelineMarker[] = [];

  match.events.forEach((ev, index) => {
    if (!ev.position || !Number.isFinite(ev.position.x) || !Number.isFinite(ev.position.y)) return;
    const { x, y } = normalizeRiotCoordinate(ev.position.x, ev.position.y);
    const base = { minute: Math.floor(ev.timestampSec / 60), timestampSec: ev.timestampSec, x, y };
    const clock = formatClock(ev.timestampSec);

    if (ev.type === 'CHAMPION_KILL') {
      if (ev.killerId === me) {
        markers.push({
          ...base,
          id: `adc-kill-${index}`,
          kind: 'kill',
          label: `Kill @ ${clock}`,
          detail: 'Kill secured — shove the wave and convert into plates or Dragon.',
        });
      } else if (ev.victimId === me) {
        const pre = preObj.has(ev.timestampSec);
        const iso = isolated.has(ev.timestampSec);
        markers.push({
          ...base,
          id: `adc-death-${index}`,
          kind: pre ? 'pre_obj_death' : iso ? 'isolated_death' : 'death',
          label: pre
            ? `Pre-Objective Death @ ${clock}`
            : iso
              ? `Isolated Death @ ${clock}`
              : `Death @ ${clock}`,
          detail: pre
            ? 'Caught before Dragon/Baron/Herald — your team fought the objective without its main DPS.'
            : iso
              ? 'Died alone past river with no ally nearby — farm side waves only when enemies are visible.'
              : ev.timestampSec < 840
                ? 'Lane death before plates fell — check enemy jungler tracking and wave position.'
                : 'Death — review positioning relative to your frontline before this fight.',
        });
      } else if (ev.assistingParticipantIds?.includes(me)) {
        markers.push({
          ...base,
          id: `adc-assist-${index}`,
          kind: 'assist',
          label: `Assist @ ${clock}`,
          detail: 'Fight participation — check whether the next wave or objective was converted.',
        });
      }
    } else if (ev.type === 'WARD_PLACED' && ev.creatorId === me) {
      const control = ev.wardType === 'CONTROL_WARD';
      markers.push({
        ...base,
        id: `adc-ward-${index}`,
        kind: control ? 'control_ward' : 'ward',
        label: `${control ? 'Control Ward' : 'Ward'} @ ${clock}`,
        detail: control
          ? 'Control Ward placed — denies bot-side river / tri-brush vision.'
          : 'Ward placed for jungler tracking in lane.',
      });
    } else if (ev.type === 'ELITE_MONSTER_KILL') {
      const yours = ev.killerTeamId === teamId;
      const name = ev.monsterType ?? 'Objective';
      markers.push({
        ...base,
        id: `adc-obj-${index}`,
        kind: 'objective',
        label: `${yours ? 'Secured' : 'Lost'} ${name} @ ${clock}`,
        detail: yours
          ? `Team secured ${name}.`
          : `Enemy took ${name} — were you alive, pushed and grouped 60s before?`,
      });
    } else if (ev.type === 'TURRET_PLATE_DESTROYED' && ev.killerId === me) {
      markers.push({
        ...base,
        id: `adc-plate-${index}`,
        kind: 'plate',
        label: `Turret Plate @ ${clock}`,
        detail: 'Plate taken — 160g of lane pressure converted.',
      });
    }
  });

  return markers.sort((a, b) => a.timestampSec - b.timestampSec);
}

interface MistakeCopy {
  title: (hit: AdcMistakeHit, kpis: AdcMatchKpis, bench: AdcDivisionBenchmark) => string;
  detail: string;
  improvement: { title: string; detail: string };
}

const MISTAKE_COPY: Record<AdcMistakeDetectorId, MistakeCopy> = {
  adc_cs_deficit_10: {
    title: (_h, k, b) => `CS@10 Below ${b.csAt10} Floor (${k.csAt10} CS)`,
    detail: 'Missed last hits in lane cost roughly an item component by 10:00.',
    improvement: {
      title: 'Protect the Cannon & Last-Hit Under Tower',
      detail: `Never trade an auto for a cannon minion; when shoved in, last-hit melee with 2 tower shots + 1 auto, casters with 1 shot + 2 autos.`,
    },
  },
  adc_lane_death_pre_14: {
    title: (h) =>
      `${h.allTimestampsSec.length} Lane Deaths Before 14:00 (2nd at ${formatClock(h.timestampSec)})`,
    detail: 'Each lane death hands over the wave, plates and Dragon priority before plates fall.',
    improvement: {
      title: 'Track the Enemy Jungler Before Trading',
      detail: 'From 2:45 onward, if the enemy jungler has not been seen for 30s, stay behind your casters and only trade with flash up.',
    },
  },
  adc_low_damage_share: {
    title: (_h, k) => `Low Team Damage Share (${k.damageSharePct}% < 23%)`,
    detail: 'The team fought without its main damage source — deaths, late arrivals, or hitting nothing in range.',
    improvement: {
      title: 'Auto the Closest Safe Target Every Window',
      detail: 'In fights, kite backwards hitting the frontline in range instead of waiting for the backline; arrive with the support, not after.',
    },
  },
  adc_pre_obj_death: {
    title: (h) =>
      `${h.allTimestampsSec.length} Pre-Objective Death(s) (first at ${formatClock(h.timestampSec)})`,
    detail: 'Dying in the 45–55s before Dragon/Baron/Herald lets the enemy start it uncontested.',
    improvement: {
      title: 'Shove, Reset & Group 60s Before Spawns',
      detail: 'At T-75s push the bot wave, recall, buy, and walk to the pit with your support — never face-check river alone.',
    },
  },
  adc_isolated_death: {
    title: (h) => `Isolated Death Past River (${formatClock(h.timestampSec)})`,
    detail: 'You died alone in the enemy half with no ally in range after laning phase.',
    improvement: {
      title: 'Farm Side Lanes Only With Enemy Info',
      detail: 'After 14:00, take side waves past river only when 2+ enemies are visible on the map; otherwise farm mid with your team.',
    },
  },
};

function gradeFromPoints(points: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  return points >= 90 ? 'S' : points >= 78 ? 'A' : points >= 64 ? 'B' : points >= 50 ? 'C' : 'D';
}

/**
 * Full ADC post-game review. Jungle / Off-Role matches return `isAdc: false`, grade `'N/A'`
 * and no findings — they are never scored against ADC benchmarks.
 */
export function analyzeAdcPostGameMatch(
  match: MatchV5Detail,
  targetDivision = 'PLATINUM IV',
  packOverrides?: AdcBenchmarkOverrides
): AdcPostGameReviewReport {
  const kpis = extractAdcMatchKpis(match);
  const resolved = resolveAdcBenchmark(targetDivision, packOverrides);
  const bench = resolved.benchmark;
  const championName = formatChampionName(match.championName, match.championId);
  const laneOpponentName =
    match.laneOpponentName && match.laneOpponentName !== 'Unknown'
      ? formatChampionName(match.laneOpponentName, match.laneOpponentChampionId)
      : 'Lane Opponent';
  const pathPoints = toPoints(match.frames, (f) => f.position);
  const laneOpponentPathPoints = toPoints(match.frames, (f) => f.laneOpponentPosition);
  const markers = buildMarkers(match);

  const base = {
    role: 'bottom' as const,
    matchId: match.matchId,
    championName,
    laneOpponentName,
    win: match.win,
    durationSeconds: match.durationSeconds,
    targetTier: resolved.tier,
    isProvisional: resolved.isProvisional,
    kpis,
    pathPoints,
    laneOpponentPathPoints,
    markers,
  };

  if (!isAdcMatch(match)) {
    return {
      ...base,
      isAdc: false,
      grade: 'N/A',
      gradePoints: 0,
      kpiBreakdown: [],
      highlights: [],
      mistakes: [],
      improvements: [],
      mistakeHits: [],
    };
  }

  const kpiBreakdown = buildKpiBreakdown(kpis, bench);
  const mistakeHits = detectAdcMatchMistakes(match, targetDivision, packOverrides, kpis);
  const hitIds = new Set(mistakeHits.map((h) => h.detectorId));
  const longEnough = match.durationSeconds >= 900;

  // --- Highlights ---------------------------------------------------------
  const highlights: ReviewFinding[] = [];
  if (kpis.csAt10 !== null && kpis.csAt10 >= bench.csAt10) {
    highlights.push({
      id: 'adc-hl-cs10',
      category: 'farming',
      severity: 'positive',
      title: `Strong CS@10 (${kpis.csAt10} vs ${bench.csAt10} ${resolved.tier} target)`,
      detail: `Clean laning-phase farm — ${kpis.csPerMin} CS/min over the whole game.`,
    });
  }
  if (kpis.goldDiffAt15 !== null && kpis.goldDiffAt15 >= bench.goldDiffAt15 + AHEAD_MARGIN.goldDiffAt15) {
    const vs =
      kpis.goldDiffSource === 'lane_opponent' ? laneOpponentName : 'the enemy jungler (fallback)';
    highlights.push({
      id: 'adc-hl-gd15',
      category: 'fighting',
      severity: 'positive',
      title: `Won Lane (+${kpis.goldDiffAt15}g @ 15m vs ${vs})`,
      detail: 'Lane lead built through trades, plates and wave control before 15:00.',
    });
  }
  if (kpis.turretPlates >= Math.max(2, bench.turretPlates)) {
    highlights.push({
      id: 'adc-hl-plates',
      category: 'objectives',
      severity: 'positive',
      title: `Plate Pressure (${kpis.turretPlates} plates)`,
      detail: `Converted lane priority into ${kpis.turretPlates * 160}g+ of plate gold before 14:00.`,
    });
  }
  if (
    longEnough &&
    kpis.damageSharePct !== null &&
    kpis.damageSharePct >= bench.damageSharePct + AHEAD_MARGIN.damageSharePct
  ) {
    highlights.push({
      id: 'adc-hl-damage',
      category: 'fighting',
      severity: 'positive',
      title: `High Teamfight Damage Share (${kpis.damageSharePct}%)`,
      detail:
        kpis.damagePerMin !== null
          ? `Carried team damage at ${kpis.damagePerMin} DPM — you were alive and hitting in fights.`
          : 'Carried team damage — you were alive and hitting in fights.',
    });
  }
  if (kpis.deathsPre14 === 0 && match.durationSeconds >= 840) {
    highlights.push({
      id: 'adc-hl-clean-lane',
      category: 'fighting',
      severity: 'positive',
      title: 'Deathless Laning Phase',
      detail: 'No deaths before 14:00 — every plate and Dragon window stayed open for your team.',
    });
  }
  if (highlights.length === 0) {
    highlights.push({
      id: 'adc-hl-kp',
      category: 'fighting',
      severity: 'positive',
      title: `Team Presence (${kpis.killParticipationPct}% KP)`,
      detail: 'Participated in your team’s kills across the map.',
    });
  }

  // --- Mistakes & improvements --------------------------------------------
  const mistakes: ReviewFinding[] = [];
  const improvements: ReviewFinding[] = [];
  for (const hit of mistakeHits) {
    const copy = MISTAKE_COPY[hit.detectorId];
    const category = ADC_DETECTOR_CATALOG[hit.detectorId].category;
    mistakes.push({
      id: `mk-${hit.detectorId}`,
      category,
      severity: 'mistake',
      timestampSec: hit.timestampSec,
      title: copy.title(hit, kpis, bench),
      detail: copy.detail,
    });
    improvements.push({
      id: `imp-${hit.detectorId}`,
      category,
      severity: 'action',
      title: copy.improvement.title,
      detail: copy.improvement.detail,
    });
  }
  if (kpis.goldDiffAt15 !== null && kpis.goldDiffAt15 <= bench.goldDiffAt15 - 400) {
    mistakes.push({
      id: 'mk-adc-gd15',
      category: 'fighting',
      severity: 'mistake',
      timestampSec: 900,
      title: `Lost Lane (${kpis.goldDiffAt15}g @ 15m vs ${kpis.goldDiffSource === 'lane_opponent' ? laneOpponentName : 'enemy jungler (fallback)'})`,
      detail: 'Gold deficit vs your lane opponent delayed your first item spike into mid-game fights.',
    });
    if (!hitIds.has('adc_lane_death_pre_14') && !hitIds.has('adc_cs_deficit_10')) {
      improvements.push({
        id: 'imp-adc-gd15',
        category: 'fighting',
        severity: 'action',
        title: 'Trade on Enemy Last-Hit Windows',
        detail: 'Auto the enemy ADC only when they walk up to last-hit; back off as soon as their support is in range.',
      });
    }
  }
  if (improvements.length === 0) {
    improvements.push({
      id: 'imp-adc-convert',
      category: 'objectives',
      severity: 'action',
      title: 'Convert Lane Leads Into Mid-Lane Pressure',
      detail: 'After first tower, swap mid with your support and group for Dragon/Baron to close before 28:00.',
    });
  }

  // --- Weighted grade ------------------------------------------------------
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of ADC_KPI_KEYS) {
    const v = kpiValue(kpis, key);
    if (v === null) continue;
    weightedSum += ADC_GRADE_WEIGHTS[key] * scoreKpi(key, v, bench[key]);
    weightTotal += ADC_GRADE_WEIGHTS[key];
  }
  const kpiScore = weightTotal > 0 ? weightedSum / weightTotal : 1;
  const preObjCount = mistakeHits.find((h) => h.detectorId === 'adc_pre_obj_death')?.allTimestampsSec.length ?? 0;
  const isolatedCount = mistakeHits.find((h) => h.detectorId === 'adc_isolated_death')?.allTimestampsSec.length ?? 0;
  const gradePoints = Math.round(
    25 + 50 * kpiScore + (match.win ? 8 : 0) - preObjCount * 5 - isolatedCount * 4
  );

  // Focus suggestion = weakest "behind" KPI by weighted score.
  const behind = kpiBreakdown
    .filter((k) => k.status === 'behind')
    .sort(
      (a, b) =>
        scoreKpi(a.key, a.value, a.benchmark) * ADC_GRADE_WEIGHTS[a.key] -
        scoreKpi(b.key, b.value, b.benchmark) * ADC_GRADE_WEIGHTS[b.key]
    );

  return {
    ...base,
    isAdc: true,
    grade: gradeFromPoints(gradePoints),
    gradePoints,
    kpiBreakdown,
    highlights,
    mistakes,
    improvements,
    mistakeHits,
    focusSuggestion: behind[0]?.key,
  };
}
