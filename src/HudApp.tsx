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
import { generateWinConditionPlan } from './domain/winConditionEngine';
import { useInterpolatedGameTime } from './hooks/useInterpolatedGameTime';
import {
  getAppState,
  loadSettings,
  setOverlayMode,
  subscribeGameState,
  subscribeHudPreferences,
} from './services/tauriBridge';
import type { HudScalePercent } from './types/coaching';
import type { AppRuntimeState, LaneRole, LiveGameData } from './types/riot';

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

  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((s) => {
        if (!active) return;
        setOpacity(s.hudOpacity);
        setScalePercent((s.hudScale ?? 100) as HudScalePercent);
        setHotkey(s.overlayHotkey);
      })
      .catch((err) => {
        console.warn('HUD settings fallback:', err);
      });

    void getAppState()
      .then((state) => {
        if (active && state) setRuntimeState(state);
      })
      .catch((err) => {
        console.warn('HUD runtime state fetch failed:', err);
      });

    const unsubGame = subscribeGameState(
      (state) => setRuntimeState(state),
      () => {}
    );
    const unsubPrefs = subscribeHudPreferences((prefs) => {
      setOpacity(prefs.hudOpacity);
      setScalePercent((prefs.hudScale ?? 100) as HudScalePercent);
      setHotkey(prefs.overlayHotkey);
    });

    return () => {
      active = false;
      void unsubGame.then((fn) => fn());
      void unsubPrefs.then((fn) => fn());
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
      liveGameSynced.allPlayers
    );
  }, [liveGameSynced]);

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
    return computeMacroGuidance(liveGameSynced, winPlan, objectives);
  }, [liveGameSynced, winPlan, objectives]);

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
