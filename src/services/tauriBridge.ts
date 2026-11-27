import pkg from '../../package.json';
import type {
  ApiKeyHealthStatus,
  AppMetaInfo,
  ClimbGoal,
  HighEloMetaSnapshot,
  HudCorner,
  HudMonitorTarget,
  HudScalePercent,
  LpHistoryPoint,
  MinimapSide,
  OverlayMode,
  RunePageSpec,
  UpdateCheckResult,
  UserSettings,
} from '../types/coaching';
import type {
  AppRuntimeState,
  MatchV5Detail,
  SummonerProfileSummary,
} from '../types/riot';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

const DEFAULT_SETTINGS: UserSettings = {
  riotId: '',
  region: 'EUW1',
  lolInstallPath: 'C:\\Riot Games\\League of Legends',
  overlayHotkey: 'Alt+J',
  hudCorner: 'beside-minimap',
  hudOpacity: 80,
  hudScale: 100,
  hudMonitor: 'primary',
  minimapSide: 'right',
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
};

const GOALS_STORAGE_KEY = 'betterjungler_climb_goals_v2';
const SETTINGS_STORAGE_KEY = 'betterjungler_settings';

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (err instanceof Error) throw err;
    const message =
      typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : JSON.stringify(err);
    throw new Error(message || `Tauri command failed: ${cmd}`);
  }
}

export async function getAppState(): Promise<AppRuntimeState | null> {
  if (!isTauriEnvironment()) return null;
  return invokeTauri<AppRuntimeState>('get_app_state');
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('set_overlay_mode', { mode });
}

export async function updateOverlayPreferences(
  hudCorner: HudCorner,
  overlayHotkey: string,
  extra?: {
    hudOpacity?: number;
    hudScale?: HudScalePercent;
    hudMonitor?: HudMonitorTarget;
    minimapSide?: MinimapSide;
  }
): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('update_overlay_preferences', {
    hudCorner,
    overlayHotkey,
    hudOpacity: extra?.hudOpacity ?? null,
    hudScale: extra?.hudScale ?? null,
    hudMonitor: extra?.hudMonitor ?? null,
    minimapSide: extra?.minimapSide ?? null,
  });
}

export interface HudPreferencesEvent {
  hudCorner: HudCorner;
  overlayHotkey: string;
  hudOpacity: number;
  hudScale: HudScalePercent;
  hudMonitor: HudMonitorTarget;
  minimapSide: MinimapSide;
}

export async function subscribeHudPreferences(
  onPrefs: (prefs: HudPreferencesEvent) => void
): Promise<() => void> {
  if (!isTauriEnvironment()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<HudPreferencesEvent>('hud-preferences-changed', (e) => {
    onPrefs(e.payload);
  });
  return () => {
    unlisten();
  };
}

export async function loadLpHistory(): Promise<LpHistoryPoint[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invokeTauri<LpHistoryPoint[]>('get_lp_history');
}

export async function getLcuProfile(region: string): Promise<SummonerProfileSummary> {
  if (!isTauriEnvironment()) {
    throw new Error('LCU profile lookup requires running the Tauri desktop app.');
  }
  return invokeTauri<SummonerProfileSummary>('get_lcu_profile', { region });
}

export async function applyRunesAndSpells(
  runes: RunePageSpec,
  spell1Id: number,
  spell2Id: number
): Promise<{ success: boolean; message: string }> {
  if (!isTauriEnvironment()) {
    return {
      success: true,
      message: `Demo Mode: Would apply "${runes.name}" + Smite & secondary spell via LCU.`,
    };
  }
  return invokeTauri<{ success: boolean; message: string }>('apply_runes_and_spells', {
    runes,
    spell1Id,
    spell2Id,
  });
}

export async function loadSettings(): Promise<UserSettings> {
  if (!isTauriEnvironment()) {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<UserSettings>;
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          aiCoach: {
            ...DEFAULT_SETTINGS.aiCoach,
            ...(parsed.aiCoach ?? {}),
          },
        };
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  }
  return invokeTauri<UserSettings>('get_settings');
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  if (!isTauriEnvironment()) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return;
  }
  await invokeTauri<void>('save_settings', { settings });
}

export async function saveRiotApiKey(apiKey: string): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return apiKey.trim().length > 0;
  }
  return invokeTauri<boolean>('save_riot_api_key', { apiKey });
}

export async function saveAiApiKey(apiKey: string): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return apiKey.trim().length > 0;
  }
  return invokeTauri<boolean>('save_ai_api_key', { apiKey });
}

export async function fetchSummonerProfile(
  riotId: string,
  region: string,
  recentWin?: boolean,
  matchId?: string
): Promise<SummonerProfileSummary> {
  if (!isTauriEnvironment()) {
    throw new Error(
      'Live Riot Web API lookup requires running the Tauri desktop app with your saved API key.'
    );
  }
  return invokeTauri<SummonerProfileSummary>('fetch_summoner_profile', {
    riotId,
    region,
    recentWin: recentWin ?? null,
    matchId: matchId ?? null,
  });
}

export async function syncDdragonPatch(): Promise<string> {
  if (!isTauriEnvironment()) {
    return '16.1.1';
  }
  return invokeTauri<string>('sync_ddragon');
}

export async function syncRecentMatches(
  puuid: string,
  region: string,
  count = 8
): Promise<MatchV5Detail[]> {
  if (!isTauriEnvironment()) {
    const { DEMO_POST_GAME_MATCHES } = await import('../domain/postGameFixtures');
    return DEMO_POST_GAME_MATCHES;
  }
  return invokeTauri<MatchV5Detail[]>('sync_recent_matches', {
    puuid,
    region,
    count,
  });
}

export async function getCachedMatches(puuid?: string): Promise<MatchV5Detail[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invokeTauri<MatchV5Detail[]>('get_cached_matches', {
    puuid: puuid ?? null,
  });
}

export async function loadClimbGoals(): Promise<ClimbGoal[]> {
  if (!isTauriEnvironment()) {
    const raw = localStorage.getItem(GOALS_STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ClimbGoal[];
    } catch {
      return [];
    }
  }
  return invokeTauri<ClimbGoal[]>('get_climb_goals');
}

export async function upsertClimbGoal(goal: ClimbGoal): Promise<void> {
  if (!isTauriEnvironment()) {
    const existing = await loadClimbGoals();
    const filtered = existing.filter((g) => g.id !== goal.id);
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify([goal, ...filtered]));
    return;
  }
  await invokeTauri<void>('upsert_climb_goal', { goal });
}

export async function deleteClimbGoal(goalId: string): Promise<void> {
  if (!isTauriEnvironment()) {
    const existing = await loadClimbGoals();
    localStorage.setItem(
      GOALS_STORAGE_KEY,
      JSON.stringify(existing.filter((g) => g.id !== goalId))
    );
    return;
  }
  await invokeTauri<void>('delete_climb_goal', { goalId });
}

export async function setFocusGoal(goalId: string): Promise<ClimbGoal[]> {
  if (!isTauriEnvironment()) {
    const { setSingleFocusGoal } = await import('../domain/climbLadderEngine');
    const existing = await loadClimbGoals();
    const updated = setSingleFocusGoal(existing, goalId);
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }
  return invokeTauri<ClimbGoal[]>('set_focus_goal', { goalId });
}

export async function getCachedMetaSnapshot(): Promise<HighEloMetaSnapshot | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  return invokeTauri<HighEloMetaSnapshot | null>('get_cached_meta_snapshot');
}

export async function refreshHighEloMeta(
  region: string,
  maxMatches = 10,
  patch?: string
): Promise<HighEloMetaSnapshot> {
  if (!isTauriEnvironment()) {
    const { DEMO_HIGH_ELO_SNAPSHOT } = await import('../domain/postGameFixtures');
    return {
      ...DEMO_HIGH_ELO_SNAPSHOT,
      region: region.toUpperCase(),
      updatedAt: new Date().toISOString(),
    };
  }
  return invokeTauri<HighEloMetaSnapshot>('refresh_high_elo_meta', {
    region,
    maxMatches,
    patch: patch ?? null,
  });
}

export async function generateAiDebrief(context: string): Promise<string> {
  if (!isTauriEnvironment()) {
    throw new Error('DEMO_FALLBACK');
  }
  return invokeTauri<string>('generate_ai_debrief', { context });
}

export async function subscribeGameState(
  onUpdate: (state: AppRuntimeState) => void,
  onToggleMode: (mode: OverlayMode) => void
): Promise<() => void> {
  if (!isTauriEnvironment()) {
    return () => {};
  }
  const { listen } = await import('@tauri-apps/api/event');
  const unlistenState = await listen<AppRuntimeState>('game-state-updated', (e) => {
    onUpdate(e.payload);
  });
  const unlistenMode = await listen<OverlayMode>('overlay-mode-changed', (e) => {
    onToggleMode(e.payload);
  });
  return () => {
    unlistenState();
    unlistenMode();
  };
}

export async function checkRiotApiKeyHealth(
  region: string
): Promise<ApiKeyHealthStatus> {
  if (!isTauriEnvironment()) {
    return {
      status: 'missing',
      message: 'Browser demo mode — personal Riot API keys run inside the Windows app.',
      checkedAt: new Date().toISOString(),
    };
  }
  return invokeTauri<ApiKeyHealthStatus>('check_riot_api_key_health', { region });
}

export async function getAppMeta(): Promise<AppMetaInfo> {
  if (!isTauriEnvironment()) {
    return {
      version: pkg.version,
      commitSha: 'local',
      logDir: '%LOCALAPPDATA%\\dev.betterjungler.app\\logs',
    };
  }
  return invokeTauri<AppMetaInfo>('get_app_meta');
}

export async function openLogsFolder(): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('open_logs_folder');
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriEnvironment()) {
    return {
      available: false,
      currentVersion: pkg.version,
    };
  }
  return invokeTauri<UpdateCheckResult>('check_update');
}

export async function installAppUpdate(): Promise<string> {
  if (!isTauriEnvironment()) {
    return 'Demo mode: updates install inside the Windows desktop app.';
  }
  return invokeTauri<string>('install_update');
}

export async function stageAppUpdate(): Promise<string> {
  if (!isTauriEnvironment()) {
    return pkg.version;
  }
  return invokeTauri<string>('stage_update');
}
