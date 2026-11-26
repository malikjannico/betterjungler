import type { OverlayMode, RunePageSpec, UserSettings } from '../types/coaching';
import type { AppRuntimeState, SummonerProfileSummary } from '../types/riot';

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
};

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
    const raw = localStorage.getItem('betterjungler_settings');
    if (raw) {
      try {
        return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) };
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
    localStorage.setItem('betterjungler_settings', JSON.stringify(settings));
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

export async function fetchSummonerProfile(
  riotId: string,
  region: string
): Promise<SummonerProfileSummary> {
  if (!isTauriEnvironment()) {
    throw new Error('Live Riot Web API lookup requires running the Tauri desktop app with your saved API key.');
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
