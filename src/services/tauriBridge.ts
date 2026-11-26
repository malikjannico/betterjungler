import {
  DEMO_HIGH_ELO_SNAPSHOT,
  DEMO_POST_GAME_MATCHES,
} from '../domain/postGameFixtures';
import type {
  ClimbGoal,
  HighEloMetaSnapshot,
  OverlayMode,
  RunePageSpec,
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
  hudOpacity: 92,
  targetDivision: 'PLATINUM IV',
  hasApiKey: false,
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
  return invoke<T>(cmd, args);
}

export async function getAppState(): Promise<AppRuntimeState | null> {
  if (!isTauriEnvironment()) return null;
  return invokeTauri<AppRuntimeState>('get_app_state');
}

export async function setOverlayMode(mode: OverlayMode): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('set_overlay_mode', { mode });
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
  region: string
): Promise<SummonerProfileSummary> {
  if (!isTauriEnvironment()) {
    throw new Error(
      'Live Riot Web API lookup requires running the Tauri desktop app with your saved API key.'
    );
  }
  return invokeTauri<SummonerProfileSummary>('fetch_summoner_profile', {
    riotId,
    region,
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
    return DEMO_POST_GAME_MATCHES;
  }
  return invokeTauri<MatchV5Detail[]>('sync_recent_matches', {
    puuid,
    region,
    count,
  });
}

export async function getCachedMatches(): Promise<MatchV5Detail[]> {
  if (!isTauriEnvironment()) {
    return DEMO_POST_GAME_MATCHES;
  }
  return invokeTauri<MatchV5Detail[]>('get_cached_matches');
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

export async function getCachedMetaSnapshot(): Promise<HighEloMetaSnapshot | null> {
  if (!isTauriEnvironment()) {
    return DEMO_HIGH_ELO_SNAPSHOT;
  }
  return invokeTauri<HighEloMetaSnapshot | null>('get_cached_meta_snapshot');
}

export async function refreshHighEloMeta(
  region: string,
  maxMatches = 10
): Promise<HighEloMetaSnapshot> {
  if (!isTauriEnvironment()) {
    return {
      ...DEMO_HIGH_ELO_SNAPSHOT,
      region: region.toUpperCase(),
      updatedAt: new Date().toISOString(),
    };
  }
  return invokeTauri<HighEloMetaSnapshot>('refresh_high_elo_meta', {
    region,
    maxMatches,
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
