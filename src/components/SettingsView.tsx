import { useEffect, useRef, useState } from 'react';
import { syncFullDdragonCatalog } from '../services/ddragonService';
import {
  DEFAULT_RECORDING_SETTINGS,
  checkRiotApiKeyHealth,
  fetchSummonerProfile,
  inspectReplayConfig,
  isTauriEnvironment,
  listRecordings,
  openRecordingsFolder,
  probeHardwareEncoder,
  saveAiApiKey,
  saveRiotApiKey,
  saveSettings,
  setReplayApiEnabled,
  syncDdragonPatch,
  updateOverlayPreferences,
} from '../services/tauriBridge';
import { formatStorageBytes } from '../domain/recordingSync';
import type {
  AiProvider,
  ApiKeyHealthStatus,
  AppMetaInfo,
  GameCfgReplayStatus,
  HardwareEncoderStatus,
  HudCorner,
  HudMonitorTarget,
  HudScalePercent,
  MinimapSide,
  OverlayHotkeyPreset,
  RecordingPreset,
  RecordingRecord,
  UpdateCheckResult,
  UpdateMode,
  UserSettings,
} from '../types/coaching';
import type { SummonerProfileSummary } from '../types/riot';
import { AboutUpdatesSection } from './AboutUpdatesSection';
import { GlassSurface } from './GlassSurface';

export type SettingsSectionId = 'account' | 'overlay' | 'recording' | 'ai' | 'updates';

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'account', label: 'Account & API' },
  { id: 'overlay', label: 'Overlay & HUD' },
  { id: 'recording', label: 'Recording & Replays' },
  { id: 'ai', label: 'AI Coach' },
  { id: 'updates', label: 'Updates & About' },
];

interface SettingsViewProps {
  settings: UserSettings;
  patchVersion: string;
  catalogCounts: { champions: number; items: number };
  apiKeyHealth: ApiKeyHealthStatus | null;
  appMeta: AppMetaInfo;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  stagingUpdate: boolean;
  stagedUpdateVersion: string | null;
  updateError: string | null;
  canInstallUpdateSafely: boolean;
  isTauri: boolean;
  initialSection?: SettingsSectionId;
  initialSectionToken?: number;
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string, counts?: { champions: number; items: number }) => void;
  onApiKeyHealthChanged: (health: ApiKeyHealthStatus) => void;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onStageUpdate: () => Promise<void>;
}

export function validateHttpsProxyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) {
    return 'Proxy URL cannot contain whitespace.';
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Enter a valid HTTPS URL (e.g. https://your-worker.workers.dev).';
  }
  if (parsed.protocol !== 'https:') {
    return 'Riot API Proxy URL must use HTTPS.';
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return 'Proxy URL must have a valid HTTPS host without embedded credentials.';
  }
  if (parsed.search || parsed.hash) {
    return 'Proxy URL cannot include query parameters or fragments.';
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    return 'Proxy URL must be an origin-only HTTPS URL (no path).';
  }
  return null;
}

const REGIONS = [
  'EUW1',
  'EUN1',
  'NA1',
  'KR',
  'JP1',
  'BR1',
  'LA1',
  'LA2',
  'OC1',
  'TR1',
  'RU',
  'PH2',
  'SG2',
  'TH2',
  'TW2',
  'VN2',
  'ME1',
];
const DIVISIONS = [
  'SILVER IV',
  'GOLD IV',
  'PLATINUM IV',
  'EMERALD IV',
  'DIAMOND IV',
  'MASTER',
];
const HUD_CORNERS: Array<{ value: HudCorner; label: string }> = [
  { value: 'beside-minimap', label: 'Beside Minimap (LoL Safe)' },
  { value: 'top-right', label: 'Top-Right' },
  { value: 'top-left', label: 'Top-Left' },
  { value: 'bottom-right', label: 'Bottom-Right' },
  { value: 'bottom-left', label: 'Bottom-Left' },
];
const HOTKEY_PRESETS: OverlayHotkeyPreset[] = ['Alt+J', 'Alt+B', 'Ctrl+Shift+J', 'F8'];

export function SettingsView({
  settings,
  patchVersion,
  catalogCounts,
  apiKeyHealth,
  appMeta,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  stagingUpdate,
  stagedUpdateVersion,
  updateError,
  canInstallUpdateSafely,
  isTauri,
  initialSection = 'account',
  initialSectionToken = 0,
  onSettingsChanged,
  onProfileLoaded,
  onPatchSynced,
  onApiKeyHealthChanged,
  onCheckUpdate,
  onInstallUpdate,
  onStageUpdate,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hwStatus, setHwStatus] = useState<HardwareEncoderStatus | null>(null);
  const [replayCfg, setReplayCfg] = useState<GameCfgReplayStatus | null>(null);
  const [storedRecordings, setStoredRecordings] = useState<RecordingRecord[]>([]);
  const [togglingReplay, setTogglingReplay] = useState(false);
  const proxyValidationError = validateHttpsProxyUrl(draft.riotApiProxyUrl ?? '');

  useEffect(() => {
    if (initialSectionToken > 0) {
      setActiveSection(initialSection);
    }
  }, [initialSection, initialSectionToken]);

  const rec = draft.recording ?? DEFAULT_RECORDING_SETTINGS;

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void probeHardwareEncoder()
      .then((s) => {
        if (!cancelled) setHwStatus(s);
      })
      .catch(() => {});
    void inspectReplayConfig()
      .then((c) => {
        if (!cancelled) setReplayCfg(c);
      })
      .catch(() => {});
    void listRecordings()
      .then((rows) => {
        if (!cancelled) setStoredRecordings(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isTauri, settings.lolInstallPath]);

  const prevSettingsRef = useRef<UserSettings>(settings);
  const persistedOverlayRef = useRef<
    Pick<
      UserSettings,
      'hudCorner' | 'overlayHotkey' | 'hudOpacity' | 'hudScale' | 'hudMonitor' | 'minimapSide'
    >
  >({
    hudCorner: settings.hudCorner,
    overlayHotkey: settings.overlayHotkey,
    hudOpacity: settings.hudOpacity,
    hudScale: settings.hudScale,
    hudMonitor: settings.hudMonitor,
    minimapSide: settings.minimapSide,
  });

  useEffect(() => {
    const prev = prevSettingsRef.current;
    setDraft((cur) => ({
      ...settings,
      riotId: cur.riotId !== prev.riotId ? cur.riotId : settings.riotId,
      region: cur.region !== prev.region ? cur.region : settings.region,
      lolInstallPath:
        cur.lolInstallPath !== prev.lolInstallPath
          ? cur.lolInstallPath
          : settings.lolInstallPath,
      targetDivision:
        cur.targetDivision !== prev.targetDivision
          ? cur.targetDivision
          : settings.targetDivision,
      updateMode:
        cur.updateMode !== prev.updateMode ? cur.updateMode : settings.updateMode,
      riotApiProxyUrl:
        cur.riotApiProxyUrl !== prev.riotApiProxyUrl
          ? cur.riotApiProxyUrl
          : settings.riotApiProxyUrl,
      aiCoach:
        cur.aiCoach.provider !== prev.aiCoach.provider ||
        cur.aiCoach.model !== prev.aiCoach.model ||
        cur.aiCoach.endpoint !== prev.aiCoach.endpoint
          ? { ...cur.aiCoach, hasApiKey: settings.aiCoach.hasApiKey }
          : settings.aiCoach,
      recording:
        JSON.stringify(cur.recording ?? DEFAULT_RECORDING_SETTINGS) !==
        JSON.stringify(prev.recording ?? DEFAULT_RECORDING_SETTINGS)
          ? {
              ...(cur.recording ?? DEFAULT_RECORDING_SETTINGS),
              replayApiEnabled:
                settings.recording?.replayApiEnabled ??
                cur.recording?.replayApiEnabled ??
                false,
            }
          : (settings.recording ?? DEFAULT_RECORDING_SETTINGS),
    }));
    prevSettingsRef.current = settings;
  }, [settings]);

  async function handleSaveSettings() {
    setErrorMessage(null);
    setStatusMessage(null);
    const proxyErr = validateHttpsProxyUrl(draft.riotApiProxyUrl ?? '');
    if (proxyErr) {
      setErrorMessage(proxyErr);
      return;
    }
    const normalizedDraft: UserSettings = {
      ...draft,
      riotApiProxyUrl: (draft.riotApiProxyUrl ?? '').trim().replace(/\/+$/, ''),
    };
    try {
      await updateOverlayPreferences(normalizedDraft.hudCorner, normalizedDraft.overlayHotkey, {
        hudOpacity: normalizedDraft.hudOpacity,
        hudScale: normalizedDraft.hudScale ?? 100,
        hudMonitor: normalizedDraft.hudMonitor ?? 'primary',
        minimapSide: normalizedDraft.minimapSide ?? 'right',
      });
      await saveSettings(normalizedDraft);
      persistedOverlayRef.current = {
        hudCorner: normalizedDraft.hudCorner,
        overlayHotkey: normalizedDraft.overlayHotkey,
        hudOpacity: normalizedDraft.hudOpacity,
        hudScale: normalizedDraft.hudScale,
        hudMonitor: normalizedDraft.hudMonitor,
        minimapSide: normalizedDraft.minimapSide,
      };
      setDraft(normalizedDraft);
      onSettingsChanged(normalizedDraft);
      if (isTauri && normalizedDraft.riotApiProxyUrl) {
        void checkRiotApiKeyHealth(normalizedDraft.region)
          .then(onApiKeyHealthChanged)
          .catch(() => {});
      }
      setStatusMessage('Preferences & Overlay Ergonomics saved.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save preferences.');
    }
  }

  function handleUpdateModeChange(mode: UpdateMode) {
    setErrorMessage(null);
    const nextPersisted: UserSettings = { ...settings, updateMode: mode };
    setDraft((prev) => ({ ...prev, updateMode: mode }));
    onSettingsChanged(nextPersisted);
    void saveSettings(nextPersisted).catch((err) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save update mode.');
    });
  }

  function handleImmediateOverlayPatch(
    patch: Partial<
      Pick<
        UserSettings,
        'hudCorner' | 'overlayHotkey' | 'hudOpacity' | 'hudScale' | 'hudMonitor' | 'minimapSide'
      >
    >,
    persistNow = true
  ) {
    // Apply overlay change without committing unsaved Riot ID / install path edits
    const nextOverlaySettings: UserSettings = { ...settings, ...patch };
    setDraft((prev) => ({ ...prev, ...patch }));
    onSettingsChanged(nextOverlaySettings);
    if (!persistNow) return;

    const persistSuccessSnapshot = {
      hudCorner: nextOverlaySettings.hudCorner,
      overlayHotkey: nextOverlaySettings.overlayHotkey,
      hudOpacity: nextOverlaySettings.hudOpacity,
      hudScale: nextOverlaySettings.hudScale,
      hudMonitor: nextOverlaySettings.hudMonitor,
      minimapSide: nextOverlaySettings.minimapSide,
    };

    if (!isTauriEnvironment()) {
      void saveSettings(nextOverlaySettings)
        .then(() => {
          persistedOverlayRef.current = persistSuccessSnapshot;
        })
        .catch(() => {});
      return;
    }

    void updateOverlayPreferences(
      nextOverlaySettings.hudCorner,
      nextOverlaySettings.overlayHotkey,
      {
        hudOpacity: nextOverlaySettings.hudOpacity,
        hudScale: nextOverlaySettings.hudScale ?? 100,
        hudMonitor: nextOverlaySettings.hudMonitor ?? 'primary',
        minimapSide: nextOverlaySettings.minimapSide ?? 'right',
      }
    )
      .then(() => {
        persistedOverlayRef.current = persistSuccessSnapshot;
      })
      .catch((err) => {
        // Revert to last persisted overlay settings (including live slider drags)
        const rollback = persistedOverlayRef.current;
        setDraft((prev) => ({ ...prev, ...rollback }));
        onSettingsChanged({ ...settings, ...rollback });
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to update overlay preferences.'
        );
      });
  }

  async function handleSaveApiKey() {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!apiKeyInput.trim()) {
      setErrorMessage('Enter a Riot Developer API key first.');
      return;
    }
    try {
      const ok = await saveRiotApiKey(apiKeyInput.trim());
      if (!ok) return;
      const updated = { ...settings, hasApiKey: true };
      setDraft((prev) => ({ ...prev, hasApiKey: true }));
      await saveSettings(updated);
      onSettingsChanged(updated);
      setApiKeyInput('');

      if (updated.riotApiProxyUrl?.trim()) {
        setStatusMessage(
          'Riot API Key stored in Windows Credential Manager (HTTPS Proxy URL is active, so live requests route through your proxy).'
        );
        return;
      }

      try {
        const health = await checkRiotApiKeyHealth(updated.region);
        onApiKeyHealthChanged(health);
        if (health.status === 'valid') {
          setStatusMessage(`Riot API Key stored. ${health.message}`);
          const parts = updated.riotId.trim().split('#');
          if (parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.trim())) {
            void fetchSummonerProfile(updated.riotId.trim(), updated.region)
              .then(onProfileLoaded)
              .catch(() => {});
          }
        } else if (health.status === 'expired') {
          setStatusMessage(
            'Riot API Key stored in Windows Credential Manager; verification returned 401/403 (see details below).'
          );
        } else {
          setErrorMessage(
            `Riot API Key stored in Windows Credential Manager, but live probe failed: ${health.message}`
          );
        }
      } catch (probeErr) {
        setErrorMessage(
          `Riot API Key stored in Windows Credential Manager, but verification check failed: ${
            probeErr instanceof Error ? probeErr.message : 'Unknown error'
          }`
        );
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to store Riot API key.');
    }
  }

  async function handleLookupProfile() {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const profile = await fetchSummonerProfile(draft.riotId, draft.region);
      onProfileLoaded(profile);
      setStatusMessage(`Synced profile: ${profile.riotId} (${profile.tier} ${profile.rank}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch Riot profile.');
    }
  }

  async function handleSyncPatch() {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const patch = await syncDdragonPatch();
      const catalog = await syncFullDdragonCatalog(patch);
      const counts = {
        champions: Object.keys(catalog.championsById).length,
        items: Object.keys(catalog.itemsById).length,
      };
      onPatchSynced(catalog.patch, counts);
      setStatusMessage(
        `Data Dragon synced to patch ${catalog.patch} (${counts.champions} champions, ${counts.items} items).`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to sync Data Dragon catalog.');
    }
  }

  async function handleSaveAiKey() {
    setErrorMessage(null);
    setStatusMessage(null);
    if (!aiKeyInput.trim()) {
      setErrorMessage('Enter an AI provider API key first.');
      return;
    }
    try {
      const ok = await saveAiApiKey(aiKeyInput.trim());
      if (ok) {
        const persisted: UserSettings = {
          ...settings,
          aiCoach: { ...draft.aiCoach, hasApiKey: true },
        };
        setDraft((prev) => ({
          ...prev,
          aiCoach: { ...prev.aiCoach, hasApiKey: true },
        }));
        await saveSettings(persisted);
        onSettingsChanged(persisted);
        setAiKeyInput('');
        setStatusMessage('AI Coach API key stored in Windows Credential Manager.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to store AI API key.');
    }
  }

  async function handleReprobeHardware() {
    setErrorMessage(null);
    try {
      const next = await probeHardwareEncoder();
      setHwStatus(next);
      setStatusMessage(next.message);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Hardware encoder probe failed.');
    }
  }

  async function handleToggleReplayApi() {
    const nextEnable = !(replayCfg?.replayApiEnabled ?? rec.replayApiEnabled);
    setTogglingReplay(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const cfg = await setReplayApiEnabled(nextEnable);
      setReplayCfg(cfg);
      const baseRec = settings.recording ?? DEFAULT_RECORDING_SETTINGS;
      const nextSettingsRec = { ...baseRec, replayApiEnabled: cfg.replayApiEnabled };
      setDraft((prev) => ({
        ...prev,
        recording: { ...(prev.recording ?? DEFAULT_RECORDING_SETTINGS), replayApiEnabled: cfg.replayApiEnabled },
      }));
      onSettingsChanged({ ...settings, recording: nextSettingsRec });
      setStatusMessage(
        cfg.replayApiEnabled
          ? `Enabled EnableReplayApi=1 in game.cfg (backup saved as game.cfg.bak).`
          : `Disabled EnableReplayApi in game.cfg (backup saved as game.cfg.bak).`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update game.cfg.');
    } finally {
      setTogglingReplay(false);
    }
  }

  const totalUsedBytes = storedRecordings.reduce((acc, row) => acc + row.sizeBytes, 0);

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="lg-segmented inline-flex flex-wrap items-center gap-1"
      >
        {SETTINGS_SECTIONS.map((sec) => {
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveSection(sec.id)}
              className={`rounded-[7px] px-3 py-1.5 text-xs font-medium transition ${
                isActive
                  ? 'lg-segment-active font-semibold'
                  : 'text-white/[0.62] hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {sec.label}
            </button>
          );
        })}
      </div>

      {activeSection === 'account' && (
        <div className="grid gap-4 md:grid-cols-2">
          <GlassSurface className="space-y-3.5 p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Riot Account &amp; Climb Target
            </h2>
          <p className="rounded-[8px] border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200/90">
            <strong>Keyless LCU Mode active:</strong> Open League of Legends for automatic Champ
            Select &amp; Live HUD coaching without an API key. Add a Riot API key below only for
            Match-V5 timeline history sync.
          </p>

          <label className="block text-xs">
            <span className="text-slate-300">Riot ID (Name#Tag)</span>
            <input
              type="text"
              value={draft.riotId}
              onChange={(e) => setDraft({ ...draft, riotId: e.target.value })}
              placeholder="YourName#EUW"
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-xs">
              <span className="text-slate-300">Platform Region</span>
              <select
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                className="lg-inset mt-1.5 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r} className="bg-zinc-900">
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs">
              <span className="text-slate-300">Target Division</span>
              <select
                value={draft.targetDivision}
                onChange={(e) => setDraft({ ...draft, targetDivision: e.target.value })}
                className="lg-inset mt-1.5 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
              >
                {DIVISIONS.map((d) => (
                  <option key={d} value={d} className="bg-zinc-900">
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs">
            <span className="text-slate-300">League Install Folder</span>
            <input
              type="text"
              value={draft.lolInstallPath}
              onChange={(e) => setDraft({ ...draft, lolInstallPath: e.target.value })}
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveSettings}
              className="lg-btn-primary px-4 py-2 text-xs font-bold"
            >
              Save Preferences
            </button>
            <button
              type="button"
              onClick={handleLookupProfile}
              className="lg-btn-glass px-3.5 py-2 text-xs font-medium text-white"
            >
              Sync Riot Profile
            </button>
          </div>
        </GlassSurface>

        <GlassSurface className="space-y-3.5 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Riot API Key &amp; Data Dragon
            </h2>
            <span
              className={`text-[11px] font-medium ${
                apiKeyHealth?.status === 'expired'
                  ? 'text-rose-300'
                  : apiKeyHealth?.status === 'rate_limited'
                    ? 'text-amber-300'
                    : apiKeyHealth?.status === 'valid'
                      ? 'text-emerald-300'
                      : draft.hasApiKey || (draft.riotApiProxyUrl?.trim() && !proxyValidationError)
                        ? 'text-slate-300'
                        : 'text-amber-300'
              }`}
            >
              {apiKeyHealth?.status === 'valid'
                ? 'Verified Active'
                : apiKeyHealth?.status === 'expired'
                  ? 'Key Rejected (401/403)'
                  : apiKeyHealth?.status === 'rate_limited'
                    ? 'Rate Limited (429)'
                    : draft.riotApiProxyUrl?.trim() && !proxyValidationError
                      ? 'HTTPS Proxy Configured'
                      : draft.hasApiKey
                        ? 'Key Stored (Unverified)'
                        : 'No Key Saved'}
            </span>
          </div>

          {apiKeyHealth && apiKeyHealth.status === 'expired' && (
            <p className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {apiKeyHealth.message}
            </p>
          )}

          <label className="block text-xs">
            <span className="text-slate-300">
              Personal Riot API Key (Windows Credential Manager)
            </span>
            <div className="mt-1.5 flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="RGAPI-xxxxxxxx-xxxx-..."
                className="lg-inset flex-1 px-3 py-2 text-xs text-slate-100 outline-none"
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="lg-btn-glass px-3 py-2 text-xs font-medium text-white"
              >
                Save Key
              </button>
            </div>
          </label>

          <label className="block text-xs">
            <span className="text-slate-300">Riot API Proxy URL (HTTPS)</span>
            <input
              type="url"
              aria-label="Riot API Proxy URL (HTTPS)"
              value={draft.riotApiProxyUrl ?? ''}
              onChange={(e) => setDraft({ ...draft, riotApiProxyUrl: e.target.value })}
              placeholder="https://betterjungler-riot-proxy.your-subdomain.workers.dev"
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
            {proxyValidationError ? (
              <span role="alert" className="mt-1 block text-[11px] text-rose-300">
                {proxyValidationError}
              </span>
            ) : (
              <span className="mt-1 block text-[11px] text-slate-400">
                Optional zero-trust Cloudflare Worker relay. When set, Riot requests route over
                HTTPS with <code className="font-mono text-slate-300">X-App-Client</code> instead
                of a personal key.
              </span>
            )}
          </label>

          <div className="lg-inset flex items-center justify-between px-3 py-2.5 text-xs">
            <div>
              <div className="font-medium text-white">Data Dragon Patch &amp; Catalog</div>
              <div className="text-[11px] text-slate-400">
                Patch {patchVersion} · {catalogCounts.champions} champions / {catalogCounts.items}{' '}
                items hydrated
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncPatch}
              className="lg-btn-glass px-3 py-1 text-xs font-medium text-white"
            >
              Sync Patch
            </button>
          </div>
        </GlassSurface>
      </div>
      )}

      {activeSection === 'overlay' && (
        <GlassSurface className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Transparent Overlay &amp; Compact HUD
            </h2>
            <span className="text-[11px] text-slate-400">
              Changes apply immediately in-game
            </span>
          </div>

          <div className="lg-inset p-3.5">
            <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Overlay Ergonomics
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-[11px]">
                <span className="text-slate-400">Compact HUD Corner</span>
                <select
                  aria-label="Compact HUD Corner"
                  value={draft.hudCorner}
                  onChange={(e) =>
                    handleImmediateOverlayPatch({
                      hudCorner: e.target.value as HudCorner,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100"
                >
                  {HUD_CORNERS.map((c) => (
                    <option key={c.value} value={c.value} className="bg-zinc-900">
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">Global Hotkey</span>
                <select
                  aria-label="Global Hotkey"
                  value={draft.overlayHotkey}
                  onChange={(e) =>
                    handleImmediateOverlayPatch({ overlayHotkey: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100"
                >
                  {HOTKEY_PRESETS.map((k) => (
                    <option key={k} value={k} className="bg-zinc-900">
                      {k}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">HUD Scale</span>
                <select
                  aria-label="HUD Scale"
                  value={draft.hudScale ?? 100}
                  onChange={(e) =>
                    handleImmediateOverlayPatch({
                      hudScale: Number(e.target.value) as HudScalePercent,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100"
                >
                  <option value={100} className="bg-zinc-900">100% (Standard)</option>
                  <option value={125} className="bg-zinc-900">125% (1440p Comfortable)</option>
                  <option value={150} className="bg-zinc-900">150% (Large / High-DPI)</option>
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">In-Game Minimap Side</span>
                <select
                  aria-label="In-Game Minimap Side"
                  value={draft.minimapSide ?? 'right'}
                  onChange={(e) =>
                    handleImmediateOverlayPatch({
                      minimapSide: e.target.value as MinimapSide,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100"
                >
                  <option value="right" className="bg-zinc-900">Right (Default LoL)</option>
                  <option value="left" className="bg-zinc-900">Left (Flipped Minimap)</option>
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">HUD Monitor Target</span>
                <select
                  aria-label="HUD Monitor Target"
                  value={draft.hudMonitor ?? 'primary'}
                  onChange={(e) =>
                    handleImmediateOverlayPatch({
                      hudMonitor: e.target.value as HudMonitorTarget,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100"
                >
                  <option value="primary" className="bg-zinc-900">Primary Display (League)</option>
                  <option value="active" className="bg-zinc-900">Same Display as App</option>
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">HUD Opacity ({draft.hudOpacity}%)</span>
                <input
                  type="range"
                  aria-label="HUD Opacity"
                  min={70}
                  max={100}
                  value={Math.max(70, draft.hudOpacity)}
                  onChange={(e) =>
                    handleImmediateOverlayPatch(
                      { hudOpacity: Number(e.target.value) },
                      false
                    )
                  }
                  onPointerUp={(e) =>
                    handleImmediateOverlayPatch({
                      hudOpacity: Number(e.currentTarget.value),
                    })
                  }
                  onKeyUp={(e) =>
                    handleImmediateOverlayPatch({
                      hudOpacity: Number(e.currentTarget.value),
                    })
                  }
                  className="mt-2 w-full accent-white"
                />
              </label>
            </div>
          </div>

          <div className="border-t border-white/[0.07] pt-2.5 text-[11px] text-slate-400">
            <span className="font-semibold text-emerald-300">Riot Policy Compliant:</span> Official
            APIs + LCU Champ Select read/manual apply + Live Client Data (127.0.0.1:2999). No memory
            reading, no enemy cooldown tracking, and Solo/Duo anonymity enforced.
          </div>
        </GlassSurface>
      )}

      {/* Opt-In Gameplay Recording & Riot Replay API */}
      {activeSection === 'recording' && (
        <GlassSurface className="space-y-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Opt-In Gameplay Recording &amp; Riot Replay API
          </h3>
          <span className="text-[11px] text-slate-400">
            Off by default · OS H.264 encoder (GPU probe) · League HWND only
          </span>
        </div>

        <div className="lg-inset flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
          <div className="space-y-0.5">
            <div className="font-medium text-white">
              {hwStatus
                ? hwStatus.hardwareAvailable
                  ? `GPU Encoder Ready: ${hwStatus.encoderNames[0] ?? 'Hardware H.264'}`
                  : 'Hardware GPU H.264 Encoder Not Detected'
                : 'GPU Encoder Probe'}
            </div>
            <div className="text-[11px] text-slate-400">
              {hwStatus?.message ?? 'Checks NVENC / AMF / QuickSync hardware capability.'}
            </div>
            {hwStatus?.leagueWindowMode === 'fullscreen' && (
              <div className="text-[11px] text-amber-300">
                League WindowMode=0 (Exclusive Fullscreen) detected. Switch to Borderless for
                optimal WGC capture and overlay visibility.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleReprobeHardware()}
            className="lg-btn-glass shrink-0 px-3 py-1.5 text-xs font-medium text-white"
          >
            Re-check GPU
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="lg-inset flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
            <span>
              <span className="block font-medium text-white">Enable Recording</span>
              <span className="text-[11px] text-slate-400">
                Captures League window only
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="Enable GPU Gameplay Recording"
              checked={rec.enabled}
              disabled={isTauri && hwStatus !== null && !hwStatus.hardwareAvailable && !rec.enabled}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recording: { ...rec, enabled: e.target.checked },
                })
              }
              className="h-4 w-4 accent-white"
            />
          </label>

          <label className="block text-xs">
            <span className="text-slate-300">Quality Preset</span>
            <select
              aria-label="Recording Quality Preset"
              value={rec.preset}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recording: { ...rec, preset: e.target.value as RecordingPreset },
                })
              }
              className="lg-inset mt-1.5 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
            >
              <option value="720p30" className="bg-zinc-900">
                30fps · 3.5 Mbps (Native Window · Recommended)
              </option>
              <option value="1080p60" className="bg-zinc-900">
                60fps · 8 Mbps (Native Window · dGPU)
              </option>
              <option value="clips_only" className="bg-zinc-900">
                Clips Focus (30fps · Keep Last 3 Games)
              </option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-slate-300">Disk Quota (GB)</span>
            <input
              type="number"
              aria-label="Recording Disk Quota GB"
              min={1}
              max={50}
              value={rec.maxStorageGb}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recording: {
                    ...rec,
                    maxStorageGb: Math.min(50, Math.max(1, Number(e.target.value) || 5)),
                  },
                })
              }
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>

          <label className="block text-xs">
            <span className="text-slate-300">Keep Last N Games</span>
            <input
              type="number"
              aria-label="Keep Last N Recordings"
              min={1}
              max={100}
              value={rec.keepLastNGames}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recording: {
                    ...rec,
                    keepLastNGames: Math.min(100, Math.max(1, Number(e.target.value) || 10)),
                  },
                })
              }
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="inline-flex items-center gap-2 text-slate-300">
            <input
              type="checkbox"
              aria-label="Auto-record Ranked Solo/Duo only"
              checked={rec.autoRecordRanked}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recording: { ...rec, autoRecordRanked: e.target.checked },
                })
              }
              className="h-3.5 w-3.5 accent-white"
            />
            <span>Record Ranked Solo/Duo matches automatically (skip non-ranked modes)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-400">
              {storedRecordings.length} saved ({formatStorageBytes(totalUsedBytes)})
            </span>
            <button
              type="button"
              onClick={() => void openRecordingsFolder()}
              className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white"
            >
              Open Recordings Folder
            </button>
          </div>
        </div>

        <div className="lg-inset flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
          <div className="space-y-1">
            <div className="font-medium text-white">
              Zero-Overhead Riot Replay API (127.0.0.1:2999)
            </div>
            <div className="text-[11px] text-slate-400">
              {replayCfg?.replayApiEnabled
                ? 'Enabled in League game.cfg (EnableReplayApi=1). One-click Seek works for .rofl replays.'
                : 'Disabled by default by Riot. Close League before toggling so game.cfg edits persist (.cfg.bak backup created).'}
            </div>
            {replayCfg?.previewDiff && (
              <pre className="rounded bg-black/35 px-2 py-1 font-mono text-[10px] text-slate-300">
                {replayCfg.previewDiff}
              </pre>
            )}
          </div>
          <button
            type="button"
            disabled={togglingReplay}
            onClick={() => void handleToggleReplayApi()}
            className="lg-btn-glass shrink-0 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {togglingReplay
              ? 'Updating game.cfg...'
              : replayCfg?.replayApiEnabled
                ? 'Disable Replay API'
                : 'Enable Replay API'}
          </button>
        </div>

        <div className="flex justify-end border-t border-white/[0.07] pt-3">
          <button
            type="button"
            onClick={handleSaveSettings}
            className="lg-btn-primary px-4 py-2 text-xs font-bold"
          >
            Save Preferences
          </button>
        </div>
      </GlassSurface>
      )}

      {/* Optional BYOK AI Coach */}
      {activeSection === 'ai' && (
        <GlassSurface className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Optional BYOK AI Coach (Natural-Language Debriefs)
          </h3>
          <span className="text-[11px] text-slate-500">
            Deterministic coaching always runs offline; AI is strictly optional.
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <label className="block text-xs">
            <span className="text-slate-300">AI Provider</span>
            <select
              aria-label="AI Provider"
              value={draft.aiCoach.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                const defaultModel =
                  provider === 'gemini'
                    ? 'gemini-2.5-flash'
                    : provider === 'openai'
                      ? 'gpt-4o-mini'
                      : provider === 'ollama'
                        ? 'llama3.1'
                        : draft.aiCoach.model;
                setDraft({
                  ...draft,
                  aiCoach: { ...draft.aiCoach, provider, model: defaultModel },
                });
              }}
              className="lg-inset mt-1.5 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
            >
              <option value="off" className="bg-zinc-900">
                Off (Deterministic Only)
              </option>
              <option value="gemini" className="bg-zinc-900">
                Google Gemini (BYOK)
              </option>
              <option value="openai" className="bg-zinc-900">
                OpenAI (BYOK)
              </option>
              <option value="ollama" className="bg-zinc-900">
                Local Ollama (127.0.0.1)
              </option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-slate-300">Model</span>
            <input
              type="text"
              value={draft.aiCoach.model}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  aiCoach: { ...draft.aiCoach, model: e.target.value },
                })
              }
              className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>

          {draft.aiCoach.provider === 'ollama' ? (
            <label className="block text-xs">
              <span className="text-slate-300">Local Ollama URL</span>
              <input
                type="text"
                value={draft.aiCoach.endpoint}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    aiCoach: { ...draft.aiCoach, endpoint: e.target.value },
                  })
                }
                className="lg-inset mt-1.5 w-full px-3 py-2 text-xs text-slate-100 outline-none"
              />
            </label>
          ) : (
            <label className="block text-xs">
              <span className="text-slate-300">
                AI Key ({draft.aiCoach.hasApiKey ? 'Stored Securely' : 'Not Saved'})
              </span>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder="Paste Gemini / OpenAI key"
                  className="lg-inset flex-1 px-2.5 py-2 text-xs text-slate-100 outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveAiKey}
                  className="lg-btn-glass px-3 py-2 text-xs font-medium text-white"
                >
                  Save
                </button>
              </div>
            </label>
          )}
        </div>

        <div className="flex justify-end border-t border-white/[0.07] pt-3">
          <button
            type="button"
            onClick={handleSaveSettings}
            className="lg-btn-primary px-4 py-2 text-xs font-bold"
          >
            Save Preferences
          </button>
        </div>
      </GlassSurface>
      )}

      {activeSection === 'updates' && (
        <AboutUpdatesSection
          appMeta={appMeta}
          updateInfo={updateInfo}
          checkingUpdate={checkingUpdate}
          installingUpdate={installingUpdate}
          stagingUpdate={stagingUpdate}
          stagedUpdateVersion={stagedUpdateVersion}
          updateMode={draft.updateMode ?? 'manual'}
          updateError={updateError}
          canInstallUpdateSafely={canInstallUpdateSafely}
          isTauri={isTauri}
          onUpdateModeChange={handleUpdateModeChange}
          onCheckUpdate={onCheckUpdate}
          onInstallUpdate={onInstallUpdate}
          onStageUpdate={onStageUpdate}
        />
      )}

      {statusMessage && (
        <div className="lg-inset px-3.5 py-2 text-xs text-emerald-300">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="lg-inset px-3.5 py-2 text-xs text-rose-300">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
