import {
  findAdcChampionById,
  findAdcChampionByName,
} from '../data/adcKnowledgePack';
import { generateAdcGamePlan } from './adc/adcGamePlanEngine';
import { isAdcMatch } from './adc/adcKpis';
import { computeAdcAdaptiveBuild, computeAdcMacroGuidance } from './adc/adcLiveEngine';
import type { AdcPersonalLearningSnapshot } from './adc/adcReviewTypes';
import type { AdcWinConditionPlan } from './adc/types';
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
  isSelfJungleInLiveGame,
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
import { normalizePlayedRole, type CoachedRole } from './roles/types';
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

export type LivePlayedRole = 'jungle' | 'bottom' | 'off_role';
export type RoleResolutionSource = 'manual' | 'lcu' | 'spell_heuristic' | 'settings' | 'default';

export interface WinPlanPayload {
  role?: CoachedRole;
  plan: WinConditionPlan;
  adcPlan?: AdcWinConditionPlan | null;
  mapSide: MapSide;
  championName: string;
}

export interface LiveCoachPayload {
  liveData: LiveGameData;
  playedRole: LivePlayedRole;
  isJungleRole: boolean;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  winPlan: WinConditionPlan | null;
  adcWinPlan?: AdcWinConditionPlan | null;
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
  adcMatches: MatchV5Detail[];
  offRoleExcludedCount: number;
  adcOffRoleExcludedCount: number;
  summaries: MatchSummaryRecord[];
  lpHistory: LpHistoryPoint[];
  highEloMeta: HighEloMetaSnapshot | null;
}

export interface SessionContext {
  source: DataSourceKind;
  simulationLabel: string | null;
  activeRole: CoachedRole;
  roleSource: RoleResolutionSource;
  livePlayedRole: LivePlayedRole;
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
  demoScenario?: DemoScenarioId;
  liveState: AppRuntimeState | null;
  manualRole?: CoachedRole | null;
  settings: Pick<UserSettings, 'hasApiKey' | 'riotApiProxyUrl' | 'riotId' | 'targetDivision'> &
    Partial<Pick<UserSettings, 'primaryRole' | 'secondaryRole' | 'autoDetectRole'>>;
  summonerProfile: SummonerProfileSummary | null;
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
  highEloMeta: HighEloMetaSnapshot | null;
  interpolatedGameTime?: number;
  objectiveTimings?: ObjectiveTimingsConfig;
  personalLearning?: PersonalLearningSnapshot | null;
  adcPersonalLearning?: AdcPersonalLearningSnapshot | null;
}

const ADC_LIVE_SPELL_RE = /heal|barrier|cleanse|boost/i;
const ADC_LCU_SPELL_IDS = new Set([1, 7, 21]);

function hasAdcSpellInLivePlayer(player: NonNullable<ReturnType<typeof resolveSelfPlayer>>): boolean {
  const s1 = `${player.summonerSpells?.summonerSpellOne?.displayName ?? ''} ${player.summonerSpells?.summonerSpellOne?.rawDisplayName ?? ''}`;
  const s2 = `${player.summonerSpells?.summonerSpellTwo?.displayName ?? ''} ${player.summonerSpells?.summonerSpellTwo?.rawDisplayName ?? ''}`;
  return ADC_LIVE_SPELL_RE.test(s1) || ADC_LIVE_SPELL_RE.test(s2);
}

/**
 * Classifies the local player's active in-game role without bleeding Jungle items/cues into ADC
 * or ADC items/cues into Top/Mid/Support.
 */
export function detectLivePlayedRole(
  liveGame: LiveGameData,
  champSelect?: LcuChampSelectSession | null
): LivePlayedRole {
  if (isSelfJungleInLiveGame(liveGame, champSelect)) {
    return 'jungle';
  }
  const self = resolveSelfPlayer(liveGame);
  const localSlot = champSelect?.myTeam.find((s) => s.isLocalPlayer);
  const normalizedPos = normalizePlayedRole(self?.position);
  if (normalizedPos === 'bottom') {
    return 'bottom';
  }
  if (normalizedPos === 'top' || normalizedPos === 'middle' || normalizedPos === 'utility') {
    return 'off_role';
  }
  if (localSlot && localSlot.assignedPosition !== 'unknown') {
    return localSlot.assignedPosition === 'bottom' ? 'bottom' : 'off_role';
  }
  const hasAdcSpell =
    (self ? hasAdcSpellInLivePlayer(self) : false) ||
    (localSlot
      ? ADC_LCU_SPELL_IDS.has(localSlot.spell1Id) || ADC_LCU_SPELL_IDS.has(localSlot.spell2Id)
      : false);
  const isKnownAdcChamp = Boolean(self && findAdcChampionByName(self.championName));
  if (hasAdcSpell && isKnownAdcChamp) {
    return 'bottom';
  }
  return 'off_role';
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
  const demoScenario = input.demoScenario ?? 'idle';
  const isSimulated = demoScenario !== 'idle';
  const source: DataSourceKind = isSimulated ? 'simulated' : 'live';
  const simulationLabel =
    demoScenario === 'idle' ? null : SIMULATION_LABELS[demoScenario];

  const runtimeState: AppRuntimeState = isSimulated
    ? getDemoRuntimeState(demoScenario)
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

  const localCsSlot = cs?.myTeam.find((s) => s.isLocalPlayer);
  const autoDetectRole = input.settings.autoDetectRole !== false;
  const detectedLiveRole: LivePlayedRole | null = liveGame
    ? detectLivePlayedRole(liveGame, cs)
    : null;

  let activeRole: CoachedRole = input.settings.primaryRole ?? 'jungle';
  let roleSource: RoleResolutionSource = input.settings.primaryRole ? 'settings' : 'default';

  if (input.manualRole) {
    activeRole = input.manualRole;
    roleSource = 'manual';
  } else if (autoDetectRole) {
    if (localCsSlot?.assignedPosition === 'jungle' || localCsSlot?.assignedPosition === 'bottom') {
      activeRole = localCsSlot.assignedPosition;
      roleSource = 'lcu';
    } else if (localCsSlot && (localCsSlot.spell1Id === 11 || localCsSlot.spell2Id === 11)) {
      activeRole = 'jungle';
      roleSource = 'spell_heuristic';
    } else if (
      localCsSlot &&
      localCsSlot.championId > 0 &&
      (ADC_LCU_SPELL_IDS.has(localCsSlot.spell1Id) || ADC_LCU_SPELL_IDS.has(localCsSlot.spell2Id)) &&
      Boolean(findAdcChampionById(localCsSlot.championId))
    ) {
      activeRole = 'bottom';
      roleSource = 'spell_heuristic';
    } else if (detectedLiveRole === 'jungle' || detectedLiveRole === 'bottom') {
      activeRole = detectedLiveRole;
      roleSource = normalizePlayedRole(liveSelf?.position) ? 'lcu' : 'spell_heuristic';
    }
  }

  let playerChampionName: string | null = null;
  let playerChampionId: number | null = null;
  if (liveSelf) {
    playerChampionId =
      findChampionIdByName(liveSelf.championName) ??
      findAdcChampionByName(liveSelf.championName)?.championId ??
      null;
    playerChampionName = formatChampionName(liveSelf.championName, playerChampionId ?? undefined);
  }
  if (cs) {
    const slot = cs.myTeam.find((s) => s.isLocalPlayer);
    if (slot && slot.championId > 0) {
      if (!playerChampionId) playerChampionId = slot.championId;
      if (!playerChampionName) {
        const fallbackName =
          findJungleChampionById(slot.championId)?.name ??
          findAdcChampionById(slot.championId)?.name ??
          (activeRole === 'bottom' ? 'ADC' : 'Jungler');
        playerChampionName = formatChampionName(fallbackName, slot.championId);
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
    const adcPlan =
      activeRole === 'bottom' || detectedLiveRole === 'bottom'
        ? generateAdcGamePlan({
            allyRoles: effectiveAllyRoles,
            enemyRoles: effectiveEnemyRoles,
            playerChampionId,
            mapSide: resolvedMapSide,
          })
        : null;
    winPlanGate = {
      status: 'ready',
      source,
      data: {
        role: activeRole,
        plan,
        adcPlan,
        mapSide: resolvedMapSide,
        championName: playerChampionName ?? (activeRole === 'bottom' ? 'ADC' : 'Jungler'),
      },
    };
  } else if (
    inPostDraftPhase &&
    resolvedMapSide &&
    playerChampionName &&
    hasRealRoleData
  ) {
    const resolvedId =
      playerChampionId ?? findAdcChampionByName(playerChampionName)?.championId ?? 0;
    const plan = generateWinConditionPlan({
      allyRoles: effectiveAllyRoles,
      enemyRoles: effectiveEnemyRoles,
      playerChampionId: resolvedId,
      mapSide: resolvedMapSide,
    });
    const adcPlan =
      (activeRole === 'bottom' || detectedLiveRole === 'bottom') && resolvedId > 0
        ? generateAdcGamePlan({
            allyRoles: effectiveAllyRoles,
            enemyRoles: effectiveEnemyRoles,
            playerChampionId: resolvedId,
            mapSide: resolvedMapSide,
          })
        : null;
    winPlanGate = {
      status: 'ready',
      source,
      data: {
        role: activeRole,
        plan,
        adcPlan,
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
  const livePlayedRole: LivePlayedRole = detectedLiveRole ?? activeRole;
  if (runtimeState.phase === 'in_game' && liveGame && resolvedMapSide) {
    const isJungleRole = livePlayedRole === 'jungle';
    const isAdcRole = livePlayedRole === 'bottom';
    const objectives = computeObjectiveWindows(
      liveGame.gameData.gameTime,
      liveGame.events.Events,
      liveGame.allPlayers,
      input.objectiveTimings
    );
    const activeWinPlan =
      isJungleRole && winPlanGate.status === 'ready' ? winPlanGate.data.plan : null;
    const activeAdcWinPlan =
      isAdcRole && winPlanGate.status === 'ready' ? (winPlanGate.data.adcPlan ?? null) : null;
    const champProfile =
      isJungleRole && playerChampionName
        ? findJungleChampionByName(playerChampionName)
        : undefined;
    const adcProfile =
      isAdcRole && playerChampionName
        ? findAdcChampionByName(playerChampionName)
        : undefined;
    const buildPlan = isJungleRole
      ? computeAdaptiveBuild(liveGame, champProfile)
      : isAdcRole
        ? computeAdcAdaptiveBuild(liveGame, adcProfile)
        : null;
    const macroCues = isJungleRole && activeWinPlan
      ? computeMacroGuidance(liveGame, activeWinPlan, objectives, input.personalLearning)
      : isAdcRole
        ? computeAdcMacroGuidance(liveGame, activeAdcWinPlan, objectives, input.adcPersonalLearning)
        : [];
    liveCoachGate = {
      status: 'ready',
      source,
      data: {
        liveData: liveGame,
        playedRole: livePlayedRole,
        isJungleRole,
        objectives,
        buildPlan,
        macroCues,
        winPlan: activeWinPlan,
        adcWinPlan: activeAdcWinPlan,
        mapSide: resolvedMapSide,
      },
    };
  } else if (runtimeState.phase === 'loading') {
    liveCoachGate = { status: 'empty', reason: 'loading_match' };
  } else {
    liveCoachGate = { status: 'empty', reason: 'no_live_match' };
  }

  // 4. Post-Game & Climb Gate (benchmarks strictly isolated per role)
  const jungleMatches = matches.filter(isJungleMatch);
  const adcMatches = matches.filter(isAdcMatch);
  const offRoleExcludedCount = matches.length - jungleMatches.length;
  const adcOffRoleExcludedCount = matches.length - adcMatches.length;
  const summaries = isSimulated
    ? DEMO_ROLLING_SUMMARIES
    : jungleMatches.map((m) =>
        toMatchSummaryRecord(m, analyzePostGameMatch(m, input.settings.targetDivision))
      );

  const activeRoleMatches = activeRole === 'bottom' ? adcMatches : jungleMatches;
  let emptyAccountReason: EmptyReason | null = null;
  if (activeRoleMatches.length === 0) {
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
    matchesReady: activeRoleMatches.length > 0,
    emptyReason: emptyAccountReason,
    source,
    profile,
    matches,
    jungleMatches,
    adcMatches,
    offRoleExcludedCount,
    adcOffRoleExcludedCount,
    summaries,
    lpHistory,
    highEloMeta,
  };

  return {
    source,
    simulationLabel,
    activeRole,
    roleSource,
    livePlayedRole,
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
