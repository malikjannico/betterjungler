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
  riotId?: string;
  riotIdGameName?: string;
  riotIdTagLine?: string;
  championName: string;
  team: 'ORDER' | 'CHAOS';
  position: string;
  level: number;
  isDead: boolean;
  respawnTimer: number;
  items: LiveItem[];
  scores: LiveScores;
  rawChampionName?: string;
  summonerSpells?: {
    summonerSpellOne?: { displayName?: string; rawDisplayName?: string };
    summonerSpellTwo?: { displayName?: string; rawDisplayName?: string };
  };
}

export interface LiveActivePlayer {
  summonerName: string;
  riotId?: string;
  riotIdGameName?: string;
  riotIdTagLine?: string;
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
  profileIconId?: number;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  topMasteryChampionIds: number[];
}

export interface AppRuntimeState {
  phase: GamePhase;
  gameflowPhase?: string;
  canInstallUpdate?: boolean;
  lcuConnected: boolean;
  liveClientConnected: boolean;
  champSelect: LcuChampSelectSession | null;
  liveGame: LiveGameData | null;
  summonerProfile: SummonerProfileSummary | null;
  patchVersion: string;
  recordingStatus?: 'idle' | 'recording' | 'stopping' | 'unavailable' | 'error' | string;
  recordingElapsedSec?: number;
}

export interface MatchV5TimelinePosition {
  x: number;
  y: number;
}

export type MatchV5EventType =
  | 'CHAMPION_KILL'
  | 'WARD_PLACED'
  | 'WARD_KILL'
  | 'ELITE_MONSTER_KILL'
  | 'ITEM_PURCHASED'
  | 'TURRET_PLATE_DESTROYED'
  | 'LEVEL_UP';

export interface MatchV5TimelineEvent {
  type: MatchV5EventType;
  /** Seconds since match start */
  timestampSec: number;
  position?: MatchV5TimelinePosition;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  creatorId?: number;
  wardType?: string;
  monsterType?: string;
  killerTeamId?: number;
  itemId?: number;
  level?: number;
}

export interface MatchV5FramePoint {
  minute: number;
  position: MatchV5TimelinePosition;
  enemyJunglerPosition?: MatchV5TimelinePosition | null;
  laneOpponentPosition?: MatchV5TimelinePosition | null;
  totalGold: number;
  xp: number;
  cs: number;
  enemyJunglerGold: number;
  enemyJunglerXp: number;
  enemyJunglerCs: number;
  laneOpponentGold?: number;
  laneOpponentXp?: number;
  laneOpponentCs?: number;
  /**
   * Positions of the player's 4 allies at this frame (player excluded). Optional: only needed by
   * the ADC `adc_isolated_death` detector, which stays silent when the field is absent.
   */
  allyPositions?: MatchV5TimelinePosition[] | null;
}

export interface MatchV5Detail {
  matchId: string;
  playedAt: string;
  durationSeconds: number;
  patch: string;
  queueId: number;
  role?: string;
  win: boolean;
  mapSide: MapSide;
  playerParticipantId: number;
  championId: number;
  championName: string;
  enemyJunglerChampionId: number;
  enemyJunglerName: string;
  laneOpponentChampionId?: number;
  laneOpponentName?: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  visionScore: number;
  controlWardsBought: number;
  damageDealtToChampions?: number;
  teamTotalDamage?: number;
  turretPlatesTaken?: number;
  level2TimeSec?: number | null;
  teamKills: number;
  teamObjectives: number;
  enemyObjectives: number;
  items: number[];
  frames: MatchV5FramePoint[];
  events: MatchV5TimelineEvent[];
}

export interface MatchSummaryRecord {
  matchId: string;
  playedAt: string;
  championId: number;
  championName: string;
  role?: string;
  win: boolean;
  durationSeconds: number;
  kills: number;
  deaths: number;
  assists: number;
  csPerMin: number;
  visionPerMin: number;
  controlWards: number;
  goldDiffAt15: number;
  objectiveSharePct: number;
  killParticipationPct: number;
  preObjectiveDeaths: number;
}
