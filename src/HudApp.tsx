import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CompactHudBar } from './components/CompactHudBar';
import { findChampionIdByName, findJungleChampionByName } from './data/jungleKnowledgePack';
import {
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  resolveSelfPlayer,
} from './domain/liveCoachEngine';
import { computePersonalLearningSnapshot } from './domain/personalLearningEngine';
import { generateWinConditionPlan } from './domain/winConditionEngine';
import { useInterpolatedGameTime } from './hooks/useInterpolatedGameTime';
import {
  getActivePatchPack,
  getAppState,
  getCachedMatches,
  getPersonalLearningSnapshot,
  loadSettings,
  setOverlayMode,
  subscribeGameState,
  subscribeHudPreferences,
  subscribePatchPackUpdated,
} from './services/tauriBridge';
import type {
  ActivePatchPackStatus,
  HudScalePercent,
  SqlPersonalLearningSummary,
} from './types/coaching';
import type { AppRuntimeState, LaneRole, LiveGameData, MatchV5Detail } from './types/riot';

const IDLE_RUNTIME_STATE: AppRuntimeState = {
  phase: 'idle',
  gameflowPhase: 'Unknown',
  canInstallUpdate: false,
  lcuConnected: false,
  liveClientConnected: false,
  champSelect: null,
  liveGame: null,
  summonerProfile: null,
  patchVersion: '16.23.1',
};

function extractRoleMap(
  slots: NonNullable<AppRuntimeState['champSelect']>['myTeam']
): Partial<Record<LaneRole, number>> {
  const map: Partial<Record<LaneRole, number>> = {};
  for (const s of slots) {
    if (s.assignedPosition !== 'unknown' && s.championId > 0) {
      map[s.assignedPosition] = s.championId;
    }
  }
  return map;
}

function extractLiveRoles(
  liveGame: LiveGameData,
  allyTeam: 'ORDER' | 'CHAOS'
): {
  allyRoles: Partial<Record<LaneRole, number>>;
  enemyRoles: Partial<Record<LaneRole, number>>;
} {
  const allyRoles: Partial<Record<LaneRole, number>> = {};
  const enemyRoles: Partial<Record<LaneRole, number>> = {};
  const roleMap: Record<string, LaneRole> = {
    TOP: 'top',
    JUNGLE: 'jungle',
    MIDDLE: 'middle',
    MID: 'middle',
    BOTTOM: 'bottom',
    BOT: 'bottom',
    UTILITY: 'utility',
    SUPPORT: 'utility',
  };
  for (const p of liveGame.allPlayers) {
    const role = roleMap[p.position.trim().toUpperCase()];
    const id = role ? findChampionIdByName(p.championName) : undefined;
    if (!role || !id) continue;
    if (p.team === allyTeam) allyRoles[role] = id;
    else enemyRoles[role] = id;
  }
  return { allyRoles, enemyRoles };
}

export function HudApp() {
  const [runtimeState, setRuntimeState] = useState<AppRuntimeState>(IDLE_RUNTIME_STATE);
  const [opacity, setOpacity] = useState(80);
  const [scalePercent, setScalePercent] = useState<HudScalePercent>(100);
  const [hotkey, setHotkey] = useState('Alt+J');
  const [targetDivision, setTargetDivision] = useState('PLATINUM IV');
  const [patchPackStatus, setPatchPackStatus] = useState<ActivePatchPackStatus | null>(null);
  const [cachedMatches, setCachedMatches] = useState<MatchV5Detail[]>([]);
  const [sqlPersonalLearning, setSqlPersonalLearning] = useState<SqlPersonalLearningSummary | null>(
    null
  );

  useEffect(() => {
    let active = true;
    let lastPhase = '';
    let lastPuuid = '';
    const refreshPersonalAndPack = (puuid?: string | null) => {
      void getActivePatchPack()
        .then((pack) => {
          if (active && pack) setPatchPackStatus(pack);
        })
        .catch(() => {});
      void getCachedMatches(puuid ?? undefined)
        .then((matches) => {
          if (active) setCachedMatches(matches);
        })
        .catch(() => {});
      void getPersonalLearningSnapshot(puuid ?? null)
        .then((snap) => {
          if (active) setSqlPersonalLearning(snap.jungleMatchCount > 0 ? snap : null);
        })
        .catch(() => {});
    };

    void loadSettings()
      .then((s) => {
        if (!active) return;
        setOpacity(s.hudOpacity);
        setScalePercent((s.hudScale ?? 100) as HudScalePercent);
        setHotkey(s.overlayHotkey);
        setTargetDivision(s.targetDivision);
      })
      .catch((err) => {
        console.warn('HUD settings fallback:', err);
      });

    void getAppState()
      .then((state) => {
        if (!active || !state) return;
        setRuntimeState(state);
        lastPhase = state.phase;
        lastPuuid = state.summonerProfile?.puuid ?? '';
        refreshPersonalAndPack(state.summonerProfile?.puuid);
      })
      .catch((err) => {
        console.warn('HUD runtime state fetch failed:', err);
      });

    const unsubGame = subscribeGameState(
      (state) => {
        setRuntimeState(state);
        const nextPuuid = state.summonerProfile?.puuid ?? '';
        const enteredMatchPhase =
          (state.phase === 'in_game' || state.phase === 'loading') && state.phase !== lastPhase;
        const accountChanged = nextPuuid !== '' && nextPuuid !== lastPuuid;
        lastPhase = state.phase;
        if (nextPuuid) {
          lastPuuid = nextPuuid;
        }
        if (enteredMatchPhase || accountChanged) {
          refreshPersonalAndPack(nextPuuid || null);
        }
      },
      () => {}
    );
    const unsubPrefs = subscribeHudPreferences((prefs) => {
      setOpacity(prefs.hudOpacity);
      setScalePercent((prefs.hudScale ?? 100) as HudScalePercent);
      setHotkey(prefs.overlayHotkey);
    });
    const unsubPatchPack = subscribePatchPackUpdated((pack) => {
      if (active) setPatchPackStatus(pack);
    });

    return () => {
      active = false;
      void unsubGame.then((fn) => fn());
      void unsubPrefs.then((fn) => fn());
      void unsubPatchPack.then((fn) => fn());
    };
  }, []);

  const interpolatedTime = useInterpolatedGameTime(
    runtimeState.liveGame?.gameData.gameTime ?? 0,
    runtimeState.phase === 'in_game' && Boolean(runtimeState.liveGame)
  );

  const liveGameSynced = useMemo(
    () =>
      runtimeState.liveGame
        ? {
            ...runtimeState.liveGame,
            gameData: { ...runtimeState.liveGame.gameData, gameTime: interpolatedTime },
          }
        : null,
    [runtimeState.liveGame, interpolatedTime]
  );

  const objectives = useMemo(() => {
    if (!liveGameSynced) return [];
    return computeObjectiveWindows(
      liveGameSynced.gameData.gameTime,
      liveGameSynced.events.Events,
      liveGameSynced.allPlayers,
      patchPackStatus?.payload.objectiveTimings
    );
  }, [liveGameSynced, patchPackStatus]);

  const personalLearning = useMemo(
    () =>
      computePersonalLearningSnapshot(
        cachedMatches,
        cachedMatches,
        targetDivision,
        sqlPersonalLearning
      ),
    [cachedMatches, targetDivision, sqlPersonalLearning]
  );

  const winPlan = useMemo(() => {
    if (runtimeState.phase !== 'loading' && runtimeState.phase !== 'in_game') {
      return null;
    }
    const cs = runtimeState.champSelect;
    const selfLive = runtimeState.liveGame ? resolveSelfPlayer(runtimeState.liveGame) : null;
    const slot = cs?.myTeam.find((s) => s.isLocalPlayer);
    const playerChampionId =
      (selfLive ? findChampionIdByName(selfLive.championName) : undefined) ??
      (slot?.championId && slot.championId > 0 ? slot.championId : null);

    const liveRoles =
      runtimeState.liveGame && selfLive
        ? extractLiveRoles(runtimeState.liveGame, selfLive.team)
        : null;
    const csAllyRoles = cs ? extractRoleMap(cs.myTeam) : {};
    const csEnemyRoles = cs ? extractRoleMap(cs.theirTeam) : {};
    const allyRoles =
      Object.keys(csAllyRoles).length > 0 ? csAllyRoles : (liveRoles?.allyRoles ?? {});
    const enemyRoles =
      Object.keys(csEnemyRoles).length > 0 ? csEnemyRoles : (liveRoles?.enemyRoles ?? {});
    const hasPlayer = Boolean(selfLive || playerChampionId);

    if (
      !hasPlayer ||
      (Object.keys(allyRoles).length === 0 && Object.keys(enemyRoles).length === 0)
    ) {
      return null;
    }
    const mapSide = cs?.mapSide ?? (selfLive?.team === 'CHAOS' ? 'red' : 'blue');
    return generateWinConditionPlan({
      allyRoles,
      enemyRoles,
      playerChampionId: playerChampionId ?? 0,
      mapSide,
    });
  }, [runtimeState.champSelect, runtimeState.liveGame, runtimeState.phase]);

  const buildPlan = useMemo(() => {
    if (!runtimeState.liveGame) return null;
    const selfLive = resolveSelfPlayer(runtimeState.liveGame);
    const profile = selfLive ? findJungleChampionByName(selfLive.championName) : undefined;
    return computeAdaptiveBuild(runtimeState.liveGame, profile);
  }, [runtimeState.liveGame]);

  const macroCues = useMemo(() => {
    if (!liveGameSynced) return [];
    return computeMacroGuidance(liveGameSynced, winPlan, objectives, personalLearning);
  }, [liveGameSynced, winPlan, objectives, personalLearning]);

  const hudStyle = {
    '--hud-alpha': String(Math.max(0.7, Math.min(1, opacity / 100))),
  } as CSSProperties;

  return (
    <div style={hudStyle} className="h-screen w-screen bg-transparent p-0">
      <CompactHudBar
        phase={runtimeState.phase}
        gameTime={interpolatedTime}
        objectives={objectives}
        buildPlan={buildPlan}
        topCue={macroCues[0] ?? null}
        openingRoute={winPlan?.routes[0] ?? null}
        patchVersion={runtimeState.patchVersion}
        hotkey={hotkey}
        scalePercent={scalePercent}
        clickThrough
        onExpand={() => void setOverlayMode('expanded')}
      />
    </div>
  );
}
