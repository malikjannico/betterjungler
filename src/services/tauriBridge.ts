import pkg from '../../package.json';
import type {
  ActivePatchPackStatus,
  AiProvider,
  ApiKeyHealthStatus,
  AppMetaInfo,
  ClimbGoal,
  GameCfgReplayStatus,
  HardwareEncoderStatus,
  HighEloMetaSnapshot,
  HudCorner,
  HudMonitorTarget,
  HudScalePercent,
  LpHistoryPoint,
  MatchRecordingBundle,
  MinimapSide,
  OverlayMode,
  RecordingClipRecord,
  RecordingRecord,
  RecordingRuntimeStatus,
  RecordingSettings,
  ReplaySeekResult,
  RunePageSpec,
  SqlPersonalLearningSummary,
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

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  enabled: false,
  preset: '720p30',
  maxStorageGb: 5,
  keepLastNGames: 10,
  autoRecordRanked: true,
  replayApiEnabled: false,
};

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
    model: 'gemini-3.8-flash',
    endpoint: 'http://127.0.0.1:11434',
    hasApiKey: false,
  },
  recording: DEFAULT_RECORDING_SETTINGS,
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

export async function subscribePatchPackUpdated(
  onUpdate: (pack: ActivePatchPackStatus) => void
): Promise<() => void> {
  if (!isTauriEnvironment()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<ActivePatchPackStatus>('patch-pack-updated', (e) => {
    onUpdate(e.payload);
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
          recording: {
            ...DEFAULT_RECORDING_SETTINGS,
            ...(parsed.recording ?? {}),
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

export async function testAiConnection(
  provider: AiProvider,
  model: string,
  endpoint: string
): Promise<string> {
  if (!isTauriEnvironment()) {
    return 'Demo Mode: AI Coach connection test runs inside the Windows desktop app.';
  }
  return invokeTauri<string>('test_ai_connection', { provider, model, endpoint });
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

export async function toAssetUrl(filePath: string): Promise<string> {
  if (!isTauriEnvironment()) {
    return filePath;
  }
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return convertFileSrc(filePath);
}

export async function probeHardwareEncoder(): Promise<HardwareEncoderStatus> {
  if (!isTauriEnvironment()) {
    return {
      hardwareAvailable: false,
      encoderNames: [],
      recommendedPreset: '720p30',
      message: 'Hardware GPU encoder probe runs inside the Windows desktop app.',
      leagueWindowMode: 'unknown',
    };
  }
  return invokeTauri<HardwareEncoderStatus>('probe_hardware_encoder');
}

export async function getRecordingStatus(): Promise<RecordingRuntimeStatus> {
  if (!isTauriEnvironment()) {
    return {
      state: 'idle',
      preset: '720p30',
      elapsedSec: 0,
      recordingId: null,
      encoderName: null,
      message: null,
    };
  }
  return invokeTauri<RecordingRuntimeStatus>('get_recording_status');
}

export async function listRecordings(): Promise<RecordingRecord[]> {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invokeTauri<RecordingRecord[]>('list_recordings');
}

export async function getMatchRecording(matchId: string): Promise<MatchRecordingBundle> {
  if (!isTauriEnvironment()) {
    return {
      recording: null,
      clips: [],
      rofl: null,
      replayApiConnected: false,
      replayApiEnabled: false,
    };
  }
  return invokeTauri<MatchRecordingBundle>('get_match_recording', { matchId });
}

export async function toggleRecordingPin(
  recordingId: string,
  pinned: boolean
): Promise<RecordingRecord | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  return invokeTauri<RecordingRecord | null>('toggle_recording_pin', {
    recordingId,
    pinned,
  });
}

export async function deleteRecording(recordingId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('delete_recording', { recordingId });
}

export async function saveRecordingClip(
  recordingId: string,
  matchId: string | null,
  label: string,
  kind: string,
  gameTimeSec: number
): Promise<RecordingClipRecord> {
  if (!isTauriEnvironment()) {
    const startSec = Math.max(0, Math.round(gameTimeSec) - 12);
    return {
      id: `clip-${Date.now()}`,
      recordingId,
      matchId,
      label,
      kind,
      gameTimeSec,
      startSec,
      endSec: Math.round(gameTimeSec) + 6,
      pinned: true,
      createdAt: new Date().toISOString(),
    };
  }
  return invokeTauri<RecordingClipRecord>('save_recording_clip', {
    recordingId,
    matchId,
    label,
    kind,
    gameTimeSec,
  });
}

export async function deleteRecordingClip(clipId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('delete_recording_clip', { clipId });
}

export async function openRecordingsFolder(): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('open_recordings_folder');
}

export async function inspectReplayConfig(): Promise<GameCfgReplayStatus> {
  if (!isTauriEnvironment()) {
    return {
      cfgExists: false,
      cfgPath: 'C:\\Riot Games\\League of Legends\\Config\\game.cfg',
      replayApiEnabled: false,
      windowMode: 'unknown',
      previewDiff: '[General]\nEnableReplayApi=1',
    };
  }
  return invokeTauri<GameCfgReplayStatus>('inspect_replay_config');
}

export async function setReplayApiEnabled(enable: boolean): Promise<GameCfgReplayStatus> {
  if (!isTauriEnvironment()) {
    return {
      cfgExists: true,
      cfgPath: 'C:\\Riot Games\\League of Legends\\Config\\game.cfg',
      replayApiEnabled: enable,
      windowMode: 'borderless',
      previewDiff: `[General]\nEnableReplayApi=${enable ? 1 : 0}`,
    };
  }
  return invokeTauri<GameCfgReplayStatus>('set_replay_api_enabled', { enable });
}

export async function seekRiotReplay(
  matchId: string,
  timeSec: number,
  launchIfClosed = true
): Promise<ReplaySeekResult> {
  if (!isTauriEnvironment()) {
    return {
      status: 'unavailable',
      message: 'Riot Replay API deep-links run inside the Windows desktop app.',
      targetSec: Math.max(0, Math.round(timeSec)),
    };
  }
  return invokeTauri<ReplaySeekResult>('seek_riot_replay', {
    matchId,
    timeSec,
    launchIfClosed,
  });
}

export type { SqlPersonalLearningSummary };

export async function getPersonalLearningSnapshot(
  puuid?: string | null
): Promise<SqlPersonalLearningSummary> {
  if (!isTauriEnvironment()) {
    return { jungleMatchCount: 0, baselines: [], mistakeSignatures: [] };
  }
  return invokeTauri<SqlPersonalLearningSummary>('get_personal_learning_snapshot', {
    puuid: puuid ?? null,
  });
}

export async function getActivePatchPack(): Promise<ActivePatchPackStatus | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  return invokeTauri<ActivePatchPackStatus>('get_active_patch_pack');
}

export async function installSignedPatchPack(
  envelopeJson: string
): Promise<ActivePatchPackStatus> {
  if (!isTauriEnvironment()) {
    throw new Error('Signed patch pack installation requires the desktop app.');
  }
  return invokeTauri<ActivePatchPackStatus>('install_signed_patch_pack', {
    envelopeJson,
  });
}
