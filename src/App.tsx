import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Activity,
  History,
  Map as MapIcon,
  Settings,
  Sparkles,
  Swords,
  TrendingUp,
  X,
} from 'lucide-react';
import pkg from '../package.json';
import changelogRaw from '../CHANGELOG.md?raw';
import { BrandMark } from './components/BrandMark';
import { ChampSelectView } from './components/ChampSelectView';
import { ClimbLadderView } from './components/ClimbLadderView';
import { CompactHudBar } from './components/CompactHudBar';
import { LiveCoachView } from './components/LiveCoachView';
import { PostGameReviewView } from './components/PostGameReviewView';
import { SettingsView, type SettingsSectionId } from './components/SettingsView';
import { WinConditionView } from './components/WinConditionView';
import { M3NavRail, M3TopAppBar } from './components/m3';
import type { M3NavRailItem, SummonerProfilePillProps } from './components/m3';
import { computeAdcPersonalLearningSnapshot } from './domain/adc/adcDetectors';
import { isAdcMatch } from './domain/adc/adcKpis';
import { computePersonalChampStats } from './domain/champSelectEngine';
import { parseChangelog } from './domain/changelogParser';
import { setSingleFocusGoal } from './domain/climbLadderEngine';
import { computePersonalLearningSnapshot } from './domain/personalLearningEngine';
import { formatCoachedRoleLabel } from './domain/roles/types';
import type { CoachedRole } from './domain/roles/types';
import { deriveSessionContext } from './domain/sessionContext';
import { useInterpolatedGameTime } from './hooks/useInterpolatedGameTime';
import {
  fetchLatestPatchVersion,
  getChampionIconUrl,
  loadCachedDdragonCatalog,
  syncFullDdragonCatalog,
} from './services/ddragonService';
import {
  checkForAppUpdate,
  checkRiotApiKeyHealth,
  deleteClimbGoal,
  fetchSummonerProfile,
  getAppMeta,
  getAppState,
  getCachedMatches,
  getCachedMetaSnapshot,
  getActivePatchPack,
  getLcuProfile,
  getPersonalLearningSnapshot,
  installAppUpdate,
  installSignedPatchPack,
  isTauriEnvironment,
  loadClimbGoals,
  loadLpHistory,
  loadSettings,
  refreshHighEloMeta,
  setFocusGoal,
  setOverlayMode,
  stageAppUpdate,
  subscribeGameState,
  syncDdragonPatch,
  syncRecentMatches,
  upsertClimbGoal,
} from './services/tauriBridge';
import type {
  ActivePatchPackStatus,
  ActiveTab,
  ApiKeyHealthStatus,
  AppMetaInfo,
  ClimbGoal,
  HighEloMetaSnapshot,
  HudCorner,
  LpHistoryPoint,
  OverlayMode,
  SqlPersonalLearningSummary,
  UpdateCheckResult,
  UserSettings,
} from './types/coaching';
import type {
  AppRuntimeState,
  GamePhase,
  MatchV5Detail,
  SummonerProfileSummary,
} from './types/riot';

function mergeMatchesById(
  existing: MatchV5Detail[],
  incoming: MatchV5Detail[],
  maxItems = 30
): MatchV5Detail[] {
  const seen = new Map<string, MatchV5Detail>();
  for (const m of incoming) {
    seen.set(m.matchId, m);
  }
  for (const m of existing) {
    if (!seen.has(m.matchId)) {
      seen.set(m.matchId, m);
    }
  }
  return [...seen.values()]
    .sort((a, b) => {
      const ta = Date.parse(a.playedAt);
      const tb = Date.parse(b.playedAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    })
    .slice(0, maxItems);
}

function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const key = e.key.toLowerCase();
  if (hotkey === 'Alt+J') return e.altKey && key === 'j';
  if (hotkey === 'Alt+B') return e.altKey && key === 'b';
  if (hotkey === 'Ctrl+Shift+J') return e.ctrlKey && e.shiftKey && key === 'j';
  if (hotkey === 'F8') return e.key === 'F8';
  return e.altKey && key === 'j';
}

function cornerAlignmentClasses(corner: HudCorner): string {
  switch (corner) {
    case 'top-left':
      return 'items-start justify-start';
    case 'bottom-right':
    case 'beside-minimap':
      return 'items-end justify-end';
    case 'bottom-left':
      return 'items-end justify-start';
    case 'top-right':
    default:
      return 'items-start justify-end';
  }
}

type NavItemDef = Omit<M3NavRailItem<ActiveTab>, 'live'>;

const NAV_ITEMS: NavItemDef[] = [
  { id: 'climb_goals', label: 'Climb & Goals', shortLabel: 'Climb', icon: TrendingUp },
  { id: 'champ_select', label: 'Champ Select', shortLabel: 'Draft', icon: Swords },
  { id: 'win_plan', label: 'Win Plan & Map', shortLabel: 'Win Plan', icon: MapIcon },
  { id: 'live_coach', label: 'Live Coach', shortLabel: 'Live', icon: Activity },
  { id: 'post_game', label: 'Post-Game Review', shortLabel: 'Review', icon: History },
];

const NAV_BOTTOM_ITEMS: NavItemDef[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
];

const ALL_NAV_ITEMS: NavItemDef[] = [...NAV_ITEMS, ...NAV_BOTTOM_ITEMS];

/**
 * Loads one role-isolated SQLite personal-learning summary. `jungleMatchCount` carries the
 * role's match count for both scopes, so an empty scope resolves to `null`.
 */
function fetchRoleLearning(
  puuid: string | null,
  role: 'JUNGLE' | 'BOTTOM',
  apply: (summary: SqlPersonalLearningSummary | null) => void,
  isActive: () => boolean = () => true
): void {
  void getPersonalLearningSnapshot(puuid, role)
    .then((snap) => {
      if (isActive()) apply(snap.jungleMatchCount > 0 ? snap : null);
    })
    .catch(() => {});
}

function tabMatchesLivePhase(tab: ActiveTab, phase: GamePhase): boolean {
  if (phase === 'champ_select') return tab === 'champ_select';
  if (phase === 'loading') return tab === 'win_plan';
  if (phase === 'in_game') return tab === 'live_coach';
  if (phase === 'post_game') return tab === 'post_game';
  return false;
}

export function App() {
  const isTauri = isTauriEnvironment();
  const [liveState, setLiveState] = useState<AppRuntimeState | null>(null);
  const [overlayMode, setMode] = useState<OverlayMode>('expanded');
  const [activeTab, setActiveTab] = useState<ActiveTab>('climb_goals');
  const [patchVersion, setPatchVersion] = useState<string>('16.23.1');
  const [catalogCounts, setCatalogCounts] = useState<{ champions: number; items: number }>({
    champions: 0,
    items: 0,
  });
  const [summonerProfile, setSummonerProfile] = useState<SummonerProfileSummary | null>(null);
  const [matches, setMatches] = useState<MatchV5Detail[]>([]);
  const [lpHistory, setLpHistory] = useState<LpHistoryPoint[]>([]);
  const [climbGoals, setClimbGoals] = useState<ClimbGoal[]>([]);
  const [highEloMeta, setHighEloMeta] = useState<HighEloMetaSnapshot | null>(null);
  const [sqlPersonalLearning, setSqlPersonalLearning] = useState<SqlPersonalLearningSummary | null>(
    null
  );
  const [adcSqlPersonalLearning, setAdcSqlPersonalLearning] =
    useState<SqlPersonalLearningSummary | null>(null);
  const [manualRole, setManualRole] = useState<CoachedRole | null>(null);
  const [patchPackStatus, setPatchPackStatus] = useState<ActivePatchPackStatus | null>(null);
  const [settings, setSettings] = useState<UserSettings>({
    riotId: '',
    region: 'EUW1',
    lolInstallPath: 'C:\\Riot Games\\League of Legends',
    overlayHotkey: 'Alt+J',
    hudCorner: 'beside-minimap',
    hudOpacity: 80,
    targetDivision: 'PLATINUM IV',
    hasApiKey: false,
    updateMode: 'manual',
    riotApiProxyUrl: '',
    aiCoach: {
      provider: 'off',
      model: 'gemini-3.8-flash',
      endpoint: 'http://127.0.0.1:11434',
      hasApiKey: false,
    },
  });
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('betterjungler_nav_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [settingsNavState, setSettingsNavState] = useState<{
    section: SettingsSectionId;
    token: number;
  }>({ section: 'account', token: 0 });
  const [apiKeyHealth, setApiKeyHealth] = useState<ApiKeyHealthStatus | null>(null);
  const [appMeta, setAppMeta] = useState<AppMetaInfo>({
    version: pkg.version,
    commitSha: 'local',
    logDir: '',
  });
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [stagingUpdate, setStagingUpdate] = useState(false);
  const [stagedUpdateVersion, setStagedUpdateVersion] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem('betterjungler_dismissed_update');
    } catch {
      return null;
    }
  });
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [hasTestedHud, setHasTestedHud] = useState(false);
  const [lastAutoSyncedMatchId, setLastAutoSyncedMatchId] = useState<string | null>(null);
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);
  const [autoPostGameToken, setAutoPostGameToken] = useState(0);

  const lastPhaseRef = useRef<GamePhase | null>(null);
  const lastAccountPuuidRef = useRef<string | null>(null);
  const hadActiveMatchRef = useRef(false);
  const inEndOfGameCycleRef = useRef(false);
  const endOfGameAtMsRef = useRef<number>(0);
  /** `true` while ADC is the active role or ADC games are synced (gates BOTTOM SQL loads). */
  const shouldLoadAdcLearningRef = useRef(false);

  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => {
      if (!active) return;
      setSettings(s);
      if (isTauri && (s.hasApiKey || Boolean(s.riotApiProxyUrl?.trim()))) {
        void checkRiotApiKeyHealth(s.region)
          .then((h) => {
            if (active) setApiKeyHealth(h);
          })
          .catch(() => {});
      }
    });
    void getAppMeta()
      .then((meta) => {
        if (!active) return;
        setAppMeta(meta);
        try {
          const lastSeenKey = 'betterjungler_last_seen_version';
          const lastSeen = localStorage.getItem(lastSeenKey);
          if (lastSeen && lastSeen !== meta.version) {
            setWhatsNewVersion(meta.version);
          } else if (!lastSeen) {
            localStorage.setItem(lastSeenKey, meta.version);
          }
        } catch {
          // Ignore storage errors in restricted environments
        }
      })
      .catch((err) => {
        if (active) {
          setUpdateError(
            err instanceof Error ? err.message : 'Unable to load app metadata.'
          );
        }
      });
    const resolvePatch = isTauri
      ? syncDdragonPatch().catch(() => fetchLatestPatchVersion())
      : fetchLatestPatchVersion();
    void resolvePatch.then((patch) => {
      if (!active) return;
      setPatchVersion(patch);
      void syncFullDdragonCatalog(patch).then((catalog) => {
        if (!active) return;
        setCatalogCounts({
          champions: Object.keys(catalog.championsById).length,
          items: Object.keys(catalog.itemsById).length,
        });
      });
    });
    void getAppState().then((state) => {
      if (!active || !state) return;
      lastPhaseRef.current = state.phase;
      setLiveState(state);
      if (state.summonerProfile) {
        setSummonerProfile(state.summonerProfile);
      }
    });
    void loadClimbGoals().then((g) => {
      if (active) setClimbGoals(g);
    });
    void getCachedMetaSnapshot().then((snap) => {
      if (active && snap) setHighEloMeta(snap);
    });
    void getCachedMatches().then((cached) => {
      if (active && !lastAccountPuuidRef.current && cached.length > 0) setMatches(cached);
    });
    void getPersonalLearningSnapshot()
      .then((snap) => {
        if (active && !lastAccountPuuidRef.current) {
          setSqlPersonalLearning(snap.jungleMatchCount > 0 ? snap : null);
        }
      })
      .catch(() => {});
    void getActivePatchPack()
      .then((pack) => {
        if (active && pack) {
          setPatchPackStatus(pack);
        }
      })
      .catch(() => {});
    void loadLpHistory().then((hist) => {
      if (active && hist.length > 0) setLpHistory(hist);
    });

    const unsubPromise = subscribeGameState(
      (state) => {
        setLiveState(state);
        if (state.summonerProfile) {
          setSummonerProfile(state.summonerProfile);
        }
        if (state.phase === 'loading' || state.phase === 'in_game') {
          hadActiveMatchRef.current = true;
          inEndOfGameCycleRef.current = false;
        } else if (state.phase === 'idle' && state.gameflowPhase !== 'EndOfGame') {
          hadActiveMatchRef.current = false;
          inEndOfGameCycleRef.current = false;
        }
        const isEndState =
          state.phase === 'post_game' ||
          (hadActiveMatchRef.current && state.gameflowPhase === 'EndOfGame');
        if (isEndState && !inEndOfGameCycleRef.current) {
          inEndOfGameCycleRef.current = true;
          hadActiveMatchRef.current = false;
          endOfGameAtMsRef.current = Date.now();
          setAutoPostGameToken((t) => t + 1);
          setActiveTab('post_game');
        }
        if (state.phase !== lastPhaseRef.current) {
          lastPhaseRef.current = state.phase;
          if (state.phase === 'champ_select') setActiveTab('champ_select');
          else if (state.phase === 'loading') setActiveTab('win_plan');
          else if (state.phase === 'in_game') setActiveTab('live_coach');
          else if (state.phase === 'post_game') setActiveTab('post_game');
        }
      },
      (mode) => {
        setMode(mode);
        if (mode === 'compact') {
          setHasTestedHud(true);
        }
      }
    );

    return () => {
      active = false;
      void unsubPromise.then((fn) => fn());
    };
  }, [isTauri]);

  useEffect(() => {
    const nextPuuid = summonerProfile?.puuid?.trim() || null;
    if (!isTauri || !nextPuuid) return;
    lastAccountPuuidRef.current = nextPuuid;
    let active = true;
    void getCachedMatches(nextPuuid)
      .then((cached) => {
        if (active) setMatches(cached);
      })
      .catch(() => {});
    // BOTTOM-scoped summary is loaded by the ADC lazy-load effect below (keyed on the puuid too).
    fetchRoleLearning(nextPuuid, 'JUNGLE', setSqlPersonalLearning, () => active);
    return () => {
      active = false;
    };
  }, [isTauri, summonerProfile?.puuid]);

  useEffect(() => {
    if (!isTauri || !liveState?.lcuConnected || summonerProfile) return;
    let active = true;
    void getLcuProfile(settings.region)
      .then((profile) => {
        if (!active) return;
        setSummonerProfile(profile);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isTauri, liveState?.lcuConnected, summonerProfile, settings.region]);

  useEffect(() => {
    try {
      localStorage.setItem('betterjungler_nav_collapsed', navCollapsed ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, [navCollapsed]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const targetEl = e.target as HTMLElement | null;
      const isEditable =
        targetEl?.tagName === 'INPUT' ||
        targetEl?.tagName === 'TEXTAREA' ||
        targetEl?.tagName === 'SELECT' ||
        Boolean(targetEl?.isContentEditable);
      if (!isEditable && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setNavCollapsed((prev) => !prev);
        return;
      }
      if (!isTauri && matchesHotkey(e, settings.overlayHotkey)) {
        e.preventDefault();
        const next: OverlayMode = overlayMode === 'expanded' ? 'compact' : 'expanded';
        setMode(next);
        void setOverlayMode(next);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTauri, overlayMode, settings.overlayHotkey]);

  const rawLiveClock = liveState?.liveGame?.gameData.gameTime ?? 0;
  const liveMatchActive =
    liveState?.phase === 'in_game' && Boolean(liveState.liveGame);
  const interpolatedLiveTime = useInterpolatedGameTime(rawLiveClock, liveMatchActive);

  const livePersonalLearning = useMemo(
    () =>
      computePersonalLearningSnapshot(
        matches,
        matches,
        settings.targetDivision,
        sqlPersonalLearning
      ),
    [matches, settings.targetDivision, sqlPersonalLearning]
  );

  const adcRoleBenchmarks = patchPackStatus?.payload.roleBenchmarks?.bottom;

  // Role-isolated ADC learning: only ADC (BOTTOM) games and the BOTTOM-scoped SQL summary.
  const adcPersonalLearning = useMemo(() => {
    const snap = computeAdcPersonalLearningSnapshot(
      matches,
      settings.targetDivision,
      adcSqlPersonalLearning,
      adcRoleBenchmarks
    );
    return snap.adcMatchCount > 0 ? snap : null;
  }, [matches, settings.targetDivision, adcSqlPersonalLearning, adcRoleBenchmarks]);

  const sessionCtx = useMemo(
    () =>
      deriveSessionContext({
        liveState,
        manualRole,
        settings,
        summonerProfile,
        matches,
        lpHistory,
        highEloMeta,
        interpolatedGameTime: liveMatchActive ? interpolatedLiveTime : undefined,
        objectiveTimings: patchPackStatus?.payload.objectiveTimings,
        personalLearning: livePersonalLearning,
        adcPersonalLearning,
      }),
    [
      liveState,
      manualRole,
      settings,
      summonerProfile,
      matches,
      lpHistory,
      highEloMeta,
      liveMatchActive,
      interpolatedLiveTime,
      patchPackStatus,
      livePersonalLearning,
      adcPersonalLearning,
    ]
  );

  const { runtimeState, resolvedMapSide, playerChampionName } = sessionCtx;

  const shouldLoadAdcLearning =
    sessionCtx.activeRole === 'bottom' || sessionCtx.climb.adcMatches.length > 0;
  useEffect(() => {
    shouldLoadAdcLearningRef.current = shouldLoadAdcLearning;
  }, [shouldLoadAdcLearning]);

  // Lazily load the BOTTOM-scoped SQL summary once ADC becomes relevant (Jungle stays cached).
  const accountPuuid = summonerProfile?.puuid?.trim() || null;
  useEffect(() => {
    if (!isTauri || !shouldLoadAdcLearning) return;
    let active = true;
    fetchRoleLearning(accountPuuid, 'BOTTOM', setAdcSqlPersonalLearning, () => active);
    return () => {
      active = false;
    };
  }, [isTauri, shouldLoadAdcLearning, accountPuuid]);

  const focusGoal = useMemo(
    () =>
      climbGoals.find((g) => g.isFocusGoal && g.status === 'active') ??
      climbGoals.find((g) => g.isFocusGoal) ??
      null,
    [climbGoals]
  );

  const personalStats = useMemo(
    () => computePersonalChampStats(sessionCtx.climb.jungleMatches),
    [sessionCtx.climb.jungleMatches]
  );

  // Data Dragon icon for the top-bar context chip (catalog keys are DDragon ids, e.g. "LeeSin").
  const championIconUrl = useMemo(() => {
    if (!playerChampionName || catalogCounts.champions === 0) return null;
    const catalog = loadCachedDdragonCatalog();
    if (!catalog) return null;
    const wanted = playerChampionName.trim().toLowerCase();
    const champ = Object.values(catalog.championsById).find(
      (c) => c.name.toLowerCase() === wanted
    );
    return champ ? getChampionIconUrl(champ.key, patchVersion) : null;
  }, [playerChampionName, catalogCounts.champions, patchVersion]);

  function openSettingsSection(section: SettingsSectionId = 'account') {
    setSettingsNavState((prev) => ({ section, token: prev.token + 1 }));
    setActiveTab('settings');
  }

  const settingsRef = useRef(settings);
  const profileRef = useRef(sessionCtx.climb.profile);
  const matchesRef = useRef(matches);
  useEffect(() => {
    settingsRef.current = settings;
    profileRef.current = sessionCtx.climb.profile;
    matchesRef.current = matches;
  }, [settings, sessionCtx.climb.profile, matches]);

  useEffect(() => {
    if (!isTauri || autoPostGameToken === 0) return;
    const curSettings = settingsRef.current;
    const curProfile = profileRef.current;
    if ((!curSettings.hasApiKey && !curSettings.riotApiProxyUrl?.trim()) || !curProfile?.puuid) {
      return;
    }

    let cancelled = false;
    let activeTimer: number | null = null;
    const prevTopId = matchesRef.current[0]?.matchId;
    const cycleEndedAtMs = endOfGameAtMsRef.current || Date.now();
    const STEP_DELAYS_MS = [8_000, 12_000, 25_000, 45_000, 60_000];
    let syncedWin: boolean | null = null;
    let syncedMatchId: string | null = null;
    let matchUpdated = false;
    let profileRefreshed = false;

    const scheduleNext = (attemptIndex: number) => {
      if (cancelled || attemptIndex >= STEP_DELAYS_MS.length) return;
      activeTimer = window.setTimeout(
        () => void runSyncAttempt(attemptIndex),
        STEP_DELAYS_MS[attemptIndex]!
      );
    };

    const runSyncAttempt = async (attemptIndex: number) => {
      if (cancelled) return;
      const isFinalAttempt = attemptIndex === STEP_DELAYS_MS.length - 1;
      try {
        if (!matchUpdated) {
          const synced = await syncRecentMatches(curProfile.puuid, curSettings.region, 8);
          if (cancelled) return;
          const newest = synced[0];
          const playedAtMs = newest?.playedAt ? Date.parse(newest.playedAt) : Number.NaN;
          const endedApproxMs =
            Number.isFinite(playedAtMs) && newest
              ? playedAtMs + Math.max(newest.durationSeconds, 60) * 1000
              : null;
          const recencyOk =
            endedApproxMs === null || endedApproxMs >= cycleEndedAtMs - 10 * 60 * 1000;
          if (newest && newest.matchId !== prevTopId && recencyOk) {
            matchUpdated = true;
            syncedWin = newest.win;
            syncedMatchId = newest.matchId;
            setMatches((prev) => mergeMatchesById(prev, synced, 30));
            setLastAutoSyncedMatchId(newest.matchId);
            setAutoSyncNotice(null);
            fetchRoleLearning(
              curProfile.puuid,
              'JUNGLE',
              setSqlPersonalLearning,
              () => !cancelled
            );
            if (shouldLoadAdcLearningRef.current || synced.some(isAdcMatch)) {
              fetchRoleLearning(
                curProfile.puuid,
                'BOTTOM',
                setAdcSqlPersonalLearning,
                () => !cancelled
              );
            }
          } else {
            if (isFinalAttempt) {
              setAutoSyncNotice(
                'Riot Match-V5 history has not published this game yet — click Sync Recent Games.'
              );
            } else {
              scheduleNext(attemptIndex + 1);
            }
            return;
          }
        }

        const riotIdToRefresh = curSettings.riotId.trim() || curProfile.riotId;
        if (matchUpdated && !profileRefreshed && riotIdToRefresh) {
          const refreshed = await fetchSummonerProfile(
            riotIdToRefresh,
            curSettings.region,
            syncedWin ?? undefined,
            syncedMatchId ?? undefined
          );
          if (cancelled) return;
          profileRefreshed = true;
          setSummonerProfile(refreshed);
          void loadLpHistory()
            .then((hist) => {
              if (!cancelled && hist.length > 0) setLpHistory(hist);
            })
            .catch(() => {});
        }
      } catch {
        if (isFinalAttempt && !matchUpdated && !cancelled) {
          setAutoSyncNotice(
            'Could not auto-sync post-game history — click Sync Recent Games when ready.'
          );
        } else if (!cancelled && (!matchUpdated || !profileRefreshed)) {
          scheduleNext(attemptIndex + 1);
        }
      }
    };

    scheduleNext(0);

    return () => {
      cancelled = true;
      if (activeTimer !== null) window.clearTimeout(activeTimer);
    };
  }, [autoPostGameToken, isTauri]);

  const canInstallUpdateSafely =
    runtimeState.canInstallUpdate ??
    (runtimeState.phase !== 'champ_select' &&
      runtimeState.phase !== 'loading' &&
      runtimeState.phase !== 'in_game' &&
      !runtimeState.liveClientConnected &&
      (runtimeState.gameflowPhase === 'None' ||
        runtimeState.gameflowPhase === 'Lobby' ||
        runtimeState.gameflowPhase === 'EndOfGame'));

  const safeUpdateRef = useRef(canInstallUpdateSafely);
  useEffect(() => {
    safeUpdateRef.current = canInstallUpdateSafely;
  }, [canInstallUpdateSafely]);

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await checkForAppUpdate();
      setUpdateInfo(res);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Unable to check for updates.');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    if (!canInstallUpdateSafely) return;
    setInstallingUpdate(true);
    setUpdateError(null);
    try {
      await installAppUpdate();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Unable to install update.');
    } finally {
      setInstallingUpdate(false);
    }
  }

  async function handleStageUpdate() {
    setStagingUpdate(true);
    setUpdateError(null);
    try {
      const version = await stageAppUpdate();
      setStagedUpdateVersion(version);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Unable to stage update.');
    } finally {
      setStagingUpdate(false);
    }
  }

  useEffect(() => {
    if (!isTauri) return;
    const runIdleCheck = () => {
      if (!safeUpdateRef.current) return;
      void checkForAppUpdate()
        .then((res) => {
          setUpdateInfo(res);
          if (
            res.available &&
            res.latestVersion &&
            settingsRef.current.updateMode === 'install_on_quit'
          ) {
            void stageAppUpdate()
              .then((ver) => setStagedUpdateVersion(ver))
              .catch(() => {});
          }
        })
        .catch(() => {});
    };
    const bootTimer = window.setTimeout(runIdleCheck, 30_000);
    const periodicTimer = window.setInterval(runIdleCheck, 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(bootTimer);
      window.clearInterval(periodicTimer);
    };
  }, [isTauri]);

  function handleDismissWhatsNew() {
    if (!whatsNewVersion) return;
    try {
      localStorage.setItem('betterjungler_last_seen_version', whatsNewVersion);
    } catch {
      // ignore
    }
    setWhatsNewVersion(null);
  }

  function handleDismissUpdatePill(version: string) {
    setDismissedUpdateVersion(version);
    try {
      localStorage.setItem('betterjungler_dismissed_update', version);
    } catch {
      // ignore
    }
  }

  const whatsNewEntry = useMemo(() => {
    if (!whatsNewVersion) return null;
    const parsed = parseChangelog(changelogRaw);
    return parsed.find((entry) => entry.version === whatsNewVersion) ?? null;
  }, [whatsNewVersion]);

  async function toggleOverlayMode(next: OverlayMode) {
    const prevMode = overlayMode;
    setHasTestedHud(true);
    setMode(next);
    try {
      await setOverlayMode(next);
    } catch {
      setMode(prevMode);
    }
  }

  async function handleSyncMatches() {
    const profilePuuid = sessionCtx.climb.profile?.puuid;
    const riotIdParts = settings.riotId.trim().split('#');
    const hasRiotId =
      riotIdParts.length === 2 &&
      Boolean(riotIdParts[0]?.trim()) &&
      Boolean(riotIdParts[1]?.trim());
    if (!profilePuuid && !hasRiotId && isTauri) {
      throw new Error(
        'Save your Riot ID (Name#Tag) or load your profile in Settings before syncing Match-V5 games.'
      );
    }
    const synced = await syncRecentMatches(profilePuuid ?? '', settings.region, 8);
    if (synced.length > 0) {
      setMatches((prev) => mergeMatchesById(prev, synced, 30));
      setAutoSyncNotice(null);
      fetchRoleLearning(profilePuuid ?? null, 'JUNGLE', setSqlPersonalLearning);
      if (shouldLoadAdcLearningRef.current || synced.some(isAdcMatch)) {
        fetchRoleLearning(profilePuuid ?? null, 'BOTTOM', setAdcSqlPersonalLearning);
      }
    }
  }

  async function handleUpsertGoal(goal: ClimbGoal) {
    await upsertClimbGoal(goal);
    setClimbGoals((prev) => [goal, ...prev.filter((g) => g.id !== goal.id)]);
  }

  async function handleSetFocusGoal(goalId: string) {
    setClimbGoals((prev) => setSingleFocusGoal(prev, goalId));
    try {
      const persisted = await setFocusGoal(goalId);
      setClimbGoals(persisted);
    } catch {
      const authoritative = await loadClimbGoals().catch(() => null);
      if (authoritative) {
        setClimbGoals(authoritative);
      }
    }
  }

  async function handleAdoptFocusGoal(goal: ClimbGoal) {
    const cleanGoal: ClimbGoal = { ...goal, isFocusGoal: false };
    await upsertClimbGoal(cleanGoal);
    setClimbGoals((prev) => [cleanGoal, ...prev.filter((g) => g.id !== cleanGoal.id)]);
    const persisted = await setFocusGoal(cleanGoal.id);
    setClimbGoals(persisted);
  }

  async function handleDeleteGoal(goalId: string) {
    await deleteClimbGoal(goalId);
    setClimbGoals((prev) => prev.filter((g) => g.id !== goalId));
  }

  async function handleInstallPatchPack(envelopeJson: string) {
    const installed = await installSignedPatchPack(envelopeJson);
    setPatchPackStatus(installed);
  }

  async function handleRefreshHighElo() {
    const snap = await refreshHighEloMeta(settings.region, 10, patchVersion);
    setHighEloMeta(snap);
  }

  function handleProfileLoaded(profile: SummonerProfileSummary) {
    const nextPuuid = profile.puuid?.trim() || null;
    if (nextPuuid && lastAccountPuuidRef.current && lastAccountPuuidRef.current !== nextPuuid) {
      setMatches([]);
      setSqlPersonalLearning(null);
      setAdcSqlPersonalLearning(null);
    }
    if (nextPuuid) {
      lastAccountPuuidRef.current = nextPuuid;
    }
    setSummonerProfile(profile);
    void loadLpHistory().then((hist) => {
      if (hist.length > 0) setLpHistory(hist);
    });
    if (nextPuuid) {
      void getCachedMatches(nextPuuid)
        .then((cached) => {
          setMatches(cached);
        })
        .catch(() => {});
      fetchRoleLearning(nextPuuid, 'JUNGLE', setSqlPersonalLearning);
      if (shouldLoadAdcLearningRef.current) {
        fetchRoleLearning(nextPuuid, 'BOTTOM', setAdcSqlPersonalLearning);
      }
    }
  }

  const hudStyle = {
    '--hud-alpha': String(Math.max(0.7, Math.min(1, settings.hudOpacity / 100))),
  } as CSSProperties;

  const liveCoachPayload =
    sessionCtx.liveCoach.status === 'ready' ? sessionCtx.liveCoach.data : null;
  const winPlanPayload =
    sessionCtx.winPlan.status === 'ready' ? sessionCtx.winPlan.data : null;
  const hasUrgentObjective = Boolean(
    liveCoachPayload?.objectives.some(
      (o) => o.status === 'live' || o.status === 'prep_vision'
    )
  );

  // Non-Tauri browser Simulator keeps an interactive full-viewport compact preview for easy testing
  if (overlayMode === 'compact' && !isTauri) {
    const scaleFactor = (settings.hudScale ?? 100) / 100;
    return (
      <div
        style={hudStyle}
        className={`flex min-h-full p-4 lg-canvas-browser ${cornerAlignmentClasses(settings.hudCorner)}`}
      >
        <div
          style={{
            width: Math.round(424 * scaleFactor),
            height: Math.round(184 * scaleFactor),
          }}
        >
          <CompactHudBar
            phase={runtimeState.phase}
            gameTime={liveCoachPayload?.liveData.gameData.gameTime ?? 0}
            objectives={liveCoachPayload?.objectives ?? []}
            buildPlan={liveCoachPayload?.buildPlan ?? null}
            topCue={liveCoachPayload?.macroCues[0] ?? null}
            openingRoute={liveCoachPayload?.isJungleRole !== false ? (winPlanPayload?.plan.routes[0] ?? null) : null}
            patchVersion={patchVersion}
            hotkey={settings.overlayHotkey}
            scalePercent={settings.hudScale ?? 100}
            activeRole={liveCoachPayload?.playedRole}
            isOffRole={liveCoachPayload ? liveCoachPayload.playedRole === 'off_role' : false}
            onExpand={() => void toggleOverlayMode('expanded')}
          />
        </div>
      </div>
    );
  }

  const canSyncLive = isTauri && (settings.hasApiKey || Boolean(settings.riotApiProxyUrl?.trim()));
  const activeNavLabel = ALL_NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'BetterJungler';

  const showApiBanner =
    apiKeyHealth &&
    (apiKeyHealth.status === 'expired' || apiKeyHealth.status === 'rate_limited') &&
    activeTab !== 'settings';
  const showWhatsNewBanner =
    !showApiBanner && Boolean(whatsNewEntry && canInstallUpdateSafely);

  const withLive = (item: NavItemDef): M3NavRailItem<ActiveTab> => ({
    ...item,
    live: tabMatchesLivePhase(item.id, runtimeState.phase),
  });
  const navItems = NAV_ITEMS.map(withLive);
  const navBottomItems = NAV_BOTTOM_ITEMS.map(withLive);

  const contextRoleLabel =
    liveCoachPayload?.playedRole === 'off_role'
      ? 'Off-role'
      : formatCoachedRoleLabel(sessionCtx.activeRole);

  const pillProfile = sessionCtx.climb.profile ?? summonerProfile;
  const profileLoading = !pillProfile && isTauri && runtimeState.lcuConnected;
  const profilePill: SummonerProfilePillProps = pillProfile
    ? {
        riotId: pillProfile.riotId,
        tier: pillProfile.tier,
        rank: pillProfile.rank,
        leaguePoints: pillProfile.leaguePoints,
        profileIconId: pillProfile.profileIconId,
        patchVersion,
        onClick: () => openSettingsSection('account'),
      }
    : {
        riotId:
          settings.riotId.trim() || (profileLoading ? 'Loading profile…' : 'Connect account'),
        tier: null,
        rank: null,
        leaguePoints: null,
        patchVersion,
        title: profileLoading
          ? 'Loading your League Client profile…'
          : 'Connect your Riot account in Settings',
        onClick: () => openSettingsSection('account'),
      };

  const latestVersion = updateInfo?.latestVersion ?? null;
  const showUpdateBadge = Boolean(
    updateInfo?.available &&
      latestVersion &&
      canInstallUpdateSafely &&
      dismissedUpdateVersion !== latestVersion
  );

  const updateBadge =
    showUpdateBadge && latestVersion ? (
      navCollapsed ? (
        <button
          type="button"
          aria-label={`Update v${latestVersion}`}
          title={`Update v${latestVersion}`}
          onClick={() => openSettingsSection('updates')}
          className="m3-icon-btn m3-state bg-[var(--md-ext-success-container)] text-[var(--md-ext-on-success-container)]"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      ) : (
        <div className="m3-label-l flex h-10 items-center gap-1 rounded-full bg-[var(--md-ext-success-container)] pr-1 pl-3.5 text-[var(--md-ext-on-success-container)]">
          <Sparkles className="h-4 w-4 shrink-0" />
          <button
            type="button"
            onClick={() => openSettingsSection('updates')}
            className="m3-focus-ring min-w-0 flex-1 truncate rounded-full px-1 text-left font-semibold hover:underline"
          >
            Update v{latestVersion}
          </button>
          <button
            type="button"
            aria-label="Dismiss update notification"
            onClick={() => handleDismissUpdatePill(latestVersion)}
            className="m3-icon-btn m3-state h-8 w-8 text-[var(--md-ext-on-success-container)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    ) : undefined;

  return (
    <div
      className={`flex min-h-full items-center justify-center ${
        isTauri ? 'p-0' : 'p-4 lg-canvas-browser'
      }`}
    >
      <div
        data-phase={runtimeState.phase}
        data-urgent={hasUrgentObjective ? 'true' : 'false'}
        className={`m3-shell flex w-full overflow-hidden ${
          isTauri
            ? 'h-screen rounded-none'
            : 'h-[min(92vh,800px)] max-w-[1280px] rounded-[28px]'
        }`}
      >
        {/* M3 Expressive collapsible navigation rail (Ctrl+B) */}
        <M3NavRail<ActiveTab>
          items={navItems}
          bottomItems={navBottomItems}
          activeId={activeTab}
          onSelect={(id) => {
            if (id === 'settings') {
              setSettingsNavState((prev) => ({ ...prev, token: 0 }));
            }
            setActiveTab(id);
          }}
          collapsed={navCollapsed}
          onToggleCollapsed={() => setNavCollapsed((v) => !v)}
          brand={<BrandMark size={navCollapsed ? 28 : 26} />}
          brandText={
            <span className="block min-w-0" title={`BetterJungler · Patch ${patchVersion}`}>
              <span className="m3-title-m block truncate">BetterJungler</span>
              <span className="m3-label-m m3-faint num block truncate">Patch {patchVersion}</span>
            </span>
          }
          phase={runtimeState.phase}
          lcuConnected={runtimeState.lcuConnected}
          liveClientConnected={runtimeState.liveClientConnected}
          footer={updateBadge}
        />

        {/* Main Workspace Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* 48px draggable M3 top app bar — every action shares the unified 32px pill */}
          <M3TopAppBar
            title={activeNavLabel}
            championName={playerChampionName && resolvedMapSide ? playerChampionName : null}
            championIconUrl={championIconUrl}
            roleLabel={contextRoleLabel}
            mapSide={resolvedMapSide}
            recordingElapsedSec={
              runtimeState.recordingStatus === 'recording'
                ? (runtimeState.recordingElapsedSec ?? 0)
                : null
            }
            onToggleHud={() =>
              void toggleOverlayMode(overlayMode === 'compact' ? 'expanded' : 'compact')
            }
            hudVisible={overlayMode === 'compact'}
            hudHotkey={settings.overlayHotkey}
            profile={profilePill}
            showWindowControls={isTauri}
          />

          {/* Scrollable Tab Workspace */}
          <main className="hud-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-5">
            <div className="mx-auto max-w-[1180px] space-y-6">
              {/* Single Priority Notification Slot */}
              {showApiBanner && apiKeyHealth && (
                <div
                  role="alert"
                  className="t-caption flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-rose-400/35 bg-rose-500/10 px-4 py-2.5 text-rose-200"
                >
                  <span>{apiKeyHealth.message}</span>
                  <button
                    type="button"
                    onClick={() => openSettingsSection('account')}
                    className="lg-btn-glass shrink-0 px-2.5 py-1 text-xs font-semibold text-white"
                  >
                    Open Settings
                  </button>
                </div>
              )}

              {showWhatsNewBanner && whatsNewEntry && (
                <div className="lg-inset flex items-start justify-between gap-3 p-3.5 t-caption">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-white">
                      <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                      <span>What&apos;s New in v{whatsNewEntry.version}</span>
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-white/[0.72]">
                      {whatsNewEntry.sections
                        .flatMap((s) => s.items)
                        .slice(0, 3)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss What's New"
                    onClick={handleDismissWhatsNew}
                    className="rounded-md p-1 text-white/[0.55] hover:bg-white/[0.08] hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div key={activeTab} className="lg-view-enter">
                {activeTab === 'climb_goals' && (
                  <ClimbLadderView
                    summonerProfile={sessionCtx.climb.profile}
                    targetDivision={settings.targetDivision}
                    summaries={sessionCtx.climb.summaries}
                    matches={sessionCtx.climb.jungleMatches}
                    allMatchesForSessions={sessionCtx.climb.matches}
                    sqlPersonalLearning={sqlPersonalLearning}
                    offRoleExcludedCount={sessionCtx.climb.offRoleExcludedCount}
                    activeRole={sessionCtx.activeRole}
                    roleSource={sessionCtx.roleSource}
                    onSelectRole={setManualRole}
                    adcMatches={sessionCtx.climb.adcMatches}
                    adcOffRoleExcludedCount={sessionCtx.climb.adcOffRoleExcludedCount}
                    adcSqlPersonalLearning={adcSqlPersonalLearning}
                    roleBenchmarks={adcRoleBenchmarks}
                    lpHistory={sessionCtx.climb.lpHistory}
                    patchVersion={patchVersion}
                    goals={climbGoals}
                    highEloMeta={sessionCtx.climb.highEloMeta}
                    canSyncLive={canSyncLive}
                    accountReady={sessionCtx.climb.accountReady}
                    emptyReason={sessionCtx.climb.emptyReason}
                    hasVerifiedKey={apiKeyHealth?.status === 'valid'}
                    hasTestedHud={hasTestedHud}
                    overlayHotkey={settings.overlayHotkey}
                    onUpsertGoal={handleUpsertGoal}
                    onDeleteGoal={handleDeleteGoal}
                    onSetFocusGoal={handleSetFocusGoal}
                    onAdoptFocusGoal={handleAdoptFocusGoal}
                    onRefreshHighElo={handleRefreshHighElo}
                    onSyncMatches={handleSyncMatches}
                    onOpenSettings={() => openSettingsSection('account')}
                    onTestHud={() => void toggleOverlayMode('compact')}
                  />
                )}
                {activeTab === 'champ_select' && (
                  <ChampSelectView
                    session={
                      sessionCtx.champSelect.status === 'ready'
                        ? sessionCtx.champSelect.data
                        : null
                    }
                    patchVersion={patchVersion}
                    summonerProfile={sessionCtx.climb.profile}
                    highEloMeta={sessionCtx.climb.highEloMeta}
                    personalStats={personalStats}
                    metaTierOverrides={patchPackStatus?.payload.metaTierOverrides}
                    focusGoal={focusGoal}
                    activeRole={sessionCtx.activeRole}
                    roleSource={sessionCtx.roleSource}
                    onSelectRole={setManualRole}
                  />
                )}
                {activeTab === 'win_plan' && (
                  <WinConditionView
                    plan={winPlanPayload?.plan ?? null}
                    mapSide={winPlanPayload?.mapSide ?? null}
                    championName={winPlanPayload?.championName ?? null}
                    patchVersion={patchVersion}
                    aiConfig={settings.aiCoach}
                    focusGoal={focusGoal}
                    objectiveTimings={patchPackStatus?.payload.objectiveTimings}
                    emptyReason={
                      sessionCtx.winPlan.status === 'empty'
                        ? sessionCtx.winPlan.reason
                        : undefined
                    }
                    draftProgress={
                      sessionCtx.winPlan.status === 'empty'
                        ? sessionCtx.winPlan.progress
                        : undefined
                    }
                    activeRole={sessionCtx.activeRole}
                    adcPlan={winPlanPayload?.adcPlan ?? null}
                    onSelectRole={setManualRole}
                  />
                )}
                {activeTab === 'live_coach' && (
                  <LiveCoachView
                    phase={runtimeState.phase}
                    isJungleRole={liveCoachPayload?.isJungleRole ?? true}
                    liveData={liveCoachPayload?.liveData ?? null}
                    objectives={liveCoachPayload?.objectives ?? []}
                    buildPlan={liveCoachPayload?.buildPlan ?? null}
                    macroCues={liveCoachPayload?.macroCues ?? []}
                    winPlan={liveCoachPayload?.winPlan ?? null}
                    mapSide={liveCoachPayload?.mapSide ?? null}
                    patchVersion={patchVersion}
                    smiteThresholds={patchPackStatus?.payload.smiteThresholds}
                    playedRole={liveCoachPayload?.playedRole ?? sessionCtx.livePlayedRole}
                    adcWinPlan={liveCoachPayload?.adcWinPlan ?? null}
                  />
                )}
                {activeTab === 'post_game' && (
                  <PostGameReviewView
                    matches={
                      sessionCtx.postGame.status === 'ready'
                        ? sessionCtx.postGame.data.matches
                        : []
                    }
                    targetDivision={settings.targetDivision}
                    patchVersion={patchVersion}
                    appVersion={appMeta.version}
                    aiConfig={settings.aiCoach}
                    canSyncLive={canSyncLive}
                    isTauri={isTauri}
                    focusGoal={focusGoal}
                    lastAutoSyncedMatchId={lastAutoSyncedMatchId}
                    autoSyncNotice={autoSyncNotice}
                    roleBenchmarks={adcRoleBenchmarks}
                    emptyReason={
                      sessionCtx.postGame.status === 'empty'
                        ? sessionCtx.postGame.reason
                        : undefined
                    }
                    onSyncMatches={handleSyncMatches}
                    onOpenSettings={(section) => openSettingsSection(section ?? 'account')}
                  />
                )}
                {activeTab === 'settings' && (
                  <SettingsView
                    settings={settings}
                    patchVersion={patchVersion}
                    catalogCounts={catalogCounts}
                    apiKeyHealth={apiKeyHealth}
                    appMeta={appMeta}
                    updateInfo={updateInfo}
                    checkingUpdate={checkingUpdate}
                    installingUpdate={installingUpdate}
                    stagingUpdate={stagingUpdate}
                    stagedUpdateVersion={stagedUpdateVersion}
                    updateError={updateError}
                    canInstallUpdateSafely={canInstallUpdateSafely}
                    isTauri={isTauri}
                    patchPackStatus={patchPackStatus}
                    initialSection={settingsNavState.section}
                    initialSectionToken={settingsNavState.token}
                    onSettingsChanged={setSettings}
                    onProfileLoaded={handleProfileLoaded}
                    onPatchSynced={(patch, counts) => {
                      setPatchVersion(patch);
                      if (counts) setCatalogCounts(counts);
                    }}
                    onApiKeyHealthChanged={setApiKeyHealth}
                    onCheckUpdate={handleCheckUpdate}
                    onInstallUpdate={handleInstallUpdate}
                    onStageUpdate={handleStageUpdate}
                    onInstallPatchPack={handleInstallPatchPack}
                  />
                )}
              </div>
            </div>
          </main>

          {/* Mandatory Riot Games Legal Disclaimer */}
          <footer
            role="contentinfo"
            className="border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] px-6 py-2 text-[11px] leading-relaxed text-[var(--md-sys-color-on-surface-variant)]"
          >
            <p>
              BetterJungler isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
              opinions of Riot Games or anyone officially involved in producing or managing Riot
              Games properties. Riot Games, and all associated properties are trademarks or
              registered trademarks of Riot Games, Inc.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
