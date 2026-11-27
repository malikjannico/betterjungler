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
