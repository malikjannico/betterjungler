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
  Swords,
  TrendingUp,
  X,
} from 'lucide-react';
import { ChampSelectView } from './components/ChampSelectView';
import { ClimbLadderView } from './components/ClimbLadderView';
import { CompactHudBar } from './components/CompactHudBar';
import { LiveCoachView } from './components/LiveCoachView';
import { PostGameReviewView } from './components/PostGameReviewView';
import { SettingsView } from './components/SettingsView';
import { WinConditionView } from './components/WinConditionView';
import { findJungleChampionById, findJungleChampionByName } from './data/jungleKnowledgePack';
import {
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  resolveSelfPlayer,
} from './domain/liveCoachEngine';
import {
  DEMO_HIGH_ELO_SNAPSHOT,
  DEMO_LP_HISTORY,
  DEMO_POST_GAME_MATCHES,
  DEMO_ROLLING_SUMMARIES,
} from './domain/postGameFixtures';
import { analyzePostGameMatch, toMatchSummaryRecord } from './domain/postGameReviewEngine';
import {
  DEMO_CHAMP_SELECT,
  DEMO_LOADING_CHAMP_SELECT,
  getDemoRuntimeState,
} from './domain/simulationFixtures';
import { generateWinConditionPlan } from './domain/winConditionEngine';
import {
  fetchLatestPatchVersion,
  syncFullDdragonCatalog,
} from './services/ddragonService';
import {
  deleteClimbGoal,
  getAppState,
  getCachedMatches,
  getCachedMetaSnapshot,
  getLcuProfile,
  isTauriEnvironment,
  loadClimbGoals,
  loadLpHistory,
  loadSettings,
  refreshHighEloMeta,
  setOverlayMode,
  subscribeGameState,
  syncDdragonPatch,
  syncRecentMatches,
  upsertClimbGoal,
} from './services/tauriBridge';
import type {
  ActiveTab,
  ClimbGoal,
  DemoScenarioId,
  HighEloMetaSnapshot,
  HudCorner,
  LpHistoryPoint,
  OverlayMode,
  UserSettings,
} from './types/coaching';
import type {
  AppRuntimeState,
  GamePhase,
  LaneRole,
  MatchV5Detail,
  SummonerProfileSummary,
} from './types/riot';

const DEMO_OPTIONS: Array<{ id: DemoScenarioId; label: string }> = [
  { id: 'champ_select', label: 'Demo: Champ Select' },
  { id: 'loading', label: 'Demo: Loading & Map' },
  { id: 'in_game_early', label: 'Demo: Early Game (4:15)' },
  { id: 'in_game_mid', label: 'Demo: Mid Game (19:24)' },
  { id: 'in_game_full_build', label: 'Demo: Full Build (37:40)' },
  { id: 'idle', label: 'Live Client Mode' },
];

function extractRoleMap(
  slots: typeof DEMO_LOADING_CHAMP_SELECT.myTeam
): Partial<Record<LaneRole, number>> {
  const map: Partial<Record<LaneRole, number>> = {};
  for (const s of slots) {
    if (s.assignedPosition !== 'unknown' && s.championId > 0) {
      map[s.assignedPosition] = s.championId;
    }
  }
  return map;
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

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; icon: typeof Swords }> = [
  { id: 'champ_select', label: 'Champ Select', icon: Swords },
  { id: 'win_plan', label: 'Win Plan & Map', icon: MapIcon },
  { id: 'live_coach', label: 'Live Coach', icon: Activity },
  { id: 'post_game', label: 'Post-Game Review', icon: History },
  { id: 'climb_goals', label: 'Climb & Goals', icon: TrendingUp },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function App() {
  const isTauri = isTauriEnvironment();
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>(() =>
    isTauriEnvironment() ? 'idle' : 'champ_select'
  );
  const [liveState, setLiveState] = useState<AppRuntimeState | null>(null);
  const [overlayMode, setMode] = useState<OverlayMode>('expanded');
  const [activeTab, setActiveTab] = useState<ActiveTab>('champ_select');
  const [patchVersion, setPatchVersion] = useState<string>('16.23.1');
  const [catalogCounts, setCatalogCounts] = useState<{ champions: number; items: number }>({
    champions: 0,
    items: 0,
  });
  const [summonerProfile, setSummonerProfile] = useState<SummonerProfileSummary | null>(null);
  const [matches, setMatches] = useState<MatchV5Detail[]>(() =>
    isTauriEnvironment() ? [] : DEMO_POST_GAME_MATCHES
  );
  const [lpHistory, setLpHistory] = useState<LpHistoryPoint[]>(() =>
    isTauriEnvironment() ? [] : DEMO_LP_HISTORY
  );
  const [climbGoals, setClimbGoals] = useState<ClimbGoal[]>([]);
  const [highEloMeta, setHighEloMeta] = useState<HighEloMetaSnapshot | null>(() =>
    isTauriEnvironment() ? null : DEMO_HIGH_ELO_SNAPSHOT
  );
  const [settings, setSettings] = useState<UserSettings>({
    riotId: '',
    region: 'EUW1',
    lolInstallPath: 'C:\\Riot Games\\League of Legends',
    overlayHotkey: 'Alt+J',
    hudCorner: 'beside-minimap',
    hudOpacity: 92,
    targetDivision: 'PLATINUM IV',
    hasApiKey: false,
    aiCoach: {
      provider: 'off',
      model: 'gemini-2.5-flash',
      endpoint: 'http://127.0.0.1:11434',
      hasApiKey: false,
    },
  });
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const simSelectRef = useRef<HTMLSelectElement | null>(null);
  const simPopoverRef = useRef<HTMLDivElement | null>(null);
  const simButtonRef = useRef<HTMLButtonElement | null>(null);

  const lastPhaseRef = useRef<GamePhase | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => {
      if (active) setSettings(s);
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
      if (active && cached.length > 0) setMatches(cached);
    });
    void loadLpHistory().then((hist) => {
      if (active && hist.length > 0) setLpHistory(hist);
    });

    const unsubPromise = subscribeGameState(
      (state) => {
        setLiveState(state);
        if (state.summonerProfile) {
          setSummonerProfile(state.summonerProfile);
        }
        if (state.phase !== lastPhaseRef.current) {
          lastPhaseRef.current = state.phase;
          if (state.phase === 'champ_select') setActiveTab('champ_select');
          else if (state.phase === 'loading') setActiveTab('win_plan');
          else if (state.phase === 'in_game') setActiveTab('live_coach');
          else if (state.phase === 'post_game') setActiveTab('post_game');
        }
      },
      (mode) => setMode(mode)
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

  const runtimeState: AppRuntimeState = useMemo(() => {
    if (demoScenario !== 'idle') {
      return getDemoRuntimeState(demoScenario);
    }
    return liveState ?? getDemoRuntimeState('idle');
  }, [demoScenario, liveState]);

  const effectiveChampSelect =
    runtimeState.champSelect ?? (demoScenario !== 'idle' ? DEMO_LOADING_CHAMP_SELECT : null);

  const resolvedMapSide = useMemo(() => {
    if (effectiveChampSelect?.mapSide) return effectiveChampSelect.mapSide;
    if (runtimeState.liveGame) {
      const liveSelf = resolveSelfPlayer(runtimeState.liveGame);
      if (liveSelf) return liveSelf.team === 'CHAOS' ? 'red' : 'blue';
    }
    return 'blue';
  }, [effectiveChampSelect, runtimeState.liveGame]);

  const winPlan = useMemo(() => {
    const allyRoles = effectiveChampSelect ? extractRoleMap(effectiveChampSelect.myTeam) : {};
    const enemyRoles = effectiveChampSelect ? extractRoleMap(effectiveChampSelect.theirTeam) : {};
    const playerSlot = effectiveChampSelect?.myTeam.find((s) => s.isLocalPlayer);
    const liveSelf = runtimeState.liveGame ? resolveSelfPlayer(runtimeState.liveGame) : null;
    const liveProfile = liveSelf ? findJungleChampionByName(liveSelf.championName) : undefined;
    const playerChampId =
      liveProfile?.championId ??
      (playerSlot?.championId && playerSlot.championId > 0 ? playerSlot.championId : 234);
    return generateWinConditionPlan({
      allyRoles,
      enemyRoles,
      playerChampionId: playerChampId,
      mapSide: resolvedMapSide,
    });
  }, [effectiveChampSelect, resolvedMapSide, runtimeState.liveGame]);

  const playerChampionName = useMemo(() => {
    if (runtimeState.liveGame) {
      const liveSelf = resolveSelfPlayer(runtimeState.liveGame);
      if (liveSelf) return liveSelf.championName;
    }
    const slot = effectiveChampSelect?.myTeam.find((s) => s.isLocalPlayer);
    if (slot && slot.championId > 0) {
      return findJungleChampionById(slot.championId)?.name ?? 'Jungler';
    }
    return demoScenario === 'idle' ? 'Unassigned' : 'Viego';
  }, [effectiveChampSelect, runtimeState.liveGame, demoScenario]);

  const objectives = useMemo(() => {
    if (!runtimeState.liveGame) return [];
    return computeObjectiveWindows(
      runtimeState.liveGame.gameData.gameTime,
      runtimeState.liveGame.events.Events,
      runtimeState.liveGame.allPlayers
    );
  }, [runtimeState.liveGame]);

  const buildPlan = useMemo(() => {
    if (!runtimeState.liveGame) return null;
    const profile = findJungleChampionByName(playerChampionName);
    return computeAdaptiveBuild(runtimeState.liveGame, profile);
  }, [runtimeState.liveGame, playerChampionName]);

  const macroCues = useMemo(() => {
    if (!runtimeState.liveGame) return [];
    return computeMacroGuidance(runtimeState.liveGame, winPlan, objectives);
  }, [runtimeState.liveGame, winPlan, objectives]);

  const effectiveProfile = summonerProfile ?? runtimeState.summonerProfile;

  const rollingSummaries = useMemo(() => {
    if (demoScenario !== 'idle') {
      return DEMO_ROLLING_SUMMARIES;
    }
    return matches.map((m) =>
      toMatchSummaryRecord(m, analyzePostGameMatch(m, settings.targetDivision))
    );
  }, [demoScenario, matches, settings.targetDivision]);

  async function toggleOverlayMode(next: OverlayMode) {
    setMode(next);
    await setOverlayMode(next);
  }

  function handleScenarioChange(nextScenario: DemoScenarioId) {
    setDemoScenario(nextScenario);
    if (nextScenario === 'champ_select') setActiveTab('champ_select');
    else if (nextScenario === 'loading') setActiveTab('win_plan');
    else if (nextScenario.startsWith('in_game')) setActiveTab('live_coach');
  }

  async function handleSyncMatches() {
    if (!effectiveProfile?.puuid && isTauri) {
      throw new Error(
        'Load your Riot profile in Settings (or open League Client) before syncing Match-V5 games.'
      );
    }
    const puuid = effectiveProfile?.puuid ?? 'demo-puuid';
    const synced = await syncRecentMatches(puuid, settings.region, 8);
    if (synced.length > 0) {
      setMatches(synced);
    }
  }

  async function handleUpsertGoal(goal: ClimbGoal) {
    await upsertClimbGoal(goal);
    setClimbGoals((prev) => [goal, ...prev.filter((g) => g.id !== goal.id)]);
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
    '--hud-alpha': String(Math.max(0.5, Math.min(1, settings.hudOpacity / 100))),
  } as CSSProperties;

  const hasUrgentObjective = objectives.some(
    (o) => o.status === 'live' || o.status === 'prep_vision'
  );

  if (overlayMode === 'compact') {
    if (isTauri) {
      return (
        <div style={hudStyle} className="h-full w-full">
          <CompactHudBar
            phase={runtimeState.phase}
            gameTime={runtimeState.liveGame?.gameData.gameTime ?? 0}
            objectives={objectives}
            buildPlan={buildPlan}
            topCue={macroCues[0] ?? null}
            hotkey={settings.overlayHotkey}
            clickThrough
            onExpand={() => void toggleOverlayMode('expanded')}
          />
        </div>
      );
    }

    return (
      <div
        style={hudStyle}
        className={`flex min-h-full p-4 lg-canvas-browser ${cornerAlignmentClasses(settings.hudCorner)}`}
      >
        <div className="h-[212px] w-[412px]">
          <CompactHudBar
            phase={runtimeState.phase}
            gameTime={runtimeState.liveGame?.gameData.gameTime ?? 0}
            objectives={objectives}
            buildPlan={buildPlan}
            topCue={macroCues[0] ?? null}
            hotkey={settings.overlayHotkey}
            onExpand={() => void toggleOverlayMode('expanded')}
          />
        </div>
      </div>
    );
  }

  const canSyncLive = isTauri && settings.hasApiKey;

  return (
    <div
      className={`flex min-h-full items-center justify-center ${
        isTauri ? 'p-0' : 'p-4 lg-canvas-browser'
      }`}
    >
      <div
        data-phase={runtimeState.phase}
        data-urgent={hasUrgentObjective ? 'true' : 'false'}
        className={`mat-chrome flex w-full overflow-hidden text-slate-100 ${
          isTauri ? 'h-screen rounded-none' : 'h-[min(92vh,800px)] max-w-[1100px]'
        }`}
      >
        {/* Floating Left Sidebar Rail */}
        <aside className="flex w-[208px] shrink-0 flex-col justify-between border-r border-white/[0.08] bg-black/20 p-4">
          <div className="space-y-5">
            <div data-tauri-drag-region className="cursor-grab px-2 select-none active:cursor-grabbing">
              <div className="pointer-events-none flex items-center justify-between gap-2">
                <h1 className="text-[12px] font-semibold tracking-[0.16em] text-white">
                  BETTERJUNGLER
                </h1>
                {isTauri && (
                  <div className="pointer-events-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Minimize window"
                      onClick={() => {
                        void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
                          getCurrentWindow().minimize()
                        );
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white/[0.08] hover:text-white"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Close window"
                      onClick={() => {
                        void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
                          getCurrentWindow().close()
                        );
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-rose-500/20 hover:text-rose-200"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <div className="pointer-events-none mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                <span>Patch {patchVersion}</span>
                <span>·</span>
                <span className="capitalize">
                  {runtimeState.phase.replace('_', ' ')}
                </span>
              </div>
            </div>

            <nav aria-label="Primary navigation" className="space-y-1">
              {NAV_ITEMS.map((tab) => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-xs font-medium transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="lg-segment-active absolute inset-0 rounded-[10px]"
                      />
                    )}
                    <Icon className="relative z-10 h-3.5 w-3.5 shrink-0" />
                    <span className="relative z-10 truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="space-y-2.5 border-t border-white/[0.08] pt-3.5 text-[11px]">
            <div className="space-y-1.5 px-2 text-slate-400">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.lcuConnected ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  League Client
                </span>
                <span className="text-[10px] text-slate-500">
                  {runtimeState.lcuConnected ? 'Ready' : 'Standby'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.liveClientConnected ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  Live Match
                </span>
                <span className="text-[10px] text-slate-500">
                  {runtimeState.liveClientConnected ? 'Active' : 'Standby'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => void toggleOverlayMode('compact')}
                className="lg-btn-glass flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-200"
              >
                <span>Compact HUD</span>
                <kbd className="font-mono text-[10px] text-slate-400">
                  {settings.overlayHotkey}
                </kbd>
              </button>

              <button
                ref={simButtonRef}
                type="button"
                aria-expanded={simulatorOpen}
                onClick={() => setSimulatorOpen((v) => !v)}
                className={`lg-btn-glass flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium ${
                  demoScenario !== 'idle' ? 'text-amber-200' : 'text-slate-300'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3 w-3" />
                  Simulator
                </span>
                <kbd className="font-mono text-[10px] text-slate-400">Ctrl+K</kbd>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace Canvas */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Simulator Popover (Hidden until triggered or Ctrl+K) */}
          {simulatorOpen && (
            <div
              ref={simPopoverRef}
              role="dialog"
              aria-label="Scenario Simulator"
              className="mat-glass mat-lens absolute top-4 right-6 z-30 w-72 p-3.5 text-xs"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="t-micro text-slate-300">Scenario Simulator</span>
                <button
                  type="button"
                  onClick={() => setSimulatorOpen(false)}
                  className="text-[11px] text-slate-400 hover:text-white"
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
                className="w-full rounded-lg border border-white/15 bg-black/70 px-2.5 py-2 text-xs text-slate-100 outline-none"
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
          <div key={activeTab} className="lg-view-enter">
            {activeTab === 'champ_select' && (
              <ChampSelectView
                session={runtimeState.champSelect ?? (demoScenario !== 'idle' ? DEMO_CHAMP_SELECT : null)}
                patchVersion={patchVersion}
                summonerProfile={effectiveProfile}
                highEloMeta={highEloMeta}
              />
            )}
            {activeTab === 'win_plan' && (
              <WinConditionView
                plan={winPlan}
                mapSide={resolvedMapSide}
                championName={playerChampionName}
                patchVersion={patchVersion}
                aiConfig={settings.aiCoach}
              />
            )}
            {activeTab === 'live_coach' && (
              <LiveCoachView
                liveData={runtimeState.liveGame}
                objectives={objectives}
                buildPlan={buildPlan}
                macroCues={macroCues}
                winPlan={winPlan}
                mapSide={resolvedMapSide}
                patchVersion={patchVersion}
              />
            )}
            {activeTab === 'post_game' && (
              <PostGameReviewView
                matches={matches}
                targetDivision={settings.targetDivision}
                patchVersion={patchVersion}
                aiConfig={settings.aiCoach}
                canSyncLive={canSyncLive}
                onSyncMatches={handleSyncMatches}
              />
            )}
            {activeTab === 'climb_goals' && (
              <ClimbLadderView
                summonerProfile={effectiveProfile}
                targetDivision={settings.targetDivision}
                summaries={rollingSummaries}
                matches={matches}
                lpHistory={lpHistory}
                patchVersion={patchVersion}
                goals={climbGoals}
                highEloMeta={highEloMeta}
                canSyncLive={canSyncLive}
                onUpsertGoal={handleUpsertGoal}
                onDeleteGoal={handleDeleteGoal}
                onRefreshHighElo={handleRefreshHighElo}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                settings={settings}
                patchVersion={patchVersion}
                catalogCounts={catalogCounts}
                onSettingsChanged={setSettings}
                onProfileLoaded={handleProfileLoaded}
                onPatchSynced={(patch, counts) => {
                  setPatchVersion(patch);
                  if (counts) setCatalogCounts(counts);
                }}
              />
            )}
          </div>
        </main>

        {/* Mandatory Riot Games Legal Disclaimer */}
        <footer className="border-t border-white/[0.07] bg-black/25 px-6 py-2 text-[10px] leading-relaxed text-slate-500">
          <div className="flex items-center justify-between gap-2">
            <span className={legalOpen ? '' : 'truncate'}>
              BetterJungler isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
              opinions of Riot Games or anyone officially involved in producing or managing Riot
              Games properties. Riot Games, and all associated properties are trademarks or
              registered trademarks of Riot Games, Inc.
            </span>
            <button
              type="button"
              aria-expanded={legalOpen}
              onClick={() => setLegalOpen((v) => !v)}
              aria-label="Toggle legal disclaimer"
              className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white"
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
