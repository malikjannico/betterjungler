import type { DemoScenarioId } from '../types/coaching';
import type {
  AppRuntimeState,
  LcuChampSelectSession,
  LiveGameData,
} from '../types/riot';

export const DEMO_CHAMP_SELECT: LcuChampSelectSession = {
  queueId: 420, // Ranked Solo/Duo
  isRankedSoloDuo: true,
  localPlayerCellId: 3,
  mapSide: 'blue',
  allyBans: [106, 56, 238],
  enemyBans: [64, 59, 876],
  myTeam: [
    {
      cellId: 0,
      team: 'ally',
      displayName: 'TopLanerRealName', // Intentionally unmasked to verify sanitizer masks it
      championId: 58, // Renekton
      assignedPosition: 'top',
      spell1Id: 4,
      spell2Id: 12,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 1,
      team: 'ally',
      displayName: 'MidRealName',
      championId: 157, // Yasuo
      assignedPosition: 'middle',
      spell1Id: 4,
      spell2Id: 14,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 2,
      team: 'ally',
      displayName: 'BotRealName',
      championId: 145, // Kai'Sa
      assignedPosition: 'bottom',
      spell1Id: 4,
      spell2Id: 7,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 3,
      team: 'ally',
      displayName: 'You (Jungler)',
      championId: 0, // Local player picking now!
      assignedPosition: 'jungle',
      spell1Id: 11,
      spell2Id: 4,
      isLocalPlayer: true,
      isPartyMember: false,
      completed: false,
    },
    {
      cellId: 4,
      team: 'ally',
      displayName: 'SuppRealName',
      championId: 111, // Nautilus
      assignedPosition: 'utility',
      spell1Id: 4,
      spell2Id: 14,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
  ],
  theirTeam: [
    {
      cellId: 5,
      team: 'enemy',
      displayName: 'EnemyTopReal',
      championId: 266, // Aatrox
      assignedPosition: 'top',
      spell1Id: 4,
      spell2Id: 12,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 6,
      team: 'enemy',
      displayName: 'EnemyJgReal',
      championId: 234, // Viego
      assignedPosition: 'jungle',
      spell1Id: 11,
      spell2Id: 4,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 7,
      team: 'enemy',
      displayName: 'EnemyMidReal',
      championId: 517, // Sylas
      assignedPosition: 'middle',
      spell1Id: 4,
      spell2Id: 12,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 8,
      team: 'enemy',
      displayName: 'EnemyAdcReal',
      championId: 222, // Jinx
      assignedPosition: 'bottom',
      spell1Id: 4,
      spell2Id: 7,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
    {
      cellId: 9,
      team: 'enemy',
      displayName: 'EnemySupReal',
      championId: 16, // Soraka
      assignedPosition: 'utility',
      spell1Id: 4,
      spell2Id: 7,
      isLocalPlayer: false,
      isPartyMember: false,
      completed: true,
    },
  ],
};

export const DEMO_LOADING_CHAMP_SELECT: LcuChampSelectSession = {
  ...DEMO_CHAMP_SELECT,
  myTeam: DEMO_CHAMP_SELECT.myTeam.map((slot) =>
    slot.isLocalPlayer ? { ...slot, championId: 32, completed: true } : slot
  ),
};

const BASE_LIVE_PLAYERS: LiveGameData['allPlayers'] = [
  {
    summonerName: 'You',
    championName: 'Viego',
    team: 'ORDER',
    position: 'JUNGLE',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [
      { itemID: 1036, displayName: 'Long Sword', count: 1, slot: 0, price: 350 },
      { itemID: 3340, displayName: 'Stealth Ward', count: 1, slot: 6, price: 0 },
    ],
    scores: { kills: 1, deaths: 0, assists: 1, creepScore: 28, wardScore: 3 },
  },
  {
    summonerName: 'Ally Top',
    championName: 'Renekton',
    team: 'ORDER',
    position: 'TOP',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 0, assists: 0, creepScore: 32, wardScore: 2 },
  },
  {
    summonerName: 'Ally Mid',
    championName: 'Orianna',
    team: 'ORDER',
    position: 'MIDDLE',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 1, deaths: 0, assists: 0, creepScore: 35, wardScore: 3 },
  },
  {
    summonerName: 'Ally Bot',
    championName: "Kai'Sa",
    team: 'ORDER',
    position: 'BOTTOM',
    level: 3,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 1, assists: 0, creepScore: 26, wardScore: 2 },
  },
  {
    summonerName: 'Ally Sup',
    championName: 'Nautilus',
    team: 'ORDER',
    position: 'UTILITY',
    level: 3,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 0, assists: 1, creepScore: 4, wardScore: 6 },
  },
  {
    summonerName: 'Enemy Top',
    championName: 'Aatrox',
    team: 'CHAOS',
    position: 'TOP',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 1, deaths: 0, assists: 0, creepScore: 30, wardScore: 2 },
  },
  {
    summonerName: 'Enemy Jg',
    championName: 'Nocturne',
    team: 'CHAOS',
    position: 'JUNGLE',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 1, assists: 0, creepScore: 26, wardScore: 2 },
  },
  {
    summonerName: 'Enemy Mid',
    championName: 'Sylas',
    team: 'CHAOS',
    position: 'MIDDLE',
    level: 4,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 1, assists: 0, creepScore: 29, wardScore: 2 },
  },
  {
    summonerName: 'Enemy Bot',
    championName: 'Jinx',
    team: 'CHAOS',
    position: 'BOTTOM',
    level: 3,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 1, deaths: 0, assists: 0, creepScore: 31, wardScore: 2 },
  },
  {
    summonerName: 'Enemy Sup',
    championName: 'Soraka',
    team: 'CHAOS',
    position: 'UTILITY',
    level: 3,
    isDead: false,
    respawnTimer: 0,
    items: [],
    scores: { kills: 0, deaths: 0, assists: 1, creepScore: 5, wardScore: 5 },
  },
];

export const DEMO_IN_GAME_EARLY: LiveGameData = {
  activePlayer: {
    summonerName: 'You',
    level: 4,
    currentGold: 1350,
    championStats: {
      attackDamage: 92,
      abilityPower: 0,
      armor: 44,
      magicResist: 38,
      currentHealth: 780,
      maxHealth: 910,
      moveSpeed: 345,
    },
  },
  allPlayers: BASE_LIVE_PLAYERS,
  events: { Events: [] },
  gameData: {
    gameMode: 'CLASSIC',
    gameTime: 255, // 4:15
    mapName: 'Map11',
    mapNumber: 11,
  },
};

export const DEMO_IN_GAME_MID: LiveGameData = {
  activePlayer: {
    summonerName: 'You',
    level: 11,
    currentGold: 1620,
    championStats: {
      attackDamage: 185,
      abilityPower: 0,
      armor: 82,
      magicResist: 54,
      currentHealth: 1820,
      maxHealth: 2150,
      moveSpeed: 390,
    },
  },
  allPlayers: BASE_LIVE_PLAYERS.map((p) => {
    if (p.summonerName === 'You') {
      return {
        ...p,
        level: 11,
        items: [
          { itemID: 6672, displayName: 'Kraken Slayer', count: 1, slot: 0, price: 3100 },
          { itemID: 3047, displayName: 'Plated Steelcaps', count: 1, slot: 1, price: 1100 },
          { itemID: 3364, displayName: 'Oracle Lens', count: 1, slot: 6, price: 0 },
        ],
        scores: { kills: 5, deaths: 2, assists: 4, creepScore: 138, wardScore: 19 },
      };
    }
    if (p.championName === 'Sylas') {
      return {
        ...p,
        level: 12,
        items: [
          { itemID: 3152, displayName: 'Hextech Rocketbelt', count: 1, slot: 0, price: 2600 },
          { itemID: 4645, displayName: 'Shadowflame', count: 1, slot: 1, price: 3200 },
        ],
        scores: { kills: 6, deaths: 2, assists: 3, creepScore: 152, wardScore: 11 },
      };
    }
    if (p.championName === 'Aatrox') {
      return {
        ...p,
        level: 12,
        items: [
          { itemID: 6692, displayName: 'Eclipse', count: 1, slot: 0, price: 2900 },
          { itemID: 6610, displayName: 'Sundered Sky', count: 1, slot: 1, price: 3100 },
        ],
        scores: { kills: 4, deaths: 2, assists: 2, creepScore: 148, wardScore: 10 },
      };
    }
    if (p.championName === 'Jinx') {
      return {
        ...p,
        level: 11,
        items: [
          { itemID: 3031, displayName: 'Infinity Edge', count: 1, slot: 0, price: 3600 },
          { itemID: 3046, displayName: 'Phantom Dancer', count: 1, slot: 1, price: 2650 },
        ],
        scores: { kills: 5, deaths: 3, assists: 4, creepScore: 162, wardScore: 12 },
      };
    }
    return { ...p, level: 10 };
  }),
  events: {
    Events: [
      { EventID: 1, EventName: 'DragonKill', EventTime: 410, DragonType: 'Infernal' },
      { EventID: 2, EventName: 'DragonKill', EventTime: 912, DragonType: 'Mountain' },
    ],
  },
  gameData: {
    gameMode: 'CLASSIC',
    gameTime: 1164, // 19:24 -> Dragon respawns at 20:12 (48s away!)
    mapName: 'Map11',
    mapNumber: 11,
  },
};

export const DEMO_IN_GAME_FULL_BUILD: LiveGameData = {
  ...DEMO_IN_GAME_MID,
  activePlayer: {
    ...DEMO_IN_GAME_MID.activePlayer,
    level: 18,
    currentGold: 3420,
  },
  allPlayers: DEMO_IN_GAME_MID.allPlayers.map((p) => {
    if (p.summonerName === 'You') {
      return {
        ...p,
        level: 18,
        items: [
          { itemID: 6672, displayName: 'Kraken Slayer', count: 1, slot: 0, price: 3100 },
          { itemID: 6610, displayName: 'Sundered Sky', count: 1, slot: 1, price: 3100 },
          { itemID: 3053, displayName: "Sterak's Gage", count: 1, slot: 2, price: 3200 },
          { itemID: 3156, displayName: 'Maw of Malmortius', count: 1, slot: 3, price: 3100 },
          { itemID: 3026, displayName: 'Guardian Angel', count: 1, slot: 4, price: 3200 },
          { itemID: 3047, displayName: 'Plated Steelcaps', count: 1, slot: 5, price: 1100 },
          { itemID: 3364, displayName: 'Oracle Lens', count: 1, slot: 6, price: 0 },
        ],
        scores: { kills: 11, deaths: 4, assists: 10, creepScore: 248, wardScore: 34 },
      };
    }
    return { ...p, level: 17 };
  }),
  events: {
    Events: [
      { EventID: 1, EventName: 'DragonKill', EventTime: 410, DragonType: 'Infernal' },
      { EventID: 2, EventName: 'DragonKill', EventTime: 912, DragonType: 'Mountain' },
      { EventID: 3, EventName: 'BaronKill', EventTime: 1860 },
    ],
  },
  gameData: {
    gameMode: 'CLASSIC',
    gameTime: 2260, // 37:40
    mapName: 'Map11',
    mapNumber: 11,
  },
};

export function getDemoRuntimeState(scenario: DemoScenarioId): AppRuntimeState {
  switch (scenario) {
    case 'champ_select':
      return {
        phase: 'champ_select',
        gameflowPhase: 'ChampSelect',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: false,
        champSelect: DEMO_CHAMP_SELECT,
        liveGame: null,
        summonerProfile: {
          riotId: 'BetterJg#EUW',
          puuid: 'demo-puuid',
          region: 'EUW1',
          summonerLevel: 214,
          tier: 'GOLD',
          rank: 'II',
          leaguePoints: 64,
          wins: 58,
          losses: 46,
          topMasteryChampionIds: [234, 32, 59],
        },
        patchVersion: '16.1.1',
      };
    case 'loading':
      return {
        phase: 'loading',
        gameflowPhase: 'GameStart',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: false,
        champSelect: DEMO_LOADING_CHAMP_SELECT,
        liveGame: null,
        summonerProfile: null,
        patchVersion: '16.1.1',
      };
    case 'in_game_early':
      return {
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: DEMO_LOADING_CHAMP_SELECT,
        liveGame: DEMO_IN_GAME_EARLY,
        summonerProfile: null,
        patchVersion: '16.1.1',
      };
    case 'in_game_mid':
      return {
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: DEMO_LOADING_CHAMP_SELECT,
        liveGame: DEMO_IN_GAME_MID,
        summonerProfile: null,
        patchVersion: '16.1.1',
      };
    case 'in_game_full_build':
      return {
        phase: 'in_game',
        gameflowPhase: 'InProgress',
        canInstallUpdate: false,
        lcuConnected: true,
        liveClientConnected: true,
        champSelect: DEMO_LOADING_CHAMP_SELECT,
        liveGame: DEMO_IN_GAME_FULL_BUILD,
        summonerProfile: null,
        patchVersion: '16.1.1',
      };
    case 'idle':
    default:
      return {
        phase: 'idle',
        gameflowPhase: 'None',
        canInstallUpdate: true,
        lcuConnected: false,
        liveClientConnected: false,
        champSelect: null,
        liveGame: null,
        summonerProfile: null,
        patchVersion: '16.1.1',
      };
  }
}
