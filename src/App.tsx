import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Activity,
  BarChart3,
  Map as MapIcon,
  Minimize2,
  Settings as SettingsIcon,
  Sparkles,
  TrendingUp,
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
  isTauriEnvironment,
  loadClimbGoals,
  loadLpHistory,
  loadSettings,
  refreshHighEloMeta,
  setOverlayMode,
  subscribeGameState,
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
      return 'items-end justify-end';
    case 'bottom-left':
      return 'items-end justify-start';
    case 'top-right':
    default:
      return 'items-start justify-end';
  }
}

function BetterJunglerPrismMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="bjPrismBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(125,211,252,0.28)" />
          <stop offset="100%" stopColor="rgba(14,165,233,0.08)" />
        </linearGradient>
        <linearGradient id="bjPrismCore" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="10"
        fill="url(#bjPrismBg)"
        stroke="rgba(186,230,253,0.35)"
        strokeWidth="1"
      />
      <path
        d="M16 6.5 L23.5 16 L16 25.5 L8.5 16 Z"
        fill="none"
        stroke="url(#bjPrismCore)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.7" fill="#e0f2fe" />
    </svg>
  );
}

export function App() {
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>('champ_select');
  const [liveState, setLiveState] = useState<AppRuntimeState | null>(null);
  const [overlayMode, setMode] = useState<OverlayMode>('expanded');
  const [activeTab, setActiveTab] = useState<ActiveTab>('champ_select');
  const [patchVersion, setPatchVersion] = useState<string>('16.1.1');
  const [catalogCounts, setCatalogCounts] = useState<{ champions: number; items: number }>({
    champions: 0,
    items: 0,
  });
  const [summonerProfile, setSummonerProfile] = useState<SummonerProfileSummary | null>(null);
  const [matches, setMatches] = useState<MatchV5Detail[]>(DEMO_POST_GAME_MATCHES);
  const [lpHistory, setLpHistory] = useState<LpHistoryPoint[]>(DEMO_LP_HISTORY);
  const [climbGoals, setClimbGoals] = useState<ClimbGoal[]>([]);
  const [highEloMeta, setHighEloMeta] = useState<HighEloMetaSnapshot | null>(
    DEMO_HIGH_ELO_SNAPSHOT
  );
  const [settings, setSettings] = useState<UserSettings>({
    riotId: '',
    region: 'EUW1',
    lolInstallPath: 'C:\\Riot Games\\League of Legends',
    overlayHotkey: 'Alt+J',
    hudCorner: 'top-right',
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

  useEffect(() => {
    let active = true;
    void loadSettings().then((s) => {
      if (active) setSettings(s);
    });
    void fetchLatestPatchVersion().then((patch) => {
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
      if (active && state) setLiveState(state);
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
        if (state.phase === 'champ_select') setActiveTab('champ_select');
        else if (state.phase === 'loading') setActiveTab('win_plan');
        else if (state.phase === 'in_game') setActiveTab('live_coach');
        else if (state.phase === 'post_game') setActiveTab('post_game');
      },
      (mode) => setMode(mode)
    );

    return () => {
      active = false;
      void unsubPromise.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (matchesHotkey(e, settings.overlayHotkey)) {
        e.preventDefault();
        setMode((prev) => {
          const next: OverlayMode = prev === 'expanded' ? 'compact' : 'expanded';
          void setOverlayMode(next);
          return next;
        });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings.overlayHotkey]);

  const runtimeState: AppRuntimeState = useMemo(() => {
    if (demoScenario !== 'idle') {
      return getDemoRuntimeState(demoScenario);
    }
    return liveState ?? getDemoRuntimeState('idle');
  }, [demoScenario, liveState]);

  const effectiveChampSelect = runtimeState.champSelect ?? DEMO_LOADING_CHAMP_SELECT;

  const winPlan = useMemo(() => {
    const allyRoles = extractRoleMap(effectiveChampSelect.myTeam);
    const enemyRoles = extractRoleMap(effectiveChampSelect.theirTeam);
    const playerSlot = effectiveChampSelect.myTeam.find((s) => s.isLocalPlayer);
    const playerChampId =
      playerSlot?.championId && playerSlot.championId > 0 ? playerSlot.championId : 234;
    return generateWinConditionPlan({
      allyRoles,
      enemyRoles,
      playerChampionId: playerChampId,
      mapSide: effectiveChampSelect.mapSide,
    });
  }, [effectiveChampSelect]);

  const playerChampionName = useMemo(() => {
    const activePlayerName = runtimeState.liveGame?.activePlayer.summonerName;
    const liveSelf = runtimeState.liveGame?.allPlayers.find(
      (p) => p.summonerName === activePlayerName
    );
    if (liveSelf) return liveSelf.championName;
    const slot = effectiveChampSelect.myTeam.find((s) => s.isLocalPlayer);
    if (slot && slot.championId > 0) {
      return findJungleChampionById(slot.championId)?.name ?? 'Jungler';
    }
    return 'Viego';
  }, [effectiveChampSelect, runtimeState.liveGame]);

  const objectives = useMemo(() => {
    if (!runtimeState.liveGame) return [];
    return computeObjectiveWindows(
      runtimeState.liveGame.gameData.gameTime,
      runtimeState.liveGame.events.Events
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
    if (demoScenario !== 'idle' || matches === DEMO_POST_GAME_MATCHES) {
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
    const snap = await refreshHighEloMeta(settings.region, 10);
    setHighEloMeta(snap);
  }

  const isTauri = isTauriEnvironment();
  const hudStyle = {
    '--hud-alpha': String(Math.max(0.5, Math.min(1, settings.hudOpacity / 100))),
  } as CSSProperties;

  const hasUrgentObjective = objectives.some(
    (o) => o.status === 'live' || o.status === 'prep_vision'
  );

  if (overlayMode === 'compact') {
    return (
      <div
        style={hudStyle}
        className={`flex min-h-full p-4 ${isTauri ? '' : 'lg-canvas-browser'} ${cornerAlignmentClasses(settings.hudCorner)}`}
      >
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
    );
  }

  const canSyncLive = isTauri && settings.hasApiKey;

  return (
    <div
      style={hudStyle}
      className={`flex min-h-full items-center justify-center p-4 ${isTauri ? '' : 'lg-canvas-browser'}`}
    >
      <div
        data-phase={runtimeState.phase}
        data-urgent={hasUrgentObjective ? 'true' : 'false'}
        className="lg-shell flex max-h-[94vh] w-full max-w-[1060px] flex-col overflow-hidden text-slate-100"
      >
        {/* Top Liquid Glass Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <BetterJunglerPrismMark />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[13px] font-bold tracking-[0.1em] text-slate-50">
                  BETTERJUNGLER
                </h1>
                <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                  Patch {patchVersion}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-300">
                  {runtimeState.phase.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.lcuConnected ? 'bg-emerald-400' : 'bg-slate-500'
                    }`}
                  />
                  LCU {runtimeState.lcuConnected ? 'Connected' : 'Standby'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      runtimeState.liveClientConnected ? 'bg-emerald-400' : 'bg-slate-500'
                    }`}
                  />
                  Live API {runtimeState.liveClientConnected ? 'Active' : 'Standby'}
                </span>
                <span className="hidden sm:inline text-slate-500">
                  • {settings.overlayHotkey} ({settings.hudCorner})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Simulation scenario"
              value={demoScenario}
              onChange={(e) => handleScenarioChange(e.target.value as DemoScenarioId)}
              className="lg-btn-glass cursor-pointer px-3 py-1.5 text-xs font-medium text-slate-100 outline-none"
            >
              {DEMO_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} className="bg-slate-900 text-slate-100">
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void toggleOverlayMode('compact')}
              className="lg-btn-glass inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-100"
            >
              <Minimize2 className="h-3.5 w-3.5 text-sky-300" />
              Compact HUD
            </button>
          </div>
        </header>

        {/* Floating Liquid Glass Segmented Navigation Rail */}
        <div className="px-5 pb-3">
          <nav className="lg-segmented flex flex-wrap items-center gap-1">
            {(
              [
                { id: 'champ_select', label: 'Champ Select', icon: Sparkles },
                { id: 'win_plan', label: 'Win Plan & Map', icon: MapIcon },
                { id: 'live_coach', label: 'Live Coach', icon: Activity },
                { id: 'post_game', label: 'Post-Game Review', icon: BarChart3 },
                { id: 'climb_goals', label: 'Climb & Goals', icon: TrendingUp },
                { id: 'settings', label: 'Settings', icon: SettingsIcon },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                    active
                      ? 'lg-segment-active'
                      : 'border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? 'text-sky-300' : ''}`} />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Scrollable Content with Spring Entrance */}
        <main className="hud-scroll flex-1 overflow-y-auto px-5 pb-4">
          <div key={activeTab} className="lg-view-enter">
            {activeTab === 'champ_select' && (
              <ChampSelectView
                session={runtimeState.champSelect ?? DEMO_CHAMP_SELECT}
                patchVersion={patchVersion}
                summonerProfile={effectiveProfile}
                highEloMeta={highEloMeta}
              />
            )}
            {activeTab === 'win_plan' && (
              <WinConditionView
                plan={winPlan}
                mapSide={effectiveChampSelect.mapSide}
                championName={playerChampionName}
                aiConfig={settings.aiCoach}
              />
            )}
            {activeTab === 'live_coach' && (
              <LiveCoachView
                liveData={runtimeState.liveGame}
                objectives={objectives}
                buildPlan={buildPlan}
                macroCues={macroCues}
                patchVersion={patchVersion}
              />
            )}
            {activeTab === 'post_game' && (
              <PostGameReviewView
                matches={matches}
                targetDivision={settings.targetDivision}
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
                onProfileLoaded={setSummonerProfile}
                onPatchSynced={(patch, counts) => {
                  setPatchVersion(patch);
                  if (counts) setCatalogCounts(counts);
                }}
              />
            )}
          </div>
        </main>

        {/* Mandatory Riot Games Legal Disclaimer */}
        <footer className="border-t border-white/[0.06] bg-black/25 px-5 py-2 text-[10px] leading-relaxed text-slate-400">
          BetterJungler isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or
          opinions of Riot Games or anyone officially involved in producing or managing Riot Games
          properties. Riot Games, and all associated properties are trademarks or registered
          trademarks of Riot Games, Inc.
        </footer>
      </div>
    </div>
  );
}

export default App;
