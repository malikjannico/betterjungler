import { analyzePostGameMatch, toMatchSummaryRecord } from './postGameReviewEngine';
import type { HighEloMetaSnapshot, LpHistoryPoint } from '../types/coaching';
import type { MatchSummaryRecord, MatchV5Detail } from '../types/riot';

export const DEMO_POST_GAME_MATCHES: MatchV5Detail[] = [
  {
    matchId: 'EUW1_71001',
    playedAt: '2026-11-26T19:40:00Z',
    durationSeconds: 1720, // 28:40
    patch: '16.1',
    queueId: 420,
    win: true,
    mapSide: 'blue',
    playerParticipantId: 2,
    championId: 234,
    championName: 'Viego',
    enemyJunglerChampionId: 56,
    enemyJunglerName: 'Nocturne',
    kills: 8,
    deaths: 2,
    assists: 7,
    cs: 198, // 6.9 CS/min
    visionScore: 31, // 1.08/min
    controlWardsBought: 5,
    teamKills: 24,
    teamObjectives: 6,
    enemyObjectives: 2,
    items: [6672, 6610, 3053, 3047, 3026],
    frames: [
      { minute: 1, position: { x: 7800, y: 4000 }, enemyJunglerPosition: { x: 7200, y: 10900 }, totalGold: 500, xp: 0, cs: 0, enemyJunglerGold: 500, enemyJunglerXp: 0, enemyJunglerCs: 0 },
      { minute: 2, position: { x: 8400, y: 2700 }, enemyJunglerPosition: { x: 10900, y: 7400 }, totalGold: 810, xp: 520, cs: 12, enemyJunglerGold: 790, enemyJunglerXp: 500, enemyJunglerCs: 11 },
      { minute: 3, position: { x: 3800, y: 7800 }, enemyJunglerPosition: { x: 6800, y: 11600 }, totalGold: 1180, xp: 1120, cs: 24, enemyJunglerGold: 1100, enemyJunglerXp: 1050, enemyJunglerCs: 22 },
      { minute: 4, position: { x: 4300, y: 10200 }, enemyJunglerPosition: { x: 4600, y: 9800 }, totalGold: 1620, xp: 1580, cs: 28, enemyJunglerGold: 1320, enemyJunglerXp: 1410, enemyJunglerCs: 24 },
      { minute: 6, position: { x: 4800, y: 10400 }, enemyJunglerPosition: { x: 9500, y: 4900 }, totalGold: 2350, xp: 2450, cs: 42, enemyJunglerGold: 2050, enemyJunglerXp: 2200, enemyJunglerCs: 38 },
      { minute: 8, position: { x: 10100, y: 4400 }, enemyJunglerPosition: { x: 7600, y: 8100 }, totalGold: 3240, xp: 3400, cs: 58, enemyJunglerGold: 2820, enemyJunglerXp: 3100, enemyJunglerCs: 52 },
      { minute: 10, position: { x: 7400, y: 7400 }, enemyJunglerPosition: { x: 7700, y: 7300 }, totalGold: 4120, xp: 4520, cs: 72, enemyJunglerGold: 3490, enemyJunglerXp: 4050, enemyJunglerCs: 64 },
      { minute: 13, position: { x: 10800, y: 4600 }, enemyJunglerPosition: { x: 5200, y: 11200 }, totalGold: 5450, xp: 6150, cs: 94, enemyJunglerGold: 4700, enemyJunglerXp: 5520, enemyJunglerCs: 84 },
      { minute: 15, position: { x: 9600, y: 5200 }, enemyJunglerPosition: { x: 8900, y: 6900 }, totalGold: 6420, xp: 7350, cs: 108, enemyJunglerGold: 5500, enemyJunglerXp: 6550, enemyJunglerCs: 95 },
      { minute: 19, position: { x: 10100, y: 4300 }, enemyJunglerPosition: { x: 9800, y: 4800 }, totalGold: 8450, xp: 9650, cs: 136, enemyJunglerGold: 7100, enemyJunglerXp: 8550, enemyJunglerCs: 120 },
      { minute: 24, position: { x: 4900, y: 10300 }, enemyJunglerPosition: { x: 5600, y: 10800 }, totalGold: 11200, xp: 12800, cs: 170, enemyJunglerGold: 9100, enemyJunglerXp: 11100, enemyJunglerCs: 148 },
      { minute: 28, position: { x: 11800, y: 11500 }, enemyJunglerPosition: { x: 12500, y: 12200 }, totalGold: 13650, xp: 15400, cs: 198, enemyJunglerGold: 10700, enemyJunglerXp: 13200, enemyJunglerCs: 168 },
    ],
    events: [
      { type: 'WARD_PLACED', timestampSec: 78, creatorId: 2, wardType: 'YELLOW_TRINKET', position: { x: 7900, y: 9000 } },
      { type: 'CHAMPION_KILL', timestampSec: 225, killerId: 2, victimId: 6, position: { x: 3100, y: 12400 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 385, killerId: 2, killerTeamId: 100, monsterType: 'HORDE', position: { x: 4850, y: 10450 } },
      { type: 'WARD_PLACED', timestampSec: 460, creatorId: 2, wardType: 'CONTROL_WARD', position: { x: 10100, y: 4600 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 495, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
      { type: 'CHAMPION_KILL', timestampSec: 710, killerId: 7, victimId: 2, position: { x: 7500, y: 7400 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 890, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
      { type: 'CHAMPION_KILL', timestampSec: 1140, killerId: 2, victimId: 7, position: { x: 10400, y: 4900 } },
      { type: 'WARD_PLACED', timestampSec: 1380, creatorId: 2, wardType: 'CONTROL_WARD', position: { x: 4950, y: 10350 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 1480, killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', position: { x: 4900, y: 10400 } },
    ],
  },
  {
    matchId: 'EUW1_71002',
    playedAt: '2026-11-26T18:10:00Z',
    durationSeconds: 1875, // 31:15
    patch: '16.1',
    queueId: 420,
    win: false,
    mapSide: 'red',
    playerParticipantId: 7,
    championId: 32,
    championName: 'Amumu',
    enemyJunglerChampionId: 876,
    enemyJunglerName: 'Lillia',
    kills: 3,
    deaths: 7,
    assists: 8,
    cs: 162, // 5.18 CS/min
    visionScore: 21, // 0.67/min
    controlWardsBought: 1,
    teamKills: 19,
    teamObjectives: 2,
    enemyObjectives: 6,
    items: [6653, 3068, 3047, 3001],
    frames: [
      { minute: 1, position: { x: 7100, y: 10800 }, enemyJunglerPosition: { x: 7800, y: 4200 }, totalGold: 500, xp: 0, cs: 0, enemyJunglerGold: 500, enemyJunglerXp: 0, enemyJunglerCs: 0 },
      { minute: 4, position: { x: 11100, y: 5800 }, enemyJunglerPosition: { x: 10100, y: 4600 }, totalGold: 1340, xp: 1380, cs: 24, enemyJunglerGold: 1580, enemyJunglerXp: 1580, enemyJunglerCs: 28 },
      { minute: 7, position: { x: 9600, y: 4700 }, enemyJunglerPosition: { x: 9850, y: 4400 }, totalGold: 2210, xp: 2400, cs: 38, enemyJunglerGold: 2790, enemyJunglerXp: 2920, enemyJunglerCs: 50 },
      { minute: 10, position: { x: 7400, y: 7400 }, enemyJunglerPosition: { x: 7100, y: 7600 }, totalGold: 3250, xp: 3750, cs: 54, enemyJunglerGold: 3980, enemyJunglerXp: 4480, enemyJunglerCs: 72 },
      { minute: 15, position: { x: 4800, y: 10100 }, enemyJunglerPosition: { x: 4900, y: 10400 }, totalGold: 4880, xp: 5900, cs: 78, enemyJunglerGold: 5620, enemyJunglerXp: 6850, enemyJunglerCs: 105 },
      { minute: 20, position: { x: 9800, y: 4600 }, enemyJunglerPosition: { x: 9600, y: 5100 }, totalGold: 6950, xp: 8300, cs: 108, enemyJunglerGold: 8100, enemyJunglerXp: 9700, enemyJunglerCs: 142 },
      { minute: 25, position: { x: 5200, y: 10100 }, enemyJunglerPosition: { x: 4950, y: 10350 }, totalGold: 8900, xp: 10800, cs: 134, enemyJunglerGold: 10600, enemyJunglerXp: 12600, enemyJunglerCs: 176 },
      { minute: 30, position: { x: 12100, y: 11900 }, enemyJunglerPosition: { x: 11400, y: 11200 }, totalGold: 10900, xp: 13100, cs: 158, enemyJunglerGold: 13400, enemyJunglerXp: 15300, enemyJunglerCs: 212 },
    ],
    events: [
      { type: 'CHAMPION_KILL', timestampSec: 255, killerId: 2, victimId: 7, position: { x: 10300, y: 4800 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 420, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
      { type: 'CHAMPION_KILL', timestampSec: 860, killerId: 2, victimId: 7, position: { x: 5100, y: 9800 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 895, killerId: 2, killerTeamId: 100, monsterType: 'RIFTHERALD', position: { x: 4900, y: 10400 } },
      { type: 'WARD_PLACED', timestampSec: 1010, creatorId: 7, wardType: 'CONTROL_WARD', position: { x: 9300, y: 5100 } },
      { type: 'CHAMPION_KILL', timestampSec: 1140, killerId: 7, victimId: 3, position: { x: 7600, y: 7200 } },
      { type: 'CHAMPION_KILL', timestampSec: 1485, killerId: 2, victimId: 7, position: { x: 5400, y: 9900 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 1525, killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', position: { x: 4900, y: 10400 } },
    ],
  },
  {
    matchId: 'EUW1_71003',
    playedAt: '2026-11-26T16:55:00Z',
    durationSeconds: 1570, // 26:10
    patch: '16.1',
    queueId: 420,
    win: true,
    mapSide: 'blue',
    playerParticipantId: 2,
    championId: 59,
    championName: 'Jarvan IV',
    enemyJunglerChampionId: 121,
    enemyJunglerName: "Kha'Zix",
    kills: 5,
    deaths: 3,
    assists: 11,
    cs: 159, // 6.08 CS/min
    visionScore: 26, // 0.99/min
    controlWardsBought: 4,
    teamKills: 23,
    teamObjectives: 5,
    enemyObjectives: 3,
    items: [6692, 6610, 3071, 3047],
    frames: [
      { minute: 1, position: { x: 7800, y: 4000 }, totalGold: 500, xp: 0, cs: 0, enemyJunglerGold: 500, enemyJunglerXp: 0, enemyJunglerCs: 0 },
      { minute: 3, position: { x: 11900, y: 2300 }, totalGold: 1150, xp: 980, cs: 16, enemyJunglerGold: 1020, enemyJunglerXp: 950, enemyJunglerCs: 20 },
      { minute: 4, position: { x: 10400, y: 4600 }, totalGold: 1680, xp: 1480, cs: 24, enemyJunglerGold: 1380, enemyJunglerXp: 1400, enemyJunglerCs: 26 },
      { minute: 10, position: { x: 9600, y: 4800 }, totalGold: 4100, xp: 4320, cs: 62, enemyJunglerGold: 3650, enemyJunglerXp: 4080, enemyJunglerCs: 68 },
      { minute: 15, position: { x: 7500, y: 7400 }, totalGold: 6080, xp: 6900, cs: 92, enemyJunglerGold: 5520, enemyJunglerXp: 6500, enemyJunglerCs: 98 },
      { minute: 20, position: { x: 9900, y: 4600 }, totalGold: 8100, xp: 9300, cs: 124, enemyJunglerGold: 7400, enemyJunglerXp: 8700, enemyJunglerCs: 130 },
      { minute: 26, position: { x: 11500, y: 11200 }, totalGold: 11100, xp: 12400, cs: 159, enemyJunglerGold: 9500, enemyJunglerXp: 11200, enemyJunglerCs: 164 },
    ],
    events: [
      { type: 'CHAMPION_KILL', timestampSec: 175, killerId: 2, victimId: 9, position: { x: 12100, y: 2400 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 360, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
      { type: 'WARD_PLACED', timestampSec: 520, creatorId: 2, wardType: 'CONTROL_WARD', position: { x: 10050, y: 4650 } },
      { type: 'CHAMPION_KILL', timestampSec: 890, killerId: 7, victimId: 2, position: { x: 5200, y: 9800 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 925, killerId: 7, killerTeamId: 200, monsterType: 'RIFTHERALD', position: { x: 4900, y: 10400 } },
      { type: 'ELITE_MONSTER_KILL', timestampSec: 1380, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
    ],
  },
];

export const DEMO_ROLLING_SUMMARIES: MatchSummaryRecord[] = [
  ...DEMO_POST_GAME_MATCHES.map((m) =>
    toMatchSummaryRecord(m, analyzePostGameMatch(m, 'PLATINUM IV'))
  ),
  { matchId: 'EUW1_70998', playedAt: '2026-11-25T21:10:00Z', championId: 234, championName: 'Viego', win: true, durationSeconds: 1800, kills: 7, deaths: 4, assists: 6, csPerMin: 6.4, visionPerMin: 0.88, controlWards: 3, goldDiffAt15: 340, objectiveSharePct: 62, killParticipationPct: 58, preObjectiveDeaths: 1 },
  { matchId: 'EUW1_70995', playedAt: '2026-11-25T19:45:00Z', championId: 59, championName: 'Jarvan IV', win: false, durationSeconds: 1920, kills: 2, deaths: 6, assists: 9, csPerMin: 5.7, visionPerMin: 0.78, controlWards: 2, goldDiffAt15: -210, objectiveSharePct: 38, killParticipationPct: 55, preObjectiveDeaths: 2 },
  { matchId: 'EUW1_70990', playedAt: '2026-11-24T22:00:00Z', championId: 32, championName: 'Amumu', win: true, durationSeconds: 1650, kills: 4, deaths: 3, assists: 13, csPerMin: 6.1, visionPerMin: 0.94, controlWards: 4, goldDiffAt15: 180, objectiveSharePct: 67, killParticipationPct: 68, preObjectiveDeaths: 0 },
  { matchId: 'EUW1_70987', playedAt: '2026-11-24T20:20:00Z', championId: 234, championName: 'Viego', win: true, durationSeconds: 1740, kills: 9, deaths: 3, assists: 5, csPerMin: 6.7, visionPerMin: 0.86, controlWards: 3, goldDiffAt15: 510, objectiveSharePct: 57, killParticipationPct: 61, preObjectiveDeaths: 1 },
  { matchId: 'EUW1_70981', playedAt: '2026-11-23T21:30:00Z', championId: 56, championName: 'Nocturne', win: false, durationSeconds: 2040, kills: 4, deaths: 7, assists: 5, csPerMin: 5.9, visionPerMin: 0.72, controlWards: 2, goldDiffAt15: -180, objectiveSharePct: 40, killParticipationPct: 50, preObjectiveDeaths: 2 },
];

export const DEMO_HIGH_ELO_SNAPSHOT: HighEloMetaSnapshot = {
  patch: '16.1',
  region: 'EUW1',
  sampleMatches: 18,
  updatedAt: '2026-11-26T20:00:00Z',
  champions: [
    { championId: 234, games: 7, wins: 4, winRate: 57.1, topItemIds: [6672, 6610, 3053] },
    { championId: 59, games: 6, wins: 4, winRate: 66.7, topItemIds: [6692, 6610, 3071] },
    { championId: 32, games: 4, wins: 3, winRate: 75.0, topItemIds: [6653, 3068, 8020] },
    { championId: 64, games: 5, wins: 2, winRate: 40.0, topItemIds: [6692, 6610, 3071] },
    { championId: 876, games: 4, wins: 2, winRate: 50.0, topItemIds: [6653, 3157, 3089] },
  ],
};

export const DEMO_LP_HISTORY: LpHistoryPoint[] = [
  { timestamp: '2026-11-22T18:00:00Z', tier: 'GOLD', rank: 'III', leaguePoints: 42, absoluteLp: 1442, win: true },
  { timestamp: '2026-11-22T19:15:00Z', tier: 'GOLD', rank: 'III', leaguePoints: 65, absoluteLp: 1465, win: true },
  { timestamp: '2026-11-23T20:00:00Z', tier: 'GOLD', rank: 'III', leaguePoints: 47, absoluteLp: 1447, win: false },
  { timestamp: '2026-11-23T21:30:00Z', tier: 'GOLD', rank: 'III', leaguePoints: 72, absoluteLp: 1472, win: true },
  { timestamp: '2026-11-24T20:20:00Z', tier: 'GOLD', rank: 'III', leaguePoints: 96, absoluteLp: 1496, win: true },
  { timestamp: '2026-11-24T22:00:00Z', tier: 'GOLD', rank: 'II', leaguePoints: 20, absoluteLp: 1520, win: true },
  { timestamp: '2026-11-25T19:45:00Z', tier: 'GOLD', rank: 'II', leaguePoints: 2, absoluteLp: 1502, win: false },
  { timestamp: '2026-11-25T21:10:00Z', tier: 'GOLD', rank: 'II', leaguePoints: 28, absoluteLp: 1528, win: true },
  { timestamp: '2026-11-26T18:10:00Z', tier: 'GOLD', rank: 'II', leaguePoints: 41, absoluteLp: 1541, win: true },
  { timestamp: '2026-11-26T19:40:00Z', tier: 'GOLD', rank: 'II', leaguePoints: 64, absoluteLp: 1564, win: true },
];
