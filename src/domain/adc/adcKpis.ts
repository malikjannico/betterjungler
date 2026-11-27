import { formatChampionName } from '../championNames';
import { normalizePlayedRole } from '../roles/types';
import type { MatchV5Detail, MatchV5FramePoint } from '../../types/riot';
import type { AdcMatchKpis, AdcMatchSummary } from './adcReviewTypes';

/** 14:00 — turret plates fall, laning phase ends. */
export const ADC_LANE_PHASE_END_SEC = 840;
export const ADC_MIN_VALID_MATCH_SECONDS = 300;

/**
 * Strict ADC role gate: only explicit `BOTTOM` / `BOT` / `ADC`. An empty role is treated as
 * Jungle by the Jungle engines, so it is deliberately NOT an ADC match here.
 */
export function isAdcMatch(match: { role?: string | null }): boolean {
  return normalizePlayedRole(match.role) === 'bottom';
}

export function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function findFrameNear(
  frames: MatchV5FramePoint[],
  minute: number,
  maxDistanceMinutes: number
): MatchV5FramePoint | undefined {
  let best: MatchV5FramePoint | undefined;
  for (const f of frames) {
    const dist = Math.abs(f.minute - minute);
    if (dist > maxDistanceMinutes) continue;
    if (!best || dist < Math.abs(best.minute - minute)) best = f;
  }
  return best;
}

export function getPlayerDeathTimestamps(match: MatchV5Detail): number[] {
  return match.events
    .filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === match.playerParticipantId)
    .map((e) => e.timestampSec)
    .sort((a, b) => a - b);
}

/** Extracts the 7 ADC KPIs (+ DPM and level-2 timing) from a Match-V5 detail. Role-agnostic. */
export function extractAdcMatchKpis(match: MatchV5Detail): AdcMatchKpis {
  const durationMins = Math.max(1, match.durationSeconds / 60);
  const csPerMin = roundTo(match.cs / durationMins, 1);

  // CS@10 mirrors storage.rs: exact 10:00 frame, else 11:00, and only in games that reached 10:00.
  const frame10 =
    match.frames.find((f) => f.minute === 10) ?? match.frames.find((f) => f.minute === 11);
  const csAt10 = match.durationSeconds >= 600 && frame10 ? frame10.cs : null;
  const csAt10Minute = csAt10 !== null && frame10 ? frame10.minute : null;

  // GD@15 vs the lane opponent; falls back to the enemy jungler only when lane data is missing.
  let goldDiffAt15: number | null = null;
  let goldDiffSource: AdcMatchKpis['goldDiffSource'] = 'unavailable';
  const frame15 = match.durationSeconds >= 900 ? findFrameNear(match.frames, 15, 1) : undefined;
  if (frame15) {
    const laneGold = frame15.laneOpponentGold;
    if (typeof laneGold === 'number' && Number.isFinite(laneGold)) {
      goldDiffAt15 = Math.round(frame15.totalGold - laneGold);
      goldDiffSource = 'lane_opponent';
    } else if (Number.isFinite(frame15.enemyJunglerGold)) {
      goldDiffAt15 = Math.round(frame15.totalGold - frame15.enemyJunglerGold);
      goldDiffSource = 'enemy_jungler_fallback';
    }
  }

  const dmg = match.damageDealtToChampions;
  const teamDmg = match.teamTotalDamage;
  const hasDamage = typeof dmg === 'number' && Number.isFinite(dmg) && dmg >= 0;
  const damageSharePct =
    hasDamage && typeof teamDmg === 'number' && Number.isFinite(teamDmg) && teamDmg > 0
      ? roundTo(Math.min(100, (dmg / teamDmg) * 100), 1)
      : null;
  const damagePerMin = hasDamage ? Math.round(dmg / durationMins) : null;

  const deathsPre14 = getPlayerDeathTimestamps(match).filter(
    (ts) => ts < ADC_LANE_PHASE_END_SEC
  ).length;

  const plateEvents = match.events.filter(
    (e) => e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === match.playerParticipantId
  ).length;
  const turretPlates =
    typeof match.turretPlatesTaken === 'number' && Number.isFinite(match.turretPlatesTaken)
      ? match.turretPlatesTaken
      : plateEvents;

  // storage/riot_api maps LEVEL_UP.participantId -> killerId.
  const level2Event = match.events.find(
    (e) => e.type === 'LEVEL_UP' && e.level === 2 && e.killerId === match.playerParticipantId
  );
  const level2TimeSec =
    typeof match.level2TimeSec === 'number' && Number.isFinite(match.level2TimeSec)
      ? match.level2TimeSec
      : (level2Event?.timestampSec ?? null);

  const killParticipationPct =
    match.teamKills > 0
      ? Math.min(100, Math.round(((match.kills + match.assists) / match.teamKills) * 100))
      : 0;

  return {
    csAt10,
    csAt10Minute,
    csPerMin,
    goldDiffAt15,
    goldDiffSource,
    damageSharePct,
    damagePerMin,
    deathsPre14,
    turretPlates,
    level2TimeSec,
    killParticipationPct,
  };
}

export function toAdcMatchSummary(
  match: MatchV5Detail,
  kpis: AdcMatchKpis = extractAdcMatchKpis(match)
): AdcMatchSummary {
  return {
    matchId: match.matchId,
    playedAt: match.playedAt,
    role: match.role ?? '',
    championId: match.championId,
    championName: formatChampionName(match.championName, match.championId),
    win: match.win,
    durationSeconds: match.durationSeconds,
    csAt10: kpis.csAt10,
    csPerMin: kpis.csPerMin,
    goldDiffAt15: kpis.goldDiffAt15,
    damageSharePct: kpis.damageSharePct,
    deathsPre14: kpis.deathsPre14,
    turretPlates: kpis.turretPlates,
    killParticipationPct: kpis.killParticipationPct,
  };
}

export function safePlayedAtMs(playedAt: string): number {
  const ts = Date.parse(playedAt);
  return Number.isFinite(ts) ? ts : 0;
}
