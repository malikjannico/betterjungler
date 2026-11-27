import { formatChampionName } from './championNames';
import { formatClock } from './liveCoachEngine';
import { normalizeRiotCoordinate } from './postGameReviewEngine';
import type { LpHistoryPoint } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';

export interface GoldXpSeriesPoint {
  minute: number;
  goldDiff: number;
  xpDiff: number;
  csDiff: number;
}

export interface GoldXpSeriesSummary {
  points: GoldXpSeriesPoint[];
  maxLead: number;
  maxDeficit: number;
  swingMinute: number | null;
}

export function buildGoldXpSeries(match: MatchV5Detail): GoldXpSeriesSummary {
  const points: GoldXpSeriesPoint[] = match.frames.map((f) => ({
    minute: f.minute,
    goldDiff: f.totalGold - f.enemyJunglerGold,
    xpDiff: f.xp - f.enemyJunglerXp,
    csDiff: f.cs - f.enemyJunglerCs,
  }));

  let maxLead = 0;
  let maxDeficit = 0;
  let swingMinute: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    if (pt.goldDiff > maxLead) maxLead = pt.goldDiff;
    if (pt.goldDiff < maxDeficit) maxDeficit = pt.goldDiff;
    if (i > 0) {
      const prev = points[i - 1]!;
      if (
        (prev.goldDiff < 0 && pt.goldDiff >= 0) ||
        (prev.goldDiff > 0 && pt.goldDiff <= 0)
      ) {
        swingMinute = pt.minute;
      }
    }
  }

  return { points, maxLead, maxDeficit, swingMinute };
}

export type MapDangerZone =
  | 'Top River / Baron'
  | 'Bot River / Dragon'
  | 'Mid Lane'
  | 'Blue Quadrant'
  | 'Red Quadrant';

export interface DeathHeatmapPoint {
  id: string;
  matchId: string;
  championName: string;
  timestampFormatted: string;
  x: number;
  y: number;
  isPreObjective: boolean;
  zone: MapDangerZone;
}

export interface DeathHeatmapSummary {
  points: DeathHeatmapPoint[];
  totalDeaths: number;
  preObjectiveDeaths: number;
  topDangerZone: MapDangerZone | null;
  zoneCounts: Record<MapDangerZone, number>;
}

const KEY_OBJECTIVE_SPAWNS = [175, 300, 480, 900, 1200];

function classifyMapZone(x: number, y: number): MapDangerZone {
  if (x >= 240 && x <= 430 && y >= 200 && y <= 400) return 'Top River / Baron';
  if (x >= 570 && x <= 790 && y >= 600 && y <= 810) return 'Bot River / Dragon';
  if (Math.abs(x + y - 1000) < 130 && x >= 340 && x <= 660) return 'Mid Lane';
  if (x + y < 1000) return 'Red Quadrant';
  return 'Blue Quadrant';
}

export function aggregateDeathHeatmap(
  matches: MatchV5Detail[]
): DeathHeatmapSummary {
  const zoneCounts: Record<MapDangerZone, number> = {
    'Top River / Baron': 0,
    'Bot River / Dragon': 0,
    'Mid Lane': 0,
    'Blue Quadrant': 0,
    'Red Quadrant': 0,
  };

  const points: DeathHeatmapPoint[] = [];
  let preObjectiveDeaths = 0;

  for (const match of matches) {
    const myTeamId = match.mapSide === 'blue' ? 100 : 200;
    const enemyObjs = match.events.filter(
      (e) =>
        e.type === 'ELITE_MONSTER_KILL' &&
        typeof e.killerTeamId === 'number' &&
        e.killerTeamId !== myTeamId
    );

    match.events.forEach((ev, idx) => {
      if (
        ev.type !== 'CHAMPION_KILL' ||
        ev.victimId !== match.playerParticipantId ||
        !ev.position ||
        !Number.isFinite(ev.position.x) ||
        !Number.isFinite(ev.position.y)
      ) {
        return;
      }

      const { x, y } = normalizeRiotCoordinate(ev.position.x, ev.position.y);
      const isPreObjective =
        enemyObjs.some(
          (o) => ev.timestampSec <= o.timestampSec && o.timestampSec - ev.timestampSec <= 55
        ) ||
        KEY_OBJECTIVE_SPAWNS.some(
          (s) => ev.timestampSec <= s && s - ev.timestampSec <= 45
        );

      if (isPreObjective) preObjectiveDeaths += 1;
      const zone = classifyMapZone(x, y);
      zoneCounts[zone] += 1;

      points.push({
        id: `${match.matchId}-d-${idx}`,
        matchId: match.matchId,
        championName: formatChampionName(match.championName, match.championId),
        timestampFormatted: formatClock(ev.timestampSec),
        x,
        y,
        isPreObjective,
        zone,
      });
    });
  }

  let topDangerZone: MapDangerZone | null = null;
  let topCount = 0;
  for (const [zone, count] of Object.entries(zoneCounts) as Array<[MapDangerZone, number]>) {
    if (count > topCount) {
      topCount = count;
      topDangerZone = zone;
    }
  }

  return {
    points,
    totalDeaths: points.length,
    preObjectiveDeaths,
    topDangerZone,
    zoneCounts,
  };
}

export interface LpDeltaSummary {
  netLpChange: number;
  currentLabel: string;
  minAbsLp: number;
  maxAbsLp: number;
  streakText: string;
}

export function computeLpDeltaSummary(history: LpHistoryPoint[]): LpDeltaSummary {
  if (history.length === 0) {
    return {
      netLpChange: 0,
      currentLabel: 'UNRANKED',
      minAbsLp: 0,
      maxAbsLp: 100,
      streakText: '0 games',
    };
  }

  const first = history[0]!;
  const last = history[history.length - 1]!;
  const netLpChange = last.absoluteLp - first.absoluteLp;

  let minAbsLp = first.absoluteLp;
  let maxAbsLp = first.absoluteLp;
  for (const pt of history) {
    if (pt.absoluteLp < minAbsLp) minAbsLp = pt.absoluteLp;
    if (pt.absoluteLp > maxAbsLp) maxAbsLp = pt.absoluteLp;
  }

  // Current win/loss streak from the end (ignoring neutral baseline snapshots)
  let streak = 0;
  let streakOutcome: boolean | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const ptWin = history[i]!.win;
    if (typeof ptWin !== 'boolean') break;
    if (streakOutcome === null) {
      streakOutcome = ptWin;
      streak = 1;
    } else if (ptWin === streakOutcome) {
      streak += 1;
    } else {
      break;
    }
  }

  return {
    netLpChange,
    currentLabel: `${last.tier} ${last.rank} • ${last.leaguePoints} LP`,
    minAbsLp: Math.max(0, minAbsLp - 15),
    maxAbsLp: maxAbsLp + 15,
    streakText:
      streakOutcome === null
        ? 'Baseline'
        : `${streak}${streakOutcome ? 'W' : 'L'} streak`,
  };
}

const ORDERED_DIVISIONS: ReadonlyArray<{ tier: string; rank: string; baseLp: number; shortLabel: string }> = [
  { tier: 'IRON', rank: 'IV', baseLp: 0, shortLabel: 'Iron IV' },
  { tier: 'IRON', rank: 'III', baseLp: 100, shortLabel: 'Iron III' },
  { tier: 'IRON', rank: 'II', baseLp: 200, shortLabel: 'Iron II' },
  { tier: 'IRON', rank: 'I', baseLp: 300, shortLabel: 'Iron I' },
  { tier: 'BRONZE', rank: 'IV', baseLp: 400, shortLabel: 'Bronze IV' },
  { tier: 'BRONZE', rank: 'III', baseLp: 500, shortLabel: 'Bronze III' },
  { tier: 'BRONZE', rank: 'II', baseLp: 600, shortLabel: 'Bronze II' },
  { tier: 'BRONZE', rank: 'I', baseLp: 700, shortLabel: 'Bronze I' },
  { tier: 'SILVER', rank: 'IV', baseLp: 800, shortLabel: 'Silver IV' },
  { tier: 'SILVER', rank: 'III', baseLp: 900, shortLabel: 'Silver III' },
  { tier: 'SILVER', rank: 'II', baseLp: 1000, shortLabel: 'Silver II' },
  { tier: 'SILVER', rank: 'I', baseLp: 1100, shortLabel: 'Silver I' },
  { tier: 'GOLD', rank: 'IV', baseLp: 1200, shortLabel: 'Gold IV' },
  { tier: 'GOLD', rank: 'III', baseLp: 1300, shortLabel: 'Gold III' },
  { tier: 'GOLD', rank: 'II', baseLp: 1400, shortLabel: 'Gold II' },
  { tier: 'GOLD', rank: 'I', baseLp: 1500, shortLabel: 'Gold I' },
  { tier: 'PLATINUM', rank: 'IV', baseLp: 1600, shortLabel: 'Plat IV' },
  { tier: 'PLATINUM', rank: 'III', baseLp: 1700, shortLabel: 'Plat III' },
  { tier: 'PLATINUM', rank: 'II', baseLp: 1800, shortLabel: 'Plat II' },
  { tier: 'PLATINUM', rank: 'I', baseLp: 1900, shortLabel: 'Plat I' },
  { tier: 'EMERALD', rank: 'IV', baseLp: 2000, shortLabel: 'Em IV' },
  { tier: 'EMERALD', rank: 'III', baseLp: 2100, shortLabel: 'Em III' },
  { tier: 'EMERALD', rank: 'II', baseLp: 2200, shortLabel: 'Em II' },
  { tier: 'EMERALD', rank: 'I', baseLp: 2300, shortLabel: 'Em I' },
  { tier: 'DIAMOND', rank: 'IV', baseLp: 2400, shortLabel: 'Dia IV' },
  { tier: 'DIAMOND', rank: 'III', baseLp: 2500, shortLabel: 'Dia III' },
  { tier: 'DIAMOND', rank: 'II', baseLp: 2600, shortLabel: 'Dia II' },
  { tier: 'DIAMOND', rank: 'I', baseLp: 2700, shortLabel: 'Dia I' },
  { tier: 'MASTER', rank: '', baseLp: 2800, shortLabel: 'Master' },
];

export { ORDERED_DIVISIONS };

/** Matches Rust `tier_rank_to_absolute_lp` (100 LP per division, Master = 2800). */
export function divisionLabelToAbsoluteLp(division: string): number {
  const parts = division.trim().toUpperCase().split(/\s+/);
  const tier = parts[0] ?? 'PLATINUM';
  const rank = parts[1] ?? 'IV';
  if (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER') {
    return 2800;
  }
  const match = ORDERED_DIVISIONS.find((d) => d.tier === tier && d.rank === rank);
  if (match) return match.baseLp;
  const tierDefault = ORDERED_DIVISIONS.find((d) => d.tier === tier);
  return tierDefault ? tierDefault.baseLp : 1600;
}

export function formatTitleDivision(tier: string, rank: string): string {
  const t = tier.trim();
  if (!t) return 'Unranked';
  const titleTier = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  const r = rank.trim().toUpperCase();
  return r && titleTier !== 'Master' && titleTier !== 'Grandmaster' && titleTier !== 'Challenger'
    ? `${titleTier} ${r}`
    : titleTier;
}

export function absoluteLpToDivisionLabel(absLp: number): string {
  if (absLp >= 2800) {
    return `Master · ${Math.round(absLp - 2800)} LP`;
  }
  const clamped = Math.max(0, Math.round(absLp));
  const idx = Math.min(ORDERED_DIVISIONS.length - 1, Math.floor(clamped / 100));
  const div = ORDERED_DIVISIONS[idx]!;
  const remLp = clamped - div.baseLp;
  return `${formatTitleDivision(div.tier, div.rank)} · ${remLp} LP`;
}

export interface LpTargetProgress {
  currentAbsLp: number;
  currentLabel: string;
  targetAbsLp: number;
  targetLabel: string;
  lpRemaining: number;
  divisionsRemaining: number;
  estimatedNetWins: number;
  goalReached: boolean;
}

export function computeLpTargetProgress(
  currentAbsLp: number,
  targetDivision: string
): LpTargetProgress {
  const targetAbsLp = divisionLabelToAbsoluteLp(targetDivision);
  const [rawTier = 'PLATINUM', rawRank = 'IV'] = targetDivision.trim().split(/\s+/);
  const targetLabel = formatTitleDivision(rawTier, rawRank);
  const lpRemaining = Math.max(0, targetAbsLp - currentAbsLp);
  const divisionsRemaining = Math.max(0, Math.ceil(lpRemaining / 100));
  const estimatedNetWins = lpRemaining === 0 ? 0 : Math.ceil(lpRemaining / 22);
  return {
    currentAbsLp,
    currentLabel: absoluteLpToDivisionLabel(currentAbsLp),
    targetAbsLp,
    targetLabel,
    lpRemaining,
    divisionsRemaining,
    estimatedNetWins,
    goalReached: lpRemaining === 0,
  };
}
