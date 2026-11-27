import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CompactHudBar } from './components/CompactHudBar';
import { findJungleChampionById, findJungleChampionByName } from './data/jungleKnowledgePack';
import {
  computeAdaptiveBuild,
  computeMacroGuidance,
  computeObjectiveWindows,
  resolveSelfPlayer,
} from './domain/liveCoachEngine';
import { generateWinConditionPlan } from './domain/winConditionEngine';
import {
  getAppState,
  loadSettings,
  setOverlayMode,
  subscribeGameState,
  subscribeHudPreferences,
} from './services/tauriBridge';
import type { HudScalePercent } from './types/coaching';
import type { AppRuntimeState, LaneRole } from './types/riot';

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

export function HudApp() {
  const [runtimeState, setRuntimeState] = useState<AppRuntimeState>(IDLE_RUNTIME_STATE);
  const [opacity, setOpacity] = useState(92);
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

  const objectives = useMemo(() => {
    if (!runtimeState.liveGame) return [];
    return computeObjectiveWindows(
      runtimeState.liveGame.gameData.gameTime,
      runtimeState.liveGame.events.Events,
      runtimeState.liveGame.allPlayers
    );
  }, [runtimeState.liveGame]);

  const winPlan = useMemo(() => {
    const cs = runtimeState.champSelect;
    const allyRoles = cs ? extractRoleMap(cs.myTeam) : {};
    const enemyRoles = cs ? extractRoleMap(cs.theirTeam) : {};
    const selfLive = runtimeState.liveGame ? resolveSelfPlayer(runtimeState.liveGame) : null;
    const liveProfile = selfLive ? findJungleChampionByName(selfLive.championName) : undefined;
    const slot = cs?.myTeam.find((s) => s.isLocalPlayer);
    const playerChampionId =
      liveProfile?.championId ?? (slot?.championId && slot.championId > 0 ? slot.championId : 234);
    const mapSide =
      cs?.mapSide ?? (selfLive?.team === 'CHAOS' ? 'red' : 'blue');
    return generateWinConditionPlan({
      allyRoles,
      enemyRoles,
      playerChampionId,
      mapSide,
    });
  }, [runtimeState.champSelect, runtimeState.liveGame]);

  const buildPlan = useMemo(() => {
    if (!runtimeState.liveGame) return null;
    const selfLive = resolveSelfPlayer(runtimeState.liveGame);
    const profile =
      (selfLive && findJungleChampionByName(selfLive.championName)) ??
      findJungleChampionById(234);
    return computeAdaptiveBuild(runtimeState.liveGame, profile);
  }, [runtimeState.liveGame]);

  const macroCues = useMemo(() => {
    if (!runtimeState.liveGame) return [];
    return computeMacroGuidance(runtimeState.liveGame, winPlan, objectives);
  }, [runtimeState.liveGame, winPlan, objectives]);

  const hudStyle = {
    '--hud-alpha': String(Math.max(0.5, Math.min(1, opacity / 100))),
  } as CSSProperties;

  return (
    <div style={hudStyle} className="h-screen w-screen bg-transparent p-0">
      <CompactHudBar
        phase={runtimeState.phase}
        gameTime={runtimeState.liveGame?.gameData.gameTime ?? 0}
        objectives={objectives}
        buildPlan={buildPlan}
        topCue={macroCues[0] ?? null}
        hotkey={hotkey}
        scalePercent={scalePercent}
        clickThrough
        onExpand={() => void setOverlayMode('expanded')}
      />
    </div>
  );
}
