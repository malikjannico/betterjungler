import { formatClock } from './liveCoachEngine';
import { parseTargetTier, DIVISION_BENCHMARKS } from './climbLadderEngine';
import type {
  NormalizedMapPoint,
  PostGameKpis,
  PostGameReviewReport,
  ReviewFinding,
  TimelineMapMarker,
} from '../types/coaching';
import type { MatchSummaryRecord, MatchV5Detail } from '../types/riot';

const RIOT_MAP_MAX = 14870;
const KEY_SPAWN_SECONDS = [300, 360, 840, 1500];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Converts Riot Match-V5 coordinates [0..14870] (bottom-left origin)
 * into Summoner's Rift SVG coordinates [0..1000] (top-left origin).
 */
export function normalizeRiotCoordinate(
  riotX: number,
  riotY: number
): { x: number; y: number } {
  const safeX = Number.isFinite(riotX) ? riotX : RIOT_MAP_MAX / 2;
  const safeY = Number.isFinite(riotY) ? riotY : RIOT_MAP_MAX / 2;
  const x = clamp(Math.round((safeX / RIOT_MAP_MAX) * 1000), 0, 1000);
  const y = clamp(Math.round(1000 - (safeY / RIOT_MAP_MAX) * 1000), 0, 1000);
  return { x, y };
}

function toNormalizedFramePoint(
  minute: number,
  pos: { x: number; y: number } | null | undefined
): NormalizedMapPoint[] {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
    return [];
  }
  const norm = normalizeRiotCoordinate(pos.x, pos.y);
  return [{ minute, x: norm.x, y: norm.y }];
}

function getFrameAtMinute(match: MatchV5Detail, targetMinute: number) {
  return (
    match.frames.find((f) => f.minute === targetMinute) ??
    match.frames.reduce<MatchV5Detail['frames'][number] | undefined>((closest, cur) => {
      if (!closest) return cur;
      return Math.abs(cur.minute - targetMinute) < Math.abs(closest.minute - targetMinute)
        ? cur
        : closest;
    }, undefined)
  );
}

export function analyzePostGameMatch(
  match: MatchV5Detail,
  targetDivision = 'PLATINUM IV'
): PostGameReviewReport {
  const durationMins = Math.max(1, match.durationSeconds / 60);
  const csPerMin = Math.round((match.cs / durationMins) * 10) / 10;
  const visionPerMin = Math.round((match.visionScore / durationMins) * 100) / 100;
  const controlWardsBought = match.controlWardsBought;

  const exactFrame4 = match.frames.find((f) => f.minute === 4);
  const exactFrame5 = match.frames.find((f) => f.minute === 5);
  const frame6 = match.frames.find((f) => f.minute === 6);
  const csAt4 = match.durationSeconds < 240 ? undefined : exactFrame4?.cs;
  const csAt5 =
    match.durationSeconds < 300
      ? undefined
      : exactFrame5?.cs ??
        (exactFrame4 && frame6 ? Math.round((exactFrame4.cs + frame6.cs) / 2) : undefined);
  const exactFrame10 =
    match.frames.find((f) => f.minute === 10) ?? match.frames.find((f) => f.minute === 11);
  const csAt10 = match.durationSeconds < 600 ? undefined : exactFrame10?.cs;
  const csAt10Minute = csAt10 !== undefined ? exactFrame10?.minute : undefined;
  const frame10 = getFrameAtMinute(match, 10);
  const frame15 = getFrameAtMinute(match, 15);
  const goldDiffAt10 = frame10 ? frame10.totalGold - frame10.enemyJunglerGold : 0;
  const goldDiffAt15 = frame15 ? frame15.totalGold - frame15.enemyJunglerGold : 0;
  const xpDiffAt15 = frame15 ? frame15.xp - frame15.enemyJunglerXp : 0;

  const totalObj = match.teamObjectives + match.enemyObjectives;
  const objectiveSharePct =
    totalObj > 0 ? Math.round((match.teamObjectives / totalObj) * 100) : 50;
  const killParticipationPct =
    match.teamKills > 0
      ? Math.min(100, Math.round(((match.kills + match.assists) / match.teamKills) * 100))
      : 0;

  const myTeamId = match.mapSide === 'blue' ? 100 : 200;
  const enemyMonsterKills = match.events.filter(
    (e) =>
      e.type === 'ELITE_MONSTER_KILL' &&
      typeof e.killerTeamId === 'number' &&
      e.killerTeamId !== myTeamId
  );

  const playerDeaths = match.events.filter(
    (e) => e.type === 'CHAMPION_KILL' && e.victimId === match.playerParticipantId
  );

  const earlyDeaths = playerDeaths.filter((d) => d.timestampSec < 600).length;

  const preObjDeathEvents = playerDeaths.filter((death) => {
    const nearEnemyObj = enemyMonsterKills.some(
      (obj) =>
        death.timestampSec <= obj.timestampSec &&
        obj.timestampSec - death.timestampSec <= 55
    );
    const nearMajorSpawn = KEY_SPAWN_SECONDS.some(
      (spawn) =>
        death.timestampSec <= spawn && spawn - death.timestampSec <= 45
    );
    return nearEnemyObj || nearMajorSpawn;
  });

  const kpis: PostGameKpis = {
    csPerMin,
    csAt4,
    csAt5,
    csAt10,
    csAt10Minute,
    goldDiffAt10,
    goldDiffAt15,
    xpDiffAt15,
    visionPerMin,
    controlWardsBought: match.controlWardsBought,
    objectiveSharePct,
    killParticipationPct,
    earlyDeaths,
    preObjectiveDeaths: preObjDeathEvents.length,
  };

  // Build path trail & timeline markers
  const pathPoints: NormalizedMapPoint[] = match.frames.flatMap((frame) =>
    toNormalizedFramePoint(frame.minute, frame.position)
  );

  const enemyPathPoints: NormalizedMapPoint[] = match.frames.flatMap((frame) =>
    toNormalizedFramePoint(frame.minute, frame.enemyJunglerPosition)
  );

  const preObjSet = new Set(preObjDeathEvents.map((e) => e.timestampSec));
  const markers: TimelineMapMarker[] = [];

  match.events.forEach((ev, index) => {
    if (
      !ev.position ||
      !Number.isFinite(ev.position.x) ||
      !Number.isFinite(ev.position.y)
    ) {
      return;
    }
    const { x, y } = normalizeRiotCoordinate(ev.position.x, ev.position.y);
    const minute = Math.floor(ev.timestampSec / 60);
    const timeLabel = formatClock(ev.timestampSec);

    if (ev.type === 'CHAMPION_KILL') {
      if (ev.killerId === match.playerParticipantId) {
        markers.push({
          id: `kill-${index}`,
          minute,
          timestampSec: ev.timestampSec,
          kind: 'kill',
          x,
          y,
          label: `Kill @ ${timeLabel}`,
          detail: 'You secured a kill — convert immediately into camps, plates, or objective pressure.',
        });
      } else if (ev.victimId === match.playerParticipantId) {
        const isPreObj = preObjSet.has(ev.timestampSec);
        markers.push({
          id: `death-${index}`,
          minute,
          timestampSec: ev.timestampSec,
          kind: isPreObj ? 'pre_obj_death' : 'death',
          x,
          y,
          label: isPreObj ? `Pre-Objective Death @ ${timeLabel}` : `Death @ ${timeLabel}`,
          detail: isPreObj
            ? 'Critical mistake: Dying <50s before Dragon/Herald/Baron removes your Smite from the objective.'
            : 'Avoidable death: Review wave states & enemy jungler tracking before entering this fog area.',
        });
      } else if (ev.assistingParticipantIds?.includes(match.playerParticipantId)) {
        markers.push({
          id: `assist-${index}`,
          minute,
          timestampSec: ev.timestampSec,
          kind: 'assist',
          x,
          y,
          label: `Assist @ ${timeLabel}`,
          detail: 'Successful gank/skirmish assist — check if lane wave should be pushed.',
        });
      }
    } else if (ev.type === 'WARD_PLACED' && ev.creatorId === match.playerParticipantId) {
      const isControl = ev.wardType === 'CONTROL_WARD';
      markers.push({
        id: `ward-${index}`,
        minute,
        timestampSec: ev.timestampSec,
        kind: isControl ? 'control_ward' : 'ward',
        x,
        y,
        label: `${isControl ? 'Control Ward' : 'Ward'} @ ${timeLabel}`,
        detail: isControl
          ? 'Control Ward placed to deny river/pit vision.'
          : 'Stealth Ward placed for jungle/river tracking.',
      });
    } else if (ev.type === 'ELITE_MONSTER_KILL') {
      const yours = ev.killerTeamId === myTeamId;
      markers.push({
        id: `obj-${index}`,
        minute,
        timestampSec: ev.timestampSec,
        kind: 'objective',
        x,
        y,
        label: `${yours ? 'Secured' : 'Lost'} ${ev.monsterType ?? 'Objective'} @ ${timeLabel}`,
        detail: yours
          ? `Team secured ${ev.monsterType ?? 'neutral objective'}.`
          : `Enemy team took ${ev.monsterType ?? 'neutral objective'} — check cross-map trade or setup timing.`,
      });
    }
  });

  // Evaluate against target division benchmarks
  const tier = parseTargetTier(targetDivision);
  const bench = DIVISION_BENCHMARKS[tier];

  const highlights: ReviewFinding[] = [];
  const mistakes: ReviewFinding[] = [];
  const improvements: ReviewFinding[] = [];

  if (goldDiffAt15 >= 300) {
    highlights.push({
      id: 'hl-gd15',
      category: 'pathing',
      severity: 'positive',
      title: `Strong Early Jungle Tempo (+${goldDiffAt15}g @ 15m)`,
      detail:
        csAt4 !== undefined
          ? `Out-paced ${match.enemyJunglerName} through the first 15 minutes with ${csAt4} CS at 4:00.`
          : `Out-paced ${match.enemyJunglerName} through the first 15 minutes in early jungle gold tempo.`,
    });
  }
  if (objectiveSharePct >= 55) {
    highlights.push({
      id: 'hl-obj',
      category: 'objectives',
      severity: 'positive',
      title: `High Objective Control (${objectiveSharePct}%)`,
      detail: `Secured ${match.teamObjectives} of ${totalObj} major objectives, directly driving map pressure.`,
    });
  }
  if (preObjDeathEvents.length === 0) {
    highlights.push({
      id: 'hl-no-pre-obj-death',
      category: 'objectives',
      severity: 'positive',
      title: 'Zero Pre-Objective Deaths',
      detail: 'Stayed alive before major objective spawns so your Smite was always available for the team.',
    });
  }
  if (csPerMin >= bench.csPerMin) {
    highlights.push({
      id: 'hl-cs',
      category: 'farming',
      severity: 'positive',
      title: `Target-Level Camp Efficiency (${csPerMin} CS/min)`,
      detail: `Exceeded the ${tier} benchmark of ${bench.csPerMin} CS/min while maintaining ${killParticipationPct}% KP.`,
    });
  }
  if (controlWardsBought >= 4) {
    highlights.push({
      id: 'hl-vision',
      category: 'vision',
      severity: 'positive',
      title: `Disciplined Control Ward Usage (${controlWardsBought} bought)`,
      detail: `Consistent pit & river vision denial (${visionPerMin} vision/min).`,
    });
  }

  // Mistakes
  if (preObjDeathEvents.length > 0) {
    const first = preObjDeathEvents[0]!;
    mistakes.push({
      id: 'mk-pre-obj-death',
      category: 'objectives',
      severity: 'mistake',
      timestampSec: first.timestampSec,
      title: `${preObjDeathEvents.length} Pre-Objective Death(s) (first at ${formatClock(first.timestampSec)})`,
      detail:
        'Dying within 50 seconds of Dragon, Herald, or Baron gives the enemy team a free Smite-uncontested objective.',
    });
    improvements.push({
      id: 'imp-pre-obj',
      category: 'objectives',
      severity: 'action',
      title: 'Recall & Reset 60s Before Neutral Objectives',
      detail:
        'Check the Live Objective countdown 75s out, finish your quadrant, spend gold, and avoid solo face-checking fog.',
    });
  }

  if (csPerMin < bench.csPerMin - 0.5) {
    mistakes.push({
      id: 'mk-low-cs',
      category: 'farming',
      severity: 'mistake',
      title: `Low Jungle Farm Tempo (${csPerMin} vs ${bench.csPerMin} CS/min target)`,
      detail:
        'Skipping respawned camps during mid-game roaming caused you to fall behind in XP and item spikes.',
    });
    improvements.push({
      id: 'imp-cs-cycle',
      category: 'farming',
      severity: 'action',
      title: 'Sequence Camps Before Looking for Plays',
      detail:
        'Clear your strong-side quadrant on respawn before hovering lanes; aim for at least 24+ CS at 4:00 and steady mid-game cycles.',
    });
  }

  if (goldDiffAt15 < -300) {
    mistakes.push({
      id: 'mk-gd15',
      category: 'pathing',
      severity: 'mistake',
      title: `Fell Behind Early (${goldDiffAt15}g @ 15m vs ${match.enemyJunglerName})`,
      detail: 'Lost early skirmishes or forced low-odds ganks while enemy jungler counter-jungled.',
    });
    improvements.push({
      id: 'imp-crossmap',
      category: 'pathing',
      severity: 'action',
      title: 'Trade Cross-Map When Weak Early',
      detail:
        'Whenever the enemy jungler shows on one side, immediately invade their opposite quadrant or take the opposite objective.',
    });
  }

  if (controlWardsBought <= 2 || visionPerMin < bench.visionPerMin - 0.15) {
    mistakes.push({
      id: 'mk-vision',
      category: 'vision',
      severity: 'mistake',
      title: `Under-Invested in Vision (${controlWardsBought} Control Wards, ${visionPerMin}/min)`,
      detail: `Below ${tier} expectation (${bench.visionPerMin}/min), making objective setups blind.`,
    });
    improvements.push({
      id: 'imp-wards',
      category: 'vision',
      severity: 'action',
      title: 'Buy 1 Control Ward Every Objective Reset',
      detail:
        'Prioritize placing Control Wards at Dragon/Baron river entrances 45s prior to spawn and switch to Oracle Lens by level 6.',
    });
  }

  if (earlyDeaths >= 2) {
    mistakes.push({
      id: 'mk-early-deaths',
      category: 'fighting',
      severity: 'mistake',
      title: `${earlyDeaths} Early Deaths Before 10:00`,
      detail: 'Early deaths hand over double buffs, Scuttle control, and tempo across all lanes.',
    });
    improvements.push({
      id: 'imp-respect-prio',
      category: 'fighting',
      severity: 'action',
      title: 'Check Lane Priority Before River Contests',
      detail:
        'Never contest 3:30 Scuttle or early invades if both adjacent lanes are pushed under their own turrets.',
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      id: 'hl-kp',
      category: 'fighting',
      severity: 'positive',
      title: `Consistent Team Presence (${killParticipationPct}% KP)`,
      detail: 'Participated in key skirmishes across the map.',
    });
  }
  if (improvements.length === 0) {
    improvements.push({
      id: 'imp-keep-tempo',
      category: 'pathing',
      severity: 'action',
      title: 'Push Tempo into Enemy Tier-2 Towers',
      detail:
        'Convert your objective & gold leads faster by grouping with Baron/Herald to close games under 28 minutes.',
    });
  }

  // Score -> Grade
  let points = match.win ? 72 : 55;
  if (csPerMin >= bench.csPerMin) points += 8;
  if (goldDiffAt15 >= 300) points += 8;
  else if (goldDiffAt15 < -300) points -= 7;
  if (objectiveSharePct >= 60) points += 8;
  if (visionPerMin >= bench.visionPerMin) points += 5;
  points -= preObjDeathEvents.length * 10;
  points -= Math.max(0, earlyDeaths - 1) * 6;

  const grade: PostGameReviewReport['grade'] =
    points >= 90 ? 'S' : points >= 78 ? 'A' : points >= 64 ? 'B' : points >= 50 ? 'C' : 'D';

  return {
    matchId: match.matchId,
    championName: match.championName,
    enemyJunglerName: match.enemyJunglerName,
    win: match.win,
    durationSeconds: match.durationSeconds,
    grade,
    kpis,
    highlights,
    mistakes,
    improvements,
    pathPoints,
    enemyPathPoints,
    markers,
  };
}

export function toMatchSummaryRecord(
  match: MatchV5Detail,
  report: PostGameReviewReport
): MatchSummaryRecord {
  return {
    matchId: match.matchId,
    playedAt: match.playedAt,
    championId: match.championId,
    championName: match.championName,
    win: match.win,
    durationSeconds: match.durationSeconds,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    csPerMin: report.kpis.csPerMin,
    visionPerMin: report.kpis.visionPerMin,
    controlWards: match.controlWardsBought,
    goldDiffAt15: report.kpis.goldDiffAt15,
    objectiveSharePct: report.kpis.objectiveSharePct,
    killParticipationPct: report.kpis.killParticipationPct,
    preObjectiveDeaths: report.kpis.preObjectiveDeaths,
  };
}
