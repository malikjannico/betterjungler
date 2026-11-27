import { formatChampionName } from './championNames';
import {
  findChampionIdByName,
  findJungleChampionById,
  findJungleChampionByName,
} from '../data/jungleKnowledgePack';
import {
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  resolveSelfPlayer,
} from './liveCoachEngine';
import {
  DEMO_HIGH_ELO_SNAPSHOT,
  DEMO_LP_HISTORY,
  DEMO_POST_GAME_MATCHES,
  DEMO_ROLLING_SUMMARIES,
} from './postGameFixtures';
import {
  analyzePostGameMatch,
  isJungleMatch,
  toMatchSummaryRecord,
} from './postGameReviewEngine';
import { getDemoRuntimeState } from './simulationFixtures';
import { generateWinConditionPlan } from './winConditionEngine';
import type {
  AdaptiveBuildPlan,
  DemoScenarioId,
  HighEloMetaSnapshot,
  LpHistoryPoint,
  MacroCue,
  ObjectiveTimingsConfig,
  ObjectiveWindow,
  PersonalLearningSnapshot,
  UserSettings,
  WinConditionPlan,
} from '../types/coaching';
import type {
  AppRuntimeState,
  LaneRole,
  LcuChampSelectSession,
  LiveGameData,
  MapSide,
  MatchSummaryRecord,
  MatchV5Detail,
  SummonerProfileSummary,
} from '../types/riot';

export type DataSourceKind = 'live' | 'simulated';

export type EmptyReason =
  | 'not_in_champ_select'
  | 'draft_in_progress'
  | 'no_completed_draft'
  | 'loading_match'
  | 'no_live_match'
  | 'no_account'
  | 'needs_api_key'
  | 'no_matches_synced'
  | 'only_off_role_matches';

export type Gate<T> =
  | { status: 'ready'; data: T; source: DataSourceKind }
  | {
      status: 'empty';
      reason: EmptyReason;
      progress?: { locked: number; total: number };
    };

export interface WinPlanPayload {
  plan: WinConditionPlan;
  mapSide: MapSide;
  championName: string;
}

export interface LiveCoachPayload {
  liveData: LiveGameData;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  winPlan: WinConditionPlan | null;
  mapSide: MapSide;
}

export interface PostGamePayload {
  matches: MatchV5Detail[];
}

export interface ClimbStatus {
  accountReady: boolean;
  matchesReady: boolean;
  emptyReason: EmptyReason | null;
  source: DataSourceKind;
  profile: SummonerProfileSummary | null;
  matches: MatchV5Detail[];
  jungleMatches: MatchV5Detail[];
  offRoleExcludedCount: number;
  summaries: MatchSummaryRecord[];
  lpHistory: LpHistoryPoint[];
  highEloMeta: HighEloMetaSnapshot | null;
}

export interface SessionContext {
  source: DataSourceKind;
  simulationLabel: string | null;
  runtimeState: AppRuntimeState;
  resolvedMapSide: MapSide | null;
  playerChampionName: string | null;
  champSelect: Gate<LcuChampSelectSession>;
  winPlan: Gate<WinPlanPayload>;
  liveCoach: Gate<LiveCoachPayload>;
  postGame: Gate<PostGamePayload>;
  climb: ClimbStatus;
}

export interface DeriveSessionContextInput {
  demoScenario: DemoScenarioId;
  liveState: AppRuntimeState | null;
  settings: Pick<UserSettings, 'hasApiKey' | 'riotApiProxyUrl' | 'riotId' | 'targetDivision'>;
  summonerProfile: SummonerProfileSummary | null;
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
  highEloMeta: HighEloMetaSnapshot | null;
  interpolatedGameTime?: number;
  objectiveTimings?: ObjectiveTimingsConfig;
  personalLearning?: PersonalLearningSnapshot | null;
}

const SIMULATION_LABELS: Record<Exclude<DemoScenarioId, 'idle'>, string> = {
  champ_select: 'Champ Select',
  loading: 'Loading & Map',
  in_game_early: 'Early Game 4:15',
  in_game_mid: 'Mid Game 19:24',
  in_game_full_build: 'Full Build 37:40',
};

function extractRoleMap(
  slots: LcuChampSelectSession['myTeam']
): Partial<Record<LaneRole, number>> {
  const map: Partial<Record<LaneRole, number>> = {};
  for (const s of slots) {
    if (s.assignedPosition !== 'unknown' && s.championId > 0) {
      map[s.assignedPosition] = s.championId;
    }
  }
  return map;
}

function mapLivePositionToRole(position: string): LaneRole | null {
  switch (position.trim().toUpperCase()) {
    case 'TOP':
      return 'top';
    case 'JUNGLE':
      return 'jungle';
    case 'MIDDLE':
    case 'MID':
      return 'middle';
    case 'BOTTOM':
    case 'BOT':
      return 'bottom';
    case 'UTILITY':
    case 'SUPPORT':
      return 'utility';
    default:
      return null;
  }
}

function extractLiveRoleMaps(
  liveGame: LiveGameData,
  allyTeam: 'ORDER' | 'CHAOS'
): {
  allyRoles: Partial<Record<LaneRole, number>>;
  enemyRoles: Partial<Record<LaneRole, number>>;
} {
  const allyRoles: Partial<Record<LaneRole, number>> = {};
  const enemyRoles: Partial<Record<LaneRole, number>> = {};
  for (const player of liveGame.allPlayers) {
    const role = mapLivePositionToRole(player.position);
    if (!role) continue;
    const champId = findChampionIdByName(player.championName);
    if (!champId) continue;
    if (player.team === allyTeam) allyRoles[role] = champId;
    else enemyRoles[role] = champId;
  }
  return { allyRoles, enemyRoles };
}

function countLockedPicks(session: LcuChampSelectSession): { locked: number; total: number } {
  const myLocked = session.myTeam.filter((s) => s.championId > 0 && s.completed).length;
  const enemyLocked = session.theirTeam.filter((s) => s.championId > 0 && s.completed).length;
  return {
    locked: myLocked + enemyLocked,
    total: 10,
  };
}

function isChampSelectCompleted(session: LcuChampSelectSession): boolean {
  if (session.myTeam.length < 5 || session.theirTeam.length < 5) return false;
  return (
    session.myTeam.every((s) => s.championId > 0 && s.completed) &&
    session.theirTeam.every((s) => s.championId > 0 && s.completed)
  );
}

/**
 * Pure session & data gatekeeper.
 * Demo fixtures are injected strictly when `demoScenario !== 'idle'` so live / fresh
 * installations never display fake default champions, plans, or match history.
 */
export function deriveSessionContext(input: DeriveSessionContextInput): SessionContext {
  const isSimulated = input.demoScenario !== 'idle';
  const source: DataSourceKind = isSimulated ? 'simulated' : 'live';
  const simulationLabel =
    input.demoScenario === 'idle' ? null : SIMULATION_LABELS[input.demoScenario];

  const runtimeState: AppRuntimeState = isSimulated
    ? getDemoRuntimeState(input.demoScenario)
    : (input.liveState ?? getDemoRuntimeState('idle'));

  const cs = runtimeState.champSelect;
  const liveGameBase = runtimeState.liveGame;
  const effectiveGameTime =
    input.interpolatedGameTime ?? liveGameBase?.gameData.gameTime ?? 0;
  const liveGame: LiveGameData | null = liveGameBase
    ? {
        ...liveGameBase,
        gameData: {
          ...liveGameBase.gameData,
          gameTime: effectiveGameTime,
        },
      }
    : null;

  const profile = isSimulated
    ? (runtimeState.summonerProfile ?? {
        riotId: 'SampleJg#EUW',
        puuid: 'sample-puuid',
        region: 'EUW1',
        summonerLevel: 214,
        tier: 'GOLD',
        rank: 'II',
        leaguePoints: 64,
        wins: 58,
        losses: 46,
        topMasteryChampionIds: [234, 32, 59],
      })
    : (input.summonerProfile ?? runtimeState.summonerProfile);

  const hasApiCreds =
    Boolean(input.settings.hasApiKey) || Boolean(input.settings.riotApiProxyUrl?.trim());
  const matches = isSimulated ? DEMO_POST_GAME_MATCHES : input.matches;
  const lpHistory = isSimulated ? DEMO_LP_HISTORY : input.lpHistory;
  const highEloMeta = isSimulated ? DEMO_HIGH_ELO_SNAPSHOT : input.highEloMeta;

  const liveSelf = liveGame ? resolveSelfPlayer(liveGame) : null;
  let resolvedMapSide: MapSide | null = null;
  if (cs?.mapSide) {
    resolvedMapSide = cs.mapSide;
  } else if (liveSelf) {
    resolvedMapSide = liveSelf.team === 'CHAOS' ? 'red' : 'blue';
  }

  let playerChampionName: string | null = null;
  let playerChampionId: number | null = null;
  if (liveSelf) {
    playerChampionId = findChampionIdByName(liveSelf.championName) ?? null;
    playerChampionName = formatChampionName(liveSelf.championName, playerChampionId ?? undefined);
  }
  if (cs) {
    const slot = cs.myTeam.find((s) => s.isLocalPlayer);
    if (slot && slot.championId > 0) {
      if (!playerChampionId) playerChampionId = slot.championId;
      if (!playerChampionName) {
        playerChampionName = formatChampionName(
          findJungleChampionById(slot.championId)?.name ?? 'Jungler',
          slot.championId
        );
      }
    }
  }

  // 1. Champ Select Gate
  const champSelectGate: Gate<LcuChampSelectSession> = cs
    ? { status: 'ready', data: cs, source }
    : { status: 'empty', reason: 'not_in_champ_select' };

  // 2. Win Plan Gate — requires completed 10/10 draft OR post-draft match with real role data
  let winPlanGate: Gate<WinPlanPayload>;
  const inPostDraftPhase =
    runtimeState.phase === 'loading' || runtimeState.phase === 'in_game';
  const liveRoles =
    liveGame && liveSelf ? extractLiveRoleMaps(liveGame, liveSelf.team) : null;
  const effectiveAllyRoles =
    cs && Object.keys(extractRoleMap(cs.myTeam)).length > 0
      ? extractRoleMap(cs.myTeam)
      : (liveRoles?.allyRoles ?? {});
  const effectiveEnemyRoles =
    cs && Object.keys(extractRoleMap(cs.theirTeam)).length > 0
      ? extractRoleMap(cs.theirTeam)
      : (liveRoles?.enemyRoles ?? {});
  const hasRealRoleData =
    Object.keys(effectiveAllyRoles).length > 0 ||
    Object.keys(effectiveEnemyRoles).length > 0;

  if (cs && isChampSelectCompleted(cs) && resolvedMapSide && playerChampionId) {
    const plan = generateWinConditionPlan({
      allyRoles: effectiveAllyRoles,
      enemyRoles: effectiveEnemyRoles,
      playerChampionId,
      mapSide: resolvedMapSide,
    });
    winPlanGate = {
      status: 'ready',
      source,
      data: {
        plan,
        mapSide: resolvedMapSide,
        championName: playerChampionName ?? 'Jungler',
      },
    };
  } else if (
    inPostDraftPhase &&
    resolvedMapSide &&
    playerChampionName &&
    hasRealRoleData
  ) {
    const plan = generateWinConditionPlan({
      allyRoles: effectiveAllyRoles,
      enemyRoles: effectiveEnemyRoles,
      playerChampionId: playerChampionId ?? 0,
      mapSide: resolvedMapSide,
    });
    winPlanGate = {
      status: 'ready',
      source,
      data: {
        plan,
        mapSide: resolvedMapSide,
        championName: playerChampionName,
      },
    };
  } else if (cs && runtimeState.phase === 'champ_select') {
    winPlanGate = {
      status: 'empty',
      reason: 'draft_in_progress',
      progress: countLockedPicks(cs),
    };
  } else {
    winPlanGate = {
      status: 'empty',
      reason: 'no_completed_draft',
    };
  }

  // 3. Live Coach Gate
  let liveCoachGate: Gate<LiveCoachPayload>;
  if (runtimeState.phase === 'in_game' && liveGame && resolvedMapSide) {
    const objectives = computeObjectiveWindows(
      liveGame.gameData.gameTime,
      liveGame.events.Events,
      liveGame.allPlayers,
      input.objectiveTimings
    );
    const activeWinPlan = winPlanGate.status === 'ready' ? winPlanGate.data.plan : null;
    const champProfile = playerChampionName
      ? findJungleChampionByName(playerChampionName)
      : undefined;
    const buildPlan = computeAdaptiveBuild(liveGame, champProfile);
    const macroCues = activeWinPlan
      ? computeMacroGuidance(liveGame, activeWinPlan, objectives, input.personalLearning)
      : [];
    liveCoachGate = {
      status: 'ready',
      source,
      data: {
        liveData: liveGame,
        objectives,
        buildPlan,
        macroCues,
        winPlan: activeWinPlan,
        mapSide: resolvedMapSide,
      },
    };
  } else if (runtimeState.phase === 'loading') {
    liveCoachGate = { status: 'empty', reason: 'loading_match' };
  } else {
    liveCoachGate = { status: 'empty', reason: 'no_live_match' };
  }

  // 4. Post-Game & Climb Gate (Climb benchmarks evaluate Jungle games only)
  const jungleMatches = matches.filter(isJungleMatch);
  const offRoleExcludedCount = matches.length - jungleMatches.length;
  const summaries = isSimulated
    ? DEMO_ROLLING_SUMMARIES
    : jungleMatches.map((m) =>
        toMatchSummaryRecord(m, analyzePostGameMatch(m, input.settings.targetDivision))
      );

  let emptyAccountReason: EmptyReason | null = null;
  if (jungleMatches.length === 0) {
    if (matches.length > 0) emptyAccountReason = 'only_off_role_matches';
    else if (!profile && !hasApiCreds) emptyAccountReason = 'no_account';
    else if (!hasApiCreds) emptyAccountReason = 'needs_api_key';
    else emptyAccountReason = 'no_matches_synced';
  }

  const postGameGate: Gate<PostGamePayload> =
    matches.length > 0
      ? { status: 'ready', data: { matches }, source }
      : { status: 'empty', reason: emptyAccountReason ?? 'no_matches_synced' };

  const accountReady = Boolean(profile) || hasApiCreds || isSimulated;
  const climb: ClimbStatus = {
    accountReady,
    matchesReady: jungleMatches.length > 0,
    emptyReason: emptyAccountReason,
    source,
    profile,
    matches,
    jungleMatches,
    offRoleExcludedCount,
    summaries,
    lpHistory,
    highEloMeta,
  };

  return {
    source,
    simulationLabel,
    runtimeState,
    resolvedMapSide,
    playerChampionName,
    champSelect: champSelectGate,
    winPlan: winPlanGate,
    liveCoach: liveCoachGate,
    postGame: postGameGate,
    climb,
  };
}
