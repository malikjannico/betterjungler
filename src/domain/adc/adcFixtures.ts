import type { MatchV5Detail } from '../../types/riot';

/**
 * Clean Jinx carry win (blue side, participant 4) vs Ezreal.
 * Expected @ PLATINUM: CS@10 84, 8.6 CS/min, +750g GD@15 vs lane (enemy jungler would be +100),
 * 33.1% damage share, 0 deaths pre-14, 3 plates, 69% KP, no detectors.
 */
export const ADC_FIXTURE_JINX_CARRY_WIN: MatchV5Detail = {
  matchId: 'EUW1_72001',
  playedAt: '2026-11-27T19:30:00Z',
  durationSeconds: 1800, // 30:00
  patch: '16.23',
  queueId: 420,
  role: 'BOTTOM',
  win: true,
  mapSide: 'blue',
  playerParticipantId: 4,
  championId: 222,
  championName: 'Jinx',
  enemyJunglerChampionId: 64,
  enemyJunglerName: 'Lee Sin',
  laneOpponentChampionId: 81,
  laneOpponentName: 'Ezreal',
  kills: 11,
  deaths: 1,
  assists: 9,
  cs: 258, // 8.6 CS/min
  visionScore: 22,
  controlWardsBought: 2,
  damageDealtToChampions: 32400,
  teamTotalDamage: 98000, // 33.06% -> 33.1%
  turretPlatesTaken: 3,
  level2TimeSec: 112,
  teamKills: 29, // (11 + 9) / 29 = 69%
  teamObjectives: 6,
  enemyObjectives: 1,
  items: [3031, 3046, 3094, 3006, 3036],
  frames: [
    { minute: 1, position: { x: 11400, y: 1300 }, laneOpponentPosition: { x: 13200, y: 3000 }, totalGold: 500, xp: 0, cs: 0, enemyJunglerGold: 500, enemyJunglerXp: 0, enemyJunglerCs: 0, laneOpponentGold: 500, laneOpponentXp: 0, laneOpponentCs: 0 },
    { minute: 2, position: { x: 12100, y: 1500 }, laneOpponentPosition: { x: 13300, y: 2800 }, totalGold: 720, xp: 430, cs: 8, enemyJunglerGold: 760, enemyJunglerXp: 520, enemyJunglerCs: 12, laneOpponentGold: 690, laneOpponentXp: 400, laneOpponentCs: 7 },
    { minute: 4, position: { x: 12600, y: 1900 }, laneOpponentPosition: { x: 13400, y: 2900 }, totalGold: 1380, xp: 1350, cs: 26, enemyJunglerGold: 1420, enemyJunglerXp: 1500, enemyJunglerCs: 26, laneOpponentGold: 1240, laneOpponentXp: 1250, laneOpponentCs: 23 },
    { minute: 6, position: { x: 12900, y: 2300 }, laneOpponentPosition: { x: 13500, y: 3600 }, totalGold: 2150, xp: 2350, cs: 42, enemyJunglerGold: 2100, enemyJunglerXp: 2300, enemyJunglerCs: 38, laneOpponentGold: 1900, laneOpponentXp: 2150, laneOpponentCs: 37 },
    { minute: 8, position: { x: 13000, y: 2600 }, laneOpponentPosition: { x: 13600, y: 4100 }, totalGold: 3050, xp: 3400, cs: 64, enemyJunglerGold: 2950, enemyJunglerXp: 3200, enemyJunglerCs: 50, laneOpponentGold: 2700, laneOpponentXp: 3100, laneOpponentCs: 55 },
    { minute: 10, position: { x: 13100, y: 3000 }, laneOpponentPosition: { x: 13700, y: 4500 }, totalGold: 4100, xp: 4550, cs: 84, enemyJunglerGold: 4000, enemyJunglerXp: 4300, enemyJunglerCs: 64, laneOpponentGold: 3600, laneOpponentXp: 4100, laneOpponentCs: 70 },
    { minute: 12, position: { x: 13200, y: 3600 }, laneOpponentPosition: { x: 13800, y: 6000 }, totalGold: 5050, xp: 5700, cs: 102, enemyJunglerGold: 5000, enemyJunglerXp: 5400, enemyJunglerCs: 78, laneOpponentGold: 4450, laneOpponentXp: 5150, laneOpponentCs: 86 },
    { minute: 14, position: { x: 13300, y: 4300 }, laneOpponentPosition: { x: 13900, y: 7200 }, totalGold: 6250, xp: 6900, cs: 120, enemyJunglerGold: 6050, enemyJunglerXp: 6500, enemyJunglerCs: 90, laneOpponentGold: 5500, laneOpponentXp: 6200, laneOpponentCs: 100 },
    { minute: 15, position: { x: 10100, y: 4600 }, laneOpponentPosition: { x: 9800, y: 5300 }, totalGold: 6900, xp: 7500, cs: 128, enemyJunglerGold: 6800, enemyJunglerXp: 7100, enemyJunglerCs: 96, laneOpponentGold: 6150, laneOpponentXp: 6800, laneOpponentCs: 106 },
    { minute: 18, position: { x: 7600, y: 7200 }, laneOpponentPosition: { x: 8600, y: 8400 }, totalGold: 8600, xp: 9400, cs: 156, enemyJunglerGold: 8200, enemyJunglerXp: 8800, enemyJunglerCs: 116, laneOpponentGold: 7500, laneOpponentXp: 8500, laneOpponentCs: 130 },
    { minute: 22, position: { x: 9900, y: 4500 }, laneOpponentPosition: { x: 10400, y: 5200 }, totalGold: 10900, xp: 12000, cs: 190, enemyJunglerGold: 10100, enemyJunglerXp: 11000, enemyJunglerCs: 140, laneOpponentGold: 9300, laneOpponentXp: 10800, laneOpponentCs: 160 },
    {
      minute: 27,
      position: { x: 9700, y: 9100 },
      laneOpponentPosition: { x: 10600, y: 10200 },
      allyPositions: [
        { x: 9400, y: 8800 },
        { x: 10100, y: 9400 },
        { x: 9000, y: 9600 },
        { x: 8700, y: 8300 },
      ],
      totalGold: 14100,
      xp: 15400,
      cs: 236,
      enemyJunglerGold: 12600,
      enemyJunglerXp: 14000,
      enemyJunglerCs: 170,
      laneOpponentGold: 11800,
      laneOpponentXp: 13900,
      laneOpponentCs: 196,
    },
    { minute: 30, position: { x: 12400, y: 12300 }, laneOpponentPosition: { x: 13800, y: 13800 }, totalGold: 15900, xp: 17200, cs: 258, enemyJunglerGold: 13800, enemyJunglerXp: 15600, enemyJunglerCs: 184, laneOpponentGold: 13000, laneOpponentXp: 15300, laneOpponentCs: 214 },
  ],
  events: [
    { type: 'LEVEL_UP', timestampSec: 112, killerId: 4, level: 2 },
    { type: 'WARD_PLACED', timestampSec: 150, creatorId: 4, wardType: 'YELLOW_TRINKET', position: { x: 10600, y: 3000 } },
    { type: 'CHAMPION_KILL', timestampSec: 395, killerId: 4, victimId: 9, assistingParticipantIds: [5], position: { x: 13000, y: 2800 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 430, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
    { type: 'TURRET_PLATE_DESTROYED', timestampSec: 610, killerId: 4, position: { x: 13860, y: 4500 } },
    { type: 'TURRET_PLATE_DESTROYED', timestampSec: 700, killerId: 4, position: { x: 13860, y: 4500 } },
    { type: 'CHAMPION_KILL', timestampSec: 755, killerId: 4, victimId: 9, assistingParticipantIds: [5, 2], position: { x: 13500, y: 5200 } },
    { type: 'TURRET_PLATE_DESTROYED', timestampSec: 790, killerId: 4, position: { x: 13860, y: 4500 } },
    { type: 'WARD_PLACED', timestampSec: 980, creatorId: 4, wardType: 'CONTROL_WARD', position: { x: 10200, y: 4900 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 1010, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
    { type: 'CHAMPION_KILL', timestampSec: 1240, killerId: 4, victimId: 7, assistingParticipantIds: [1, 2, 5], position: { x: 7500, y: 7300 } },
    // Death in enemy half but surrounded by allies (see minute-27 frame) -> NOT isolated.
    { type: 'CHAMPION_KILL', timestampSec: 1610, killerId: 8, victimId: 4, position: { x: 9800, y: 9000 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 1680, killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', position: { x: 4900, y: 10400 } },
  ],
};

/**
 * Caitlyn loss (red side, participant 9) vs Draven with a punished laning phase.
 * Expected @ PLATINUM: CS@10 55 (< 70 floor), 5.9 CS/min, -950g GD@15 vs lane (enemy jungler
 * would be -200), 19.5% damage share, 3 deaths pre-14, 0 plates, 56% KP, and all 5 detectors:
 * cs deficit, lane deaths (2nd @ 9:20), low damage share, pre-objective death (9:20, 50s before
 * enemy Dragon @ 10:10) and an isolated death past river @ 24:10.
 */
export const ADC_FIXTURE_CAITLYN_PRE14_LOSS: MatchV5Detail = {
  matchId: 'EUW1_72002',
  playedAt: '2026-11-27T18:40:00Z',
  durationSeconds: 1740, // 29:00
  patch: '16.23',
  queueId: 420,
  role: 'BOTTOM',
  win: false,
  mapSide: 'red',
  playerParticipantId: 9,
  championId: 51,
  championName: 'Caitlyn',
  enemyJunglerChampionId: 254,
  enemyJunglerName: 'Vi',
  laneOpponentChampionId: 119,
  laneOpponentName: 'Draven',
  kills: 3,
  deaths: 5,
  assists: 6,
  cs: 170, // 5.86 -> 5.9 CS/min
  visionScore: 14,
  controlWardsBought: 1,
  damageDealtToChampions: 14800,
  teamTotalDamage: 76000, // 19.47% -> 19.5%
  turretPlatesTaken: 0,
  level2TimeSec: 131,
  teamKills: 16, // (3 + 6) / 16 = 56%
  teamObjectives: 1,
  enemyObjectives: 5,
  items: [3031, 3508, 3006],
  frames: [
    { minute: 1, position: { x: 13400, y: 3200 }, laneOpponentPosition: { x: 11500, y: 1400 }, totalGold: 500, xp: 0, cs: 0, enemyJunglerGold: 500, enemyJunglerXp: 0, enemyJunglerCs: 0, laneOpponentGold: 500, laneOpponentXp: 0, laneOpponentCs: 0 },
    { minute: 3, position: { x: 13300, y: 3000 }, laneOpponentPosition: { x: 12400, y: 1800 }, totalGold: 950, xp: 900, cs: 14, enemyJunglerGold: 1100, enemyJunglerXp: 1050, enemyJunglerCs: 20, laneOpponentGold: 1150, laneOpponentXp: 1000, laneOpponentCs: 18 },
    { minute: 5, position: { x: 13700, y: 4400 }, laneOpponentPosition: { x: 12900, y: 2600 }, totalGold: 1500, xp: 1650, cs: 24, enemyJunglerGold: 1750, enemyJunglerXp: 1900, enemyJunglerCs: 32, laneOpponentGold: 1950, laneOpponentXp: 1900, laneOpponentCs: 34 },
    { minute: 8, position: { x: 13600, y: 4200 }, laneOpponentPosition: { x: 13200, y: 3100 }, totalGold: 2500, xp: 2900, cs: 42, enemyJunglerGold: 2800, enemyJunglerXp: 3200, enemyJunglerCs: 48, laneOpponentGold: 3150, laneOpponentXp: 3300, laneOpponentCs: 58 },
    { minute: 10, position: { x: 13500, y: 4100 }, laneOpponentPosition: { x: 13100, y: 3300 }, totalGold: 3200, xp: 3800, cs: 55, enemyJunglerGold: 3500, enemyJunglerXp: 4100, enemyJunglerCs: 60, laneOpponentGold: 4050, laneOpponentXp: 4300, laneOpponentCs: 74 },
    { minute: 13, position: { x: 13600, y: 5200 }, laneOpponentPosition: { x: 13300, y: 4000 }, totalGold: 4400, xp: 5200, cs: 74, enemyJunglerGold: 4700, enemyJunglerXp: 5600, enemyJunglerCs: 80, laneOpponentGold: 5400, laneOpponentXp: 5900, laneOpponentCs: 98 },
    { minute: 15, position: { x: 10900, y: 5600 }, laneOpponentPosition: { x: 10300, y: 4700 }, totalGold: 5100, xp: 6000, cs: 84, enemyJunglerGold: 5300, enemyJunglerXp: 6400, enemyJunglerCs: 92, laneOpponentGold: 6050, laneOpponentXp: 6700, laneOpponentCs: 112 },
    { minute: 20, position: { x: 8200, y: 8000 }, laneOpponentPosition: { x: 7100, y: 6900 }, totalGold: 7300, xp: 8700, cs: 118, enemyJunglerGold: 7900, enemyJunglerXp: 9200, enemyJunglerCs: 124, laneOpponentGold: 8700, laneOpponentXp: 9500, laneOpponentCs: 150 },
    {
      minute: 24,
      position: { x: 4100, y: 3400 },
      laneOpponentPosition: { x: 4600, y: 4100 },
      // All four allies grouped on the red half while Caitlyn farms the blue-side jungle edge.
      allyPositions: [
        { x: 10800, y: 11200 },
        { x: 11300, y: 10600 },
        { x: 9900, y: 10900 },
        { x: 12200, y: 12100 },
      ],
      totalGold: 8900,
      xp: 10600,
      cs: 144,
      enemyJunglerGold: 9700,
      enemyJunglerXp: 11400,
      enemyJunglerCs: 150,
      laneOpponentGold: 10800,
      laneOpponentXp: 11700,
      laneOpponentCs: 182,
    },
    { minute: 28, position: { x: 12300, y: 12400 }, laneOpponentPosition: { x: 11200, y: 11000 }, totalGold: 10200, xp: 12300, cs: 166, enemyJunglerGold: 11800, enemyJunglerXp: 13400, enemyJunglerCs: 176, laneOpponentGold: 13100, laneOpponentXp: 13900, laneOpponentCs: 212 },
  ],
  events: [
    { type: 'LEVEL_UP', timestampSec: 131, killerId: 9, level: 2 },
    // Lane death #1 (3:00 is not within 45s of the 5:00 Dragon spawn).
    { type: 'CHAMPION_KILL', timestampSec: 250, killerId: 4, victimId: 9, assistingParticipantIds: [5, 2], position: { x: 13300, y: 3100 } },
    { type: 'TURRET_PLATE_DESTROYED', timestampSec: 400, killerId: 4, position: { x: 13050, y: 10400 } },
    { type: 'WARD_PLACED', timestampSec: 470, creatorId: 9, wardType: 'YELLOW_TRINKET', position: { x: 12000, y: 5600 } },
    // Lane death #2 — also 50s before the enemy Dragon take -> pre-objective death.
    { type: 'CHAMPION_KILL', timestampSec: 560, killerId: 2, victimId: 9, assistingParticipantIds: [4], position: { x: 11200, y: 5200 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 610, killerId: 2, killerTeamId: 100, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
    { type: 'CHAMPION_KILL', timestampSec: 690, killerId: 9, victimId: 4, assistingParticipantIds: [10], position: { x: 13400, y: 3600 } },
    // Lane death #3.
    { type: 'CHAMPION_KILL', timestampSec: 790, killerId: 4, victimId: 9, assistingParticipantIds: [5], position: { x: 13500, y: 4600 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 1180, killerId: 7, killerTeamId: 200, monsterType: 'DRAGON', position: { x: 9850, y: 4400 } },
    { type: 'CHAMPION_KILL', timestampSec: 1210, killerId: 9, victimId: 3, assistingParticipantIds: [7, 10], position: { x: 9600, y: 4800 } },
    // Isolated death past river: blue-side jungle (x + y = 7600) with every ally 8000+ units away.
    { type: 'CHAMPION_KILL', timestampSec: 1450, killerId: 2, victimId: 9, assistingParticipantIds: [4], position: { x: 4100, y: 3500 } },
    { type: 'ELITE_MONSTER_KILL', timestampSec: 1560, killerId: 2, killerTeamId: 100, monsterType: 'BARON_NASHOR', position: { x: 4900, y: 10400 } },
    { type: 'CHAMPION_KILL', timestampSec: 1660, killerId: 4, victimId: 9, assistingParticipantIds: [1, 2, 3], position: { x: 11800, y: 11900 } },
  ],
};

export const ADC_DEMO_MATCHES: MatchV5Detail[] = [
  ADC_FIXTURE_JINX_CARRY_WIN,
  ADC_FIXTURE_CAITLYN_PRE14_LOSS,
];
