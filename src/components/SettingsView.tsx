import { useEffect, useRef, useState } from 'react';
import { syncFullDdragonCatalog } from '../services/ddragonService';
import {
  checkRiotApiKeyHealth,
  fetchSummonerProfile,
  isTauriEnvironment,
  saveAiApiKey,
  saveRiotApiKey,
  saveSettings,
  syncDdragonPatch,
  updateOverlayPreferences,
} from '../services/tauriBridge';
import type {
  AiProvider,
  ApiKeyHealthStatus,
  AppMetaInfo,
  HudCorner,
  HudMonitorTarget,
  HudScalePercent,
  MinimapSide,
  OverlayHotkeyPreset,
  UpdateCheckResult,
  UserSettings,
} from '../types/coaching';
import type { SummonerProfileSummary } from '../types/riot';
import { AboutUpdatesSection } from './AboutUpdatesSection';
import { GlassSurface } from './GlassSurface';

interface SettingsViewProps {
  settings: UserSettings;
  patchVersion: string;
  catalogCounts: { champions: number; items: number };
  apiKeyHealth: ApiKeyHealthStatus | null;
  appMeta: AppMetaInfo;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  updateError: string | null;
  canInstallUpdateSafely: boolean;
  isTauri: boolean;
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string, counts?: { champions: number; items: number }) => void;
  onApiKeyHealthChanged: (health: ApiKeyHealthStatus) => void;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
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
  updateError,
  canInstallUpdateSafely,
  isTauri,
  onSettingsChanged,
  onProfileLoaded,
  onPatchSynced,
  onApiKeyHealthChanged,
  onCheckUpdate,
  onInstallUpdate,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      aiCoach:
        cur.aiCoach.provider !== prev.aiCoach.provider ||
        cur.aiCoach.model !== prev.aiCoach.model ||
        cur.aiCoach.endpoint !== prev.aiCoach.endpoint
          ? { ...cur.aiCoach, hasApiKey: settings.aiCoach.hasApiKey }
          : settings.aiCoach,
    }));
    prevSettingsRef.current = settings;
  }, [settings]);

  async function handleSaveSettings() {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateOverlayPreferences(draft.hudCorner, draft.overlayHotkey, {
        hudOpacity: draft.hudOpacity,
        hudScale: draft.hudScale ?? 100,
        hudMonitor: draft.hudMonitor ?? 'primary',
        minimapSide: draft.minimapSide ?? 'right',
      });
      await saveSettings(draft);
      persistedOverlayRef.current = {
        hudCorner: draft.hudCorner,
        overlayHotkey: draft.overlayHotkey,
        hudOpacity: draft.hudOpacity,
        hudScale: draft.hudScale,
        hudMonitor: draft.hudMonitor,
        minimapSide: draft.minimapSide,
      };
      onSettingsChanged(draft);
      setStatusMessage('Preferences & Overlay Ergonomics saved.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save preferences.');
    }
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
      if (ok) {
        const updated = { ...draft, hasApiKey: true };
        setDraft(updated);
        await saveSettings(updated);
        onSettingsChanged(updated);
        setApiKeyInput('');
        const health = await checkRiotApiKeyHealth(updated.region);
        onApiKeyHealthChanged(health);
        setStatusMessage(
          health.status === 'valid'
            ? `Riot API Key stored & verified on ${updated.region}.`
            : `Riot API Key stored in Windows Credential Manager (${health.message}).`
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
        const updated: UserSettings = {
          ...draft,
          aiCoach: { ...draft.aiCoach, hasApiKey: true },
        };
        setDraft(updated);
        await saveSettings(updated);
        onSettingsChanged(updated);
        setAiKeyInput('');
        setStatusMessage('AI Coach API key stored in Windows Credential Manager.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to store AI API key.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <GlassSurface className="space-y-3.5 p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            Riot Account &amp; Climb Target
          </h2>

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
                      : draft.hasApiKey
                        ? 'text-slate-300'
                        : 'text-amber-300'
              }`}
            >
              {apiKeyHealth?.status === 'valid'
                ? 'Verified Active'
                : apiKeyHealth?.status === 'expired'
                  ? 'Expired / Invalid (401/403)'
                  : apiKeyHealth?.status === 'rate_limited'
                    ? 'Rate Limited (429)'
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

          <div className="lg-inset p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Overlay Ergonomics
            </div>
            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
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
                  min={50}
                  max={100}
                  value={draft.hudOpacity}
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
      </div>

      {/* Optional BYOK AI Coach */}
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
      </GlassSurface>

      <AboutUpdatesSection
        appMeta={appMeta}
        updateInfo={updateInfo}
        checkingUpdate={checkingUpdate}
        installingUpdate={installingUpdate}
        updateError={updateError}
        canInstallUpdateSafely={canInstallUpdateSafely}
        isTauri={isTauri}
        onCheckUpdate={onCheckUpdate}
        onInstallUpdate={onInstallUpdate}
      />

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
