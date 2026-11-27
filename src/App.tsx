import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  History,
  Info,
  Map as MapIcon,
  Minus,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Swords,
  TrendingUp,
  X,
} from 'lucide-react';
import pkg from '../package.json';
import changelogRaw from '../CHANGELOG.md?raw';
import { ChampSelectView } from './components/ChampSelectView';
import { ClimbLadderView } from './components/ClimbLadderView';
import { CompactHudBar } from './components/CompactHudBar';
import { LiveCoachView } from './components/LiveCoachView';
import { PostGameReviewView } from './components/PostGameReviewView';
import { SettingsView } from './components/SettingsView';
import { WinConditionView } from './components/WinConditionView';
import { computePersonalChampStats } from './domain/champSelectEngine';
import { parseChangelog } from './domain/changelogParser';
import { setSingleFocusGoal } from './domain/climbLadderEngine';
import { formatClock } from './domain/liveCoachEngine';
import { deriveSessionContext } from './domain/sessionContext';
import { useInterpolatedGameTime } from './hooks/useInterpolatedGameTime';
import {
  fetchLatestPatchVersion,
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
  getLcuProfile,
  installAppUpdate,
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
  ActiveTab,
  ApiKeyHealthStatus,
  AppMetaInfo,
  ClimbGoal,
  DemoScenarioId,
  HighEloMetaSnapshot,
  HudCorner,
  LpHistoryPoint,
  OverlayMode,
  UpdateCheckResult,
  UserSettings,
} from './types/coaching';
import type {
  AppRuntimeState,
  GamePhase,
  MatchV5Detail,
  SummonerProfileSummary,
} from './types/riot';

const DEMO_OPTIONS: Array<{ id: DemoScenarioId; label: string }> = [
  { id: 'idle', label: 'Live Client Mode' },
  { id: 'champ_select', label: 'Sample: Champ Select' },
  { id: 'loading', label: 'Sample: Loading & Map' },
  { id: 'in_game_early', label: 'Sample: Early Game (4:15)' },
  { id: 'in_game_mid', label: 'Sample: Mid Game (19:24)' },
  { id: 'in_game_full_build', label: 'Sample: Full Build (37:40)' },
];

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

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; icon: typeof Swords }> = [
  { id: 'climb_goals', label: 'Climb & Goals', icon: TrendingUp },
  { id: 'champ_select', label: 'Champ Select', icon: Swords },
  { id: 'win_plan', label: 'Win Plan & Map', icon: MapIcon },
  { id: 'live_coach', label: 'Live Coach', icon: Activity },
  { id: 'post_game', label: 'Post-Game Review', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function tabMatchesLivePhase(tab: ActiveTab, phase: GamePhase): boolean {
  if (phase === 'champ_select') return tab === 'champ_select';
  if (phase === 'loading') return tab === 'win_plan';
  if (phase === 'in_game') return tab === 'live_coach';
  if (phase === 'post_game') return tab === 'post_game';
  return false;
}

export function App() {
  const isTauri = isTauriEnvironment();
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>('idle');
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
      model: 'gemini-2.5-flash',
      endpoint: 'http://127.0.0.1:11434',
      hasApiKey: false,
    },
  });
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
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
  const simSelectRef = useRef<HTMLSelectElement | null>(null);
  const simPopoverRef = useRef<HTMLDivElement | null>(null);
  const simButtonRef = useRef<HTMLButtonElement | null>(null);

  const lastPhaseRef = useRef<GamePhase | null>(null);
  const hadActiveMatchRef = useRef(false);
  const inEndOfGameCycleRef = useRef(false);
  const endOfGameAtMsRef = useRef<number>(0);

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
      if (isTauri && state.phase !== 'idle') {
        setDemoScenario('idle');
      }
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
      if (active && cached.length > 0) setMatches(cached);
    });
    void loadLpHistory().then((hist) => {
      if (active && hist.length > 0) setLpHistory(hist);
    });

    const unsubPromise = subscribeGameState(
      (state) => {
        setLiveState(state);
        if (isTauri && state.phase !== 'idle') {
          setDemoScenario('idle');
        }
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
    if (!isTauri || !liveState?.lcuConnected || summonerProfile) return;
    let active = true;
    void getLcuProfile(settings.region)
      .then((profile) => {
        if (!active) return;
        setSummonerProfile(profile);
        if (profile.puuid) {
          void getCachedMatches(profile.puuid).then((cached) => {
            if (active && cached.length > 0) setMatches(cached);
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isTauri, liveState?.lcuConnected, summonerProfile, settings.region]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSimulatorOpen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape' && simulatorOpen) {
        setSimulatorOpen(false);
        simButtonRef.current?.focus();
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
  }, [isTauri, overlayMode, settings.overlayHotkey, simulatorOpen]);

  useEffect(() => {
    if (!simulatorOpen) return;
    simSelectRef.current?.focus();
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (simButtonRef.current?.contains(target)) {
        return;
      }
      if (simPopoverRef.current && !simPopoverRef.current.contains(target)) {
        setSimulatorOpen(false);
      }
    }
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [simulatorOpen]);

  const rawLiveClock = liveState?.liveGame?.gameData.gameTime ?? 0;
  const activeClockSource =
    demoScenario === 'idle' ? liveState : undefined;
  const liveMatchActive =
    demoScenario === 'idle' && liveState?.phase === 'in_game' && Boolean(liveState.liveGame);
  const interpolatedLiveTime = useInterpolatedGameTime(
    activeClockSource?.liveGame?.gameData.gameTime ?? rawLiveClock,
    liveMatchActive
  );

  const sessionCtx = useMemo(
    () =>
      deriveSessionContext({
        demoScenario,
        liveState,
        settings,
        summonerProfile,
        matches,
        lpHistory,
        highEloMeta,
        interpolatedGameTime: demoScenario === 'idle' && liveMatchActive ? interpolatedLiveTime : undefined,
      }),
    [
      demoScenario,
      liveState,
      settings,
      summonerProfile,
      matches,
      lpHistory,
      highEloMeta,
      liveMatchActive,
      interpolatedLiveTime,
    ]
  );

  const { runtimeState, resolvedMapSide, playerChampionName } = sessionCtx;

  const focusGoal = useMemo(
    () =>
      climbGoals.find((g) => g.isFocusGoal && g.status === 'active') ??
      climbGoals.find((g) => g.isFocusGoal) ??
      null,
    [climbGoals]
  );

  const personalStats = useMemo(
    () => computePersonalChampStats(sessionCtx.climb.matches),
    [sessionCtx.climb.matches]
  );

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
            setMatches(synced);
            setLastAutoSyncedMatchId(newest.matchId);
            setAutoSyncNotice(null);
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

  function handleScenarioChange(
    nextScenario: DemoScenarioId,
    options?: { stayOnTab?: boolean }
  ) {
    setDemoScenario(nextScenario);
    if (options?.stayOnTab) return;
    if (nextScenario === 'champ_select') setActiveTab('champ_select');
    else if (nextScenario === 'loading') setActiveTab('win_plan');
    else if (nextScenario.startsWith('in_game')) setActiveTab('live_coach');
  }

  async function handleSyncMatches() {
    if (demoScenario !== 'idle') return;
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
      setMatches(synced);
      setAutoSyncNotice(null);
    }
  }

  async function handleUpsertGoal(goal: ClimbGoal) {
    await upsertClimbGoal(goal);
    setClimbGoals((prev) => [goal, ...prev.filter((g) => g.id !== goal.id)]);
  }

  async function handleSetFocusGoal(goalId: string) {
    const previous = climbGoals;
    setClimbGoals(setSingleFocusGoal(previous, goalId));
    try {
      const persisted = await setFocusGoal(goalId);
      setClimbGoals(persisted);
    } catch {
      setClimbGoals(previous);
    }
  }

  async function handleDeleteGoal(goalId: string) {
    await deleteClimbGoal(goalId);
    setClimbGoals((prev) => prev.filter((g) => g.id !== goalId));
  }

  async function handleRefreshHighElo() {
    const snap = await refreshHighEloMeta(settings.region, 10, patchVersion);
    setHighEloMeta(snap);
  }

  function handleProfileLoaded(profile: SummonerProfileSummary) {
    setSummonerProfile(profile);
    void loadLpHistory().then((hist) => {
      if (hist.length > 0) setLpHistory(hist);
    });
    if (profile.puuid) {
      void getCachedMatches(profile.puuid).then((cached) => {
        if (cached.length > 0) setMatches(cached);
      });
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
            openingRoute={winPlanPayload?.plan.routes[0] ?? null}
            patchVersion={patchVersion}
            hotkey={settings.overlayHotkey}
            scalePercent={settings.hudScale ?? 100}
            onExpand={() => void toggleOverlayMode('expanded')}
          />
        </div>
      </div>
    );
  }

  const canSyncLive = isTauri && (settings.hasApiKey || Boolean(settings.riotApiProxyUrl?.trim()));
  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'BetterJungler';

  const showApiBanner =
    apiKeyHealth &&
    (apiKeyHealth.status === 'expired' || apiKeyHealth.status === 'rate_limited') &&
    activeTab !== 'settings';
  const showWhatsNewBanner =
    !showApiBanner && Boolean(whatsNewEntry && canInstallUpdateSafely);

  return (
    <div
      className={`flex min-h-full items-center justify-center ${
        isTauri ? 'p-0' : 'p-4 lg-canvas-browser'
      }`}
    >
      <div
        data-phase={runtimeState.phase}
        data-urgent={hasUrgentObjective ? 'true' : 'false'}
        className={`mat-chrome flex w-full overflow-hidden text-white/[0.92] ${
          isTauri ? 'h-screen rounded-none' : 'h-[min(92vh,800px)] max-w-[1100px]'
        }`}
      >
        {/* Architectural Left Navigation Rail */}
        <aside className="flex w-[204px] shrink-0 flex-col justify-between border-r border-white/[0.08] bg-black/20 p-4">
          <div className="space-y-5">
            <div data-tauri-drag-region className="cursor-grab px-2 select-none active:cursor-grabbing">
              <div className="pointer-events-none flex items-center justify-between gap-2">
                <h1 className="t-title text-white">BetterJungler</h1>
              </div>
              <div className="t-caption pointer-events-none mt-0.5 text-white/[0.45]">
                Patch {patchVersion}
              </div>
            </div>

            <nav aria-label="Primary navigation" className="space-y-1">
              {NAV_ITEMS.map((tab) => {
                const active = activeTab === tab.id;
                const livePhaseHit = tabMatchesLivePhase(tab.id, runtimeState.phase);
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex h-8 w-full items-center justify-between gap-2 rounded-[7px] px-2.5 text-left text-xs font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-white/[0.58] hover:bg-white/[0.04] hover:text-white/[0.92]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                        className="lg-segment-active absolute inset-0"
                      />
                    )}
                    <span className="relative z-10 flex min-w-0 items-center gap-2.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{tab.label}</span>
                    </span>
                    {livePhaseHit && (
                      <span
                        title="Active match phase"
                        className="relative z-10 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="space-y-2.5 border-t border-white/[0.08] pt-3.5 t-caption">
            <div className="space-y-1.5 px-2 text-white/[0.58]">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.lcuConnected ? 'bg-emerald-400' : 'bg-white/25'
                    }`}
                  />
                  League Client
                </span>
                <span className="text-[11px] text-white/[0.4]">
                  {runtimeState.lcuConnected ? 'Ready' : 'Standby'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.liveClientConnected ? 'bg-emerald-400' : 'bg-white/25'
                    }`}
                  />
                  Live Match
                </span>
                <span className="text-[11px] text-white/[0.4]">
                  {runtimeState.liveClientConnected ? 'Active' : 'Standby'}
                </span>
              </div>
            </div>

            {updateInfo?.available &&
              updateInfo.latestVersion &&
              canInstallUpdateSafely &&
              dismissedUpdateVersion !== updateInfo.latestVersion && (
                <div className="flex items-center gap-1 rounded-[7px] border border-emerald-400/30 bg-emerald-500/12 px-2.5 py-1.5 text-xs text-emerald-200">
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="flex-1 truncate text-left font-medium hover:underline"
                  >
                    Update v{updateInfo.latestVersion}
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss update notification"
                    onClick={() => handleDismissUpdatePill(updateInfo.latestVersion!)}
                    className="text-emerald-300/80 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
          </div>
        </aside>

        {/* Main Workspace Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* 40px Top Window Drag & Controls Strip */}
          <div
            data-tauri-drag-region
            className="flex h-10 shrink-0 cursor-grab items-center justify-between gap-3 border-b border-white/[0.06] px-6 select-none active:cursor-grabbing"
          >
            <div className="pointer-events-none flex min-w-0 items-center gap-2.5">
              <span className="truncate text-xs font-semibold text-white/[0.92]">
                {activeNavLabel}
              </span>
              {playerChampionName && resolvedMapSide && (
                <span className="t-caption truncate text-white/[0.45]">
                  · {playerChampionName} ({resolvedMapSide === 'blue' ? 'Blue' : 'Red'})
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {runtimeState.recordingStatus === 'recording' && (
                <div
                  title="Opt-in League HWND GPU recording active"
                  className="tabular-nums flex items-center gap-1.5 rounded-full border border-rose-400/35 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                  <span>REC {formatClock(runtimeState.recordingElapsedSec ?? 0)}</span>
                </div>
              )}

              {sessionCtx.simulationLabel && (
                <div className="flex items-center gap-2 rounded-full border border-amber-400/35 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
                  <span>Simulation · {sessionCtx.simulationLabel}</span>
                  <button
                    type="button"
                    onClick={() => handleScenarioChange('idle')}
                    className="font-semibold text-amber-100 underline-offset-2 hover:underline"
                  >
                    Exit
                  </button>
                </div>
              )}

              <button
                ref={simButtonRef}
                type="button"
                aria-expanded={simulatorOpen}
                onClick={() => setSimulatorOpen((v) => !v)}
                className={`lg-btn-glass flex h-7 items-center gap-1.5 px-2.5 text-xs font-medium ${
                  demoScenario !== 'idle' ? 'text-amber-200' : 'text-white/[0.72]'
                }`}
                title="Preview simulated match scenarios (Ctrl+K)"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Simulator</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void toggleOverlayMode(overlayMode === 'compact' ? 'expanded' : 'compact')
                }
                className="lg-btn-glass flex h-7 items-center gap-2 px-2.5 text-xs font-medium text-white/[0.88]"
              >
                <span>{overlayMode === 'compact' ? 'Hide HUD' : 'Compact HUD'}</span>
                <kbd className="font-mono text-[11px] text-white/[0.45]">
                  {settings.overlayHotkey}
                </kbd>
              </button>

              {isTauri && (
                <div className="ml-1 flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Minimize window"
                    onClick={() => {
                      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
                        getCurrentWindow().minimize()
                      );
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] text-white/[0.58] hover:bg-white/[0.08] hover:text-white"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Close window"
                    onClick={() => {
                      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
                        getCurrentWindow().close()
                      );
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-[7px] text-white/[0.58] hover:bg-rose-500/20 hover:text-rose-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Simulator Popover (Ctrl+K or header button) */}
          {simulatorOpen && (
            <div
              ref={simPopoverRef}
              role="dialog"
              aria-label="Scenario Simulator"
              className="mat-glass mat-lens absolute top-11 right-6 z-30 w-72 p-3.5 text-xs"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="t-caption font-semibold text-white/[0.85]">Scenario Simulator</span>
                <button
                  type="button"
                  onClick={() => setSimulatorOpen(false)}
                  className="t-caption text-white/[0.55] hover:text-white"
                >
                  Close
                </button>
              </div>
              <select
                ref={simSelectRef}
                aria-label="Simulation scenario"
                value={demoScenario}
                onChange={(e) => {
                  handleScenarioChange(e.target.value as DemoScenarioId);
                  setSimulatorOpen(false);
                }}
                className="w-full rounded-[7px] border border-white/15 bg-black/70 px-2.5 py-2 text-xs text-white outline-none"
              >
                {DEMO_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-zinc-900 text-slate-100">
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Scrollable Tab Workspace */}
          <main className="hud-scroll flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto max-w-[920px] space-y-6">
              {/* Single Priority Notification Slot */}
              {showApiBanner && apiKeyHealth && (
                <div
                  role="alert"
                  className="t-caption flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-rose-400/35 bg-rose-500/10 px-4 py-2.5 text-rose-200"
                >
                  <span>{apiKeyHealth.message}</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
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
                    matches={sessionCtx.climb.matches}
                    lpHistory={sessionCtx.climb.lpHistory}
                    patchVersion={patchVersion}
                    goals={climbGoals}
                    highEloMeta={sessionCtx.climb.highEloMeta}
                    canSyncLive={canSyncLive || demoScenario !== 'idle'}
                    accountReady={sessionCtx.climb.accountReady}
                    emptyReason={sessionCtx.climb.emptyReason}
                    hasVerifiedKey={apiKeyHealth?.status === 'valid'}
                    hasTestedHud={hasTestedHud}
                    overlayHotkey={settings.overlayHotkey}
                    onUpsertGoal={handleUpsertGoal}
                    onDeleteGoal={handleDeleteGoal}
                    onSetFocusGoal={handleSetFocusGoal}
                    onRefreshHighElo={handleRefreshHighElo}
                    onSyncMatches={handleSyncMatches}
                    onOpenSettings={() => setActiveTab('settings')}
                    onTestHud={() => void toggleOverlayMode('compact')}
                    onPreviewSample={(scenario) =>
                      handleScenarioChange(scenario, { stayOnTab: true })
                    }
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
                    focusGoal={focusGoal}
                    onPreviewSample={handleScenarioChange}
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
                    onPreviewSample={handleScenarioChange}
                  />
                )}
                {activeTab === 'live_coach' && (
                  <LiveCoachView
                    phase={runtimeState.phase}
                    liveData={liveCoachPayload?.liveData ?? null}
                    objectives={liveCoachPayload?.objectives ?? []}
                    buildPlan={liveCoachPayload?.buildPlan ?? null}
                    macroCues={liveCoachPayload?.macroCues ?? []}
                    winPlan={liveCoachPayload?.winPlan ?? null}
                    mapSide={liveCoachPayload?.mapSide ?? null}
                    patchVersion={patchVersion}
                    onPreviewSample={handleScenarioChange}
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
                    emptyReason={
                      sessionCtx.postGame.status === 'empty'
                        ? sessionCtx.postGame.reason
                        : undefined
                    }
                    onSyncMatches={handleSyncMatches}
                    onOpenSettings={() => setActiveTab('settings')}
                    onPreviewSample={(scenario) =>
                      handleScenarioChange(scenario, { stayOnTab: true })
                    }
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
                  />
                )}
              </div>
            </div>
          </main>

          {/* Mandatory Riot Games Legal Disclaimer */}
          <footer className="border-t border-white/[0.06] bg-black/25 px-6 py-2 text-[11px] leading-relaxed text-white/[0.42]">
            <div className="flex items-center justify-between gap-2">
              <span className={legalOpen ? '' : 'truncate'}>
                BetterJungler isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views
                or opinions of Riot Games or anyone officially involved in producing or managing Riot
                Games properties. Riot Games, and all associated properties are trademarks or
                registered trademarks of Riot Games, Inc.
              </span>
              <button
                type="button"
                aria-expanded={legalOpen}
                onClick={() => setLegalOpen((v) => !v)}
                aria-label="Toggle legal disclaimer"
                className="flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-[7px] p-1 text-white/[0.45] hover:bg-white/[0.06] hover:text-white"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default App;
