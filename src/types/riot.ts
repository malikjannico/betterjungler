export type GamePhase = 'idle' | 'champ_select' | 'loading' | 'in_game' | 'post_game';

export type MapSide = 'blue' | 'red';

export type LaneRole = 'top' | 'jungle' | 'middle' | 'bottom' | 'utility';

export interface ChampSelectPlayerSlot {
  cellId: number;
  team: 'ally' | 'enemy';
  /** Enforced Solo/Duo anonymized label for non-local/non-party players */
  displayName: string;
  championId: number;
  assignedPosition: LaneRole | 'unknown';
  spell1Id: number;
  spell2Id: number;
  isLocalPlayer: boolean;
  isPartyMember: boolean;
  completed: boolean;
}

export interface LcuChampSelectSession {
  queueId: number;
  isRankedSoloDuo: boolean;
  localPlayerCellId: number;
  myTeam: ChampSelectPlayerSlot[];
  theirTeam: ChampSelectPlayerSlot[];
  allyBans: number[];
  enemyBans: number[];
  mapSide: MapSide;
}

export interface LiveItem {
  itemID: number;
  displayName: string;
  count: number;
  slot: number;
  price: number;
}

export interface LiveScores {
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  wardScore: number;
}

export interface LivePlayer {
  summonerName: string;
  championName: string;
  team: 'ORDER' | 'CHAOS';
  position: string;
  level: number;
  isDead: boolean;
  respawnTimer: number;
  items: LiveItem[];
  scores: LiveScores;
  rawChampionName?: string;
}

export interface LiveActivePlayer {
  summonerName: string;
  level: number;
  currentGold: number;
  championStats: {
    attackDamage: number;
    abilityPower: number;
    armor: number;
    magicResist: number;
    currentHealth: number;
    maxHealth: number;
    moveSpeed: number;
  };
}

export interface LiveEvent {
  EventID: number;
  EventName: string;
  EventTime: number;
  KillerName?: string;
  VictimName?: string;
  DragonType?: string;
  Stolen?: string;
}

export interface LiveGameData {
  activePlayer: LiveActivePlayer;
  allPlayers: LivePlayer[];
  events: {
    Events: LiveEvent[];
  };
  gameData: {
    gameMode: string;
    gameTime: number;
    mapName: string;
    mapNumber: number;
  };
}

export interface SummonerProfileSummary {
  riotId: string;
  puuid: string;
  region: string;
  summonerLevel: number;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  topMasteryChampionIds: number[];
}

export interface AppRuntimeState {
  phase: GamePhase;
  lcuConnected: boolean;
  liveClientConnected: boolean;
  champSelect: LcuChampSelectSession | null;
  liveGame: LiveGameData | null;
  summonerProfile: SummonerProfileSummary | null;
  patchVersion: string;
}
