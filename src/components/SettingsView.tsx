import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PictureInPicture2,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  DEFAULT_RECORDING_SETTINGS,
  checkRiotApiKeyHealth,
  inspectReplayConfig,
  isTauriEnvironment,
  listRecordings,
  probeHardwareEncoder,
  resetHudPosition,
  saveSettings,
  setHudLocked,
  subscribeHudPreferences,
  updateOverlayPreferences,
} from '../services/tauriBridge';
import type {
  ActivePatchPackStatus,
  ApiKeyHealthStatus,
  AppMetaInfo,
  GameCfgReplayStatus,
  HardwareEncoderStatus,
  RecordingRecord,
  RecordingSettings,
  UpdateCheckResult,
  UpdateMode,
  UserSettings,
} from '../types/coaching';
import type { SummonerProfileSummary } from '../types/riot';
import { AboutUpdatesSection, describeUpdateStatus } from './AboutUpdatesSection';
import { M3Button, M3Chip, M3ListItem, cx, type M3ChipTone } from './m3';
import {
  AccountSettingsSection,
  SettingsNotice,
  describeRiotApiStatus,
  validateHttpsProxyUrl,
  type SettingsNotifier,
} from './settings/AccountSettingsSection';
import { AiCoachSettingsSection, AI_PROVIDER_LABELS } from './settings/AiCoachSettingsSection';
import { OverlaySettingsSection, type OverlayPatch } from './settings/OverlaySettingsSection';
import { RecordingSettingsSection, shortEncoderLabel } from './settings/RecordingSettingsSection';
import { RolesSettingsSection, describeRoles } from './settings/RolesSettingsSection';

export { validateHttpsProxyUrl };

export type SettingsSectionId = 'account' | 'roles' | 'overlay' | 'recording' | 'ai' | 'updates';

type CategoryGroup = 'Account & Coaching' | 'In-Game' | 'System';

interface SettingsCategory {
  id: SettingsSectionId;
  group: CategoryGroup;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Setting labels on the subpage — searchable from the category list. */
  keywords: string[];
}

/** Display + Prev/Next order. */
const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'account',
    group: 'Account & Coaching',
    title: 'Account & Riot API',
    description: 'Riot ID, region, climb target, API key / HTTPS proxy and Data Dragon catalog.',
    icon: UserRound,
    keywords: [
      'Riot ID',
      'Platform Region',
      'Target Division',
      'League Install Folder',
      'Summoner Profile',
      'Riot API Key',
      'HTTPS Proxy URL',
      'Data Dragon Patch & Catalog',
    ],
  },
  {
    id: 'roles',
    group: 'Account & Coaching',
    title: 'Roles & Preferences',
    description: 'Primary / secondary coached role and auto-detect from Champ Select.',
    icon: Users,
    keywords: ['Primary Role', 'Secondary Role', 'Jungle', 'ADC', 'Auto-detect role', 'Champ Select'],
  },
  {
    id: 'ai',
    group: 'Account & Coaching',
    title: 'AI Coach',
    description: 'Optional bring-your-own-key debriefs. Deterministic coaching always runs offline.',
    icon: Sparkles,
    keywords: ['AI Provider', 'Gemini', 'OpenAI', 'Ollama', 'Model Preset', 'AI Key', 'Test Connection', 'Privacy'],
  },
  {
    id: 'overlay',
    group: 'In-Game',
    title: 'Overlay & HUD',
    description: 'Compact HUD position, drag Unlock / Lock, hotkey, scale and recommended LoL HUD settings.',
    icon: PictureInPicture2,
    keywords: [
      'Global Hotkey',
      'Compact HUD Corner',
      'HUD Scale',
      'HUD Opacity',
      'HUD Monitor Target',
      'Minimap Side',
      'Unlock HUD for Dragging',
      'Reset HUD Position',
      'Recommended In-Game League HUD Settings',
    ],
  },
  {
    id: 'recording',
    group: 'In-Game',
    title: 'Recording & Replays',
    description: 'Opt-in GPU gameplay capture, disk quota, clips and one-click Riot Replay API seek.',
    icon: Video,
    keywords: [
      'Enable GPU Gameplay Recording',
      'GPU Encoder NVENC QSV AMF',
      'Quality Preset',
      'Disk Quota',
      'Keep Last N Games',
      'Open Recordings Folder',
      'Replay API game.cfg',
    ],
  },
  {
    id: 'updates',
    group: 'System',
    title: 'Updates & About',
    description: 'App version, update mode, changelog, logs and Ed25519-signed patch packs.',
    icon: RefreshCw,
    keywords: ['Update Mode', 'Check for Updates', 'Changelog', 'Open Logs Folder', 'Signed Patch Pack'],
  },
];

const CATEGORY_GROUPS: CategoryGroup[] = ['Account & Coaching', 'In-Game', 'System'];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** replayApiEnabled is written straight to game.cfg, so it never makes the draft dirty. */
function recordingDraftDiffers(a: RecordingSettings | undefined, b: RecordingSettings | undefined) {
  const x = a ?? DEFAULT_RECORDING_SETTINGS;
  const y = b ?? DEFAULT_RECORDING_SETTINGS;
  return (
    x.enabled !== y.enabled ||
    x.preset !== y.preset ||
    x.maxStorageGb !== y.maxStorageGb ||
    x.keepLastNGames !== y.keepLastNGames ||
    x.autoRecordRanked !== y.autoRecordRanked
  );
}

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
  patchPackStatus?: ActivePatchPackStatus | null;
  initialSection?: SettingsSectionId;
  initialSectionToken?: number;
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string, counts?: { champions: number; items: number }) => void;
  onApiKeyHealthChanged: (health: ApiKeyHealthStatus) => void;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onStageUpdate: () => Promise<void>;
  onInstallPatchPack?: (envelopeJson: string) => Promise<void>;
}

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
  patchPackStatus,
  initialSection = 'account',
  initialSectionToken = 0,
  onSettingsChanged,
  onProfileLoaded,
  onPatchSynced,
  onApiKeyHealthChanged,
  onCheckUpdate,
  onInstallUpdate,
  onStageUpdate,
  onInstallPatchPack,
}: SettingsViewProps) {
  // null → stacked Category List (default); id → dedicated subpage.
  const [activeSection, setActiveSection] = useState<SettingsSectionId | null>(() =>
    initialSectionToken > 0 ? initialSection : null
  );
  const consumedTokenRef = useRef(initialSectionToken > 0 ? initialSectionToken : 0);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hwStatus, setHwStatus] = useState<HardwareEncoderStatus | null>(null);
  const [replayCfg, setReplayCfg] = useState<GameCfgReplayStatus | null>(null);
  const [storedRecordings, setStoredRecordings] = useState<RecordingRecord[]>([]);
  const [hudLocked, setHudLockedState] = useState(settings.hudLocked ?? true);
  const [customHudCoords, setCustomHudCoords] = useState<{ x: number; y: number } | null>(
    settings.hudX != null && settings.hudY != null ? { x: settings.hudX, y: settings.hudY } : null
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const subHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastOpenedRef = useRef<SettingsSectionId | null>(null);

  const notify = useMemo<SettingsNotifier>(
    () => ({
      status: (message) => {
        setErrorMessage(null);
        setStatusMessage(message);
      },
      error: (message) => {
        setStatusMessage(null);
        setErrorMessage(message);
      },
      clear: () => {
        setStatusMessage(null);
        setErrorMessage(null);
      },
    }),
    []
  );

  function navigateTo(section: SettingsSectionId | null) {
    setStatusMessage(null);
    setErrorMessage(null);
    if (section) lastOpenedRef.current = section;
    setActiveSection(section);
  }

  // Deep-link: a fresh token (from "Open Settings → X" elsewhere) jumps straight into that subpage.
  useEffect(() => {
    if (initialSectionToken > consumedTokenRef.current) {
      consumedTokenRef.current = initialSectionToken;
      lastOpenedRef.current = initialSection;
      setActiveSection(initialSection);
    }
  }, [initialSection, initialSectionToken]);

  // Focus management: subpage heading on enter, originating category card on back.
  useEffect(() => {
    if (activeSection) {
      subHeadingRef.current?.focus({ preventScroll: true });
      subHeadingRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else if (lastOpenedRef.current) {
      document
        .querySelector<HTMLElement>(`[data-settings-category-item="${lastOpenedRef.current}"] button`)
        ?.focus({ preventScroll: true });
    }
  }, [activeSection]);

  // Keyboard: Esc → back (outside fields); "/" → focus the category filter.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape' && activeSection) {
        event.preventDefault();
        navigateTo(null);
      } else if (event.key === '/' && !activeSection) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSection]);

  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    const unsubPromise = subscribeHudPreferences((prefs) => {
      if (!active) return;
      if (typeof prefs.hudLocked === 'boolean') {
        setHudLockedState(prefs.hudLocked);
      }
      if (prefs.hudX != null && prefs.hudY != null) {
        setCustomHudCoords({ x: prefs.hudX, y: prefs.hudY });
      } else if (prefs.hudX === null && prefs.hudY === null) {
        setCustomHudCoords(null);
      }
    });
    return () => {
      active = false;
      void unsubPromise.then((fn) => fn());
    };
  }, [isTauri]);

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
    Pick<UserSettings, 'hudCorner' | 'overlayHotkey' | 'hudOpacity' | 'hudScale' | 'hudMonitor' | 'minimapSide'>
  >({
    hudCorner: settings.hudCorner,
    overlayHotkey: settings.overlayHotkey,
    hudOpacity: settings.hudOpacity,
    hudScale: settings.hudScale,
    hudMonitor: settings.hudMonitor,
    minimapSide: settings.minimapSide,
  });

  // Merge incoming persisted settings while preserving unsaved draft edits across subpages.
  useEffect(() => {
    const prev = prevSettingsRef.current;
    setDraft((cur) => ({
      ...settings,
      riotId: cur.riotId !== prev.riotId ? cur.riotId : settings.riotId,
      region: cur.region !== prev.region ? cur.region : settings.region,
      lolInstallPath:
        cur.lolInstallPath !== prev.lolInstallPath ? cur.lolInstallPath : settings.lolInstallPath,
      targetDivision:
        cur.targetDivision !== prev.targetDivision ? cur.targetDivision : settings.targetDivision,
      updateMode: cur.updateMode !== prev.updateMode ? cur.updateMode : settings.updateMode,
      riotApiProxyUrl:
        cur.riotApiProxyUrl !== prev.riotApiProxyUrl ? cur.riotApiProxyUrl : settings.riotApiProxyUrl,
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
                settings.recording?.replayApiEnabled ?? cur.recording?.replayApiEnabled ?? false,
            }
          : (settings.recording ?? DEFAULT_RECORDING_SETTINGS),
    }));
    prevSettingsRef.current = settings;
  }, [settings]);

  /* ---------- Dirty state per subpage ---------- */
  const accountDirty =
    draft.riotId !== settings.riotId ||
    draft.region !== settings.region ||
    draft.targetDivision !== settings.targetDivision ||
    draft.lolInstallPath !== settings.lolInstallPath ||
    (draft.riotApiProxyUrl ?? '') !== (settings.riotApiProxyUrl ?? '');
  const recordingDirty = recordingDraftDiffers(draft.recording, settings.recording);
  const aiDirty =
    draft.aiCoach.provider !== settings.aiCoach.provider ||
    draft.aiCoach.model !== settings.aiCoach.model ||
    draft.aiCoach.endpoint !== settings.aiCoach.endpoint;
  const dirtyBySection: Partial<Record<SettingsSectionId, boolean>> = {
    account: accountDirty,
    recording: recordingDirty,
    ai: aiDirty,
  };

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

  function discardAccountDraft() {
    setDraft((prev) => ({
      ...prev,
      riotId: settings.riotId,
      region: settings.region,
      targetDivision: settings.targetDivision,
      lolInstallPath: settings.lolInstallPath,
      riotApiProxyUrl: settings.riotApiProxyUrl,
    }));
    notify.clear();
  }

  function discardRecordingDraft() {
    setDraft((prev) => ({
      ...prev,
      recording: {
        ...(settings.recording ?? DEFAULT_RECORDING_SETTINGS),
        replayApiEnabled: prev.recording?.replayApiEnabled ?? settings.recording?.replayApiEnabled ?? false,
      },
    }));
    notify.clear();
  }

  function discardAiDraft() {
    setDraft((prev) => ({ ...prev, aiCoach: { ...settings.aiCoach } }));
    notify.clear();
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

  function handleImmediateOverlayPatch(patch: OverlayPatch, persistNow = true) {
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

    void updateOverlayPreferences(nextOverlaySettings.hudCorner, nextOverlaySettings.overlayHotkey, {
      hudOpacity: nextOverlaySettings.hudOpacity,
      hudScale: nextOverlaySettings.hudScale ?? 100,
      hudMonitor: nextOverlaySettings.hudMonitor ?? 'primary',
      minimapSide: nextOverlaySettings.minimapSide ?? 'right',
    })
      .then(() => {
        persistedOverlayRef.current = persistSuccessSnapshot;
      })
      .catch((err) => {
        // Revert to last persisted overlay settings (including live slider drags)
        const rollback = persistedOverlayRef.current;
        setDraft((prev) => ({ ...prev, ...rollback }));
        onSettingsChanged({ ...settings, ...rollback });
        setStatusMessage(null);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update overlay preferences.');
      });
  }

  function handleToggleHudLock() {
    const nextLocked = !hudLocked;
    setHudLockedState(nextLocked);
    void setHudLocked(nextLocked).catch((err) => {
      setHudLockedState(!nextLocked);
      notify.error(err instanceof Error ? err.message : 'Unable to toggle HUD lock.');
    });
  }

  function handleResetHudPosition() {
    void resetHudPosition()
      .then(() => {
        setCustomHudCoords(null);
        notify.status('HUD position reset to corner preset.');
      })
      .catch((err) => {
        notify.error(err instanceof Error ? err.message : 'Unable to reset HUD position.');
      });
  }

  /* ---------- Live status badges for the category list ---------- */
  function categoryStatus(id: SettingsSectionId): { label: string; tone: M3ChipTone } {
    switch (id) {
      case 'account': {
        const api = describeRiotApiStatus(apiKeyHealth, settings.hasApiKey, settings.riotApiProxyUrl);
        return { label: `${settings.region} · ${api.short}`, tone: api.tone };
      }
      case 'roles':
        return { label: describeRoles(settings), tone: 'primary' };
      case 'overlay':
        return hudLocked
          ? { label: `Compact HUD · ${settings.overlayHotkey}`, tone: 'success' }
          : { label: `HUD Unlocked · ${settings.overlayHotkey}`, tone: 'warning' };
      case 'recording': {
        const rec = settings.recording ?? DEFAULT_RECORDING_SETTINGS;
        return rec.enabled
          ? { label: `${shortEncoderLabel(hwStatus)} · ${rec.maxStorageGb} GB cap`, tone: 'error' }
          : { label: 'Recording disabled', tone: 'plain' };
      }
      case 'ai':
        return settings.aiCoach.provider === 'off'
          ? { label: 'Off', tone: 'plain' }
          : {
              label: `${AI_PROVIDER_LABELS[settings.aiCoach.provider]} · ${settings.aiCoach.model}`,
              tone: 'tertiary',
            };
      case 'updates':
        return describeUpdateStatus(appMeta.version, updateInfo, stagedUpdateVersion);
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCategories = SETTINGS_CATEGORIES.map((cat) => {
    if (!normalizedQuery) return { cat, hit: null as string | null };
    const keywordHit = cat.keywords.find((k) => k.toLowerCase().includes(normalizedQuery)) ?? null;
    const matches =
      keywordHit !== null ||
      cat.title.toLowerCase().includes(normalizedQuery) ||
      cat.description.toLowerCase().includes(normalizedQuery) ||
      categoryStatus(cat.id).label.toLowerCase().includes(normalizedQuery);
    return matches ? { cat, hit: keywordHit } : null;
  }).filter((entry): entry is { cat: SettingsCategory; hit: string | null } => entry !== null);

  const messages = (
    <>
      {statusMessage && (
        <div role="status">
          <SettingsNotice tone="success">{statusMessage}</SettingsNotice>
        </div>
      )}
      {errorMessage && (
        <SettingsNotice tone="error" role="alert">
          {errorMessage}
        </SettingsNotice>
      )}
    </>
  );

  /* ======================= VIEW A · Category list ======================= */
  if (activeSection === null) {
    return (
      <div className="m3-view-enter max-w-[960px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m3-headline-s text-[var(--md-sys-color-on-surface)]">Settings</h2>
            <p className="m3-body-s m3-muted">Pick a category to open its settings page.</p>
          </div>
          <label
            className="flex h-12 w-full max-w-[380px] cursor-text items-center gap-2.5 rounded-full bg-[var(--md-sys-color-surface-container-high)] pl-4 pr-2.5 focus-within:shadow-[inset_0_0_0_2px_var(--md-sys-color-primary)]"
          >
            <Search aria-hidden className="h-5 w-5 flex-none text-[var(--md-sys-color-on-surface)]" />
            <input
              ref={searchRef}
              type="search"
              aria-label="Filter settings"
              placeholder="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  if (query) setQuery('');
                  else e.currentTarget.blur();
                } else if (e.key === 'Enter' && filteredCategories[0]) {
                  e.preventDefault();
                  navigateTo(filteredCategories[0].cat.id);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                className="m3-state grid h-8 w-8 place-items-center rounded-full text-[var(--md-sys-color-on-surface)]"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            ) : (
              <kbd
                aria-hidden
                className="rounded-md px-1.5 text-[11px] font-bold text-[var(--md-sys-color-on-surface)] opacity-70 shadow-[inset_0_0_0_1px_currentColor]"
              >
                /
              </kbd>
            )}
          </label>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="rounded-[28px] bg-[var(--md-sys-color-surface-container-low)] p-8 text-center">
            <p className="m3-title-m text-[var(--md-sys-color-on-surface)]">No settings match “{query}”</p>
            <p className="m3-body-s m3-muted mt-1">Try “hotkey”, “API key”, “Replay” or “Gemini”.</p>
          </div>
        ) : (
          CATEGORY_GROUPS.map((group) => {
            const entries = filteredCategories.filter((entry) => entry.cat.group === group);
            if (entries.length === 0) return null;
            return (
              <section key={group} aria-label={group}>
                <h3 className="m3-label-m px-5 pb-1.5 uppercase tracking-[0.7px] text-[var(--md-sys-color-primary)]">
                  {group}
                </h3>
                <ul className="flex flex-col gap-[3px]">
                  {entries.map(({ cat, hit }, index) => {
                    const Icon = cat.icon;
                    const status = categoryStatus(cat.id);
                    const dirty = dirtyBySection[cat.id];
                    return (
                      <li key={cat.id} data-settings-category-item={cat.id}>
                        <M3ListItem
                          onClick={() => navigateTo(cat.id)}
                          ariaLabel={`${cat.title}: ${status.label}`}
                          className={cx(
                            'group !min-h-[68px] !rounded-[8px] !bg-[var(--md-sys-color-surface-container)] hover:!bg-[var(--md-sys-color-surface-container-high)]',
                            index === 0 && '!rounded-t-[20px]',
                            index === entries.length - 1 && '!rounded-b-[20px]'
                          )}
                          leading={
                            <span className="grid h-11 w-11 place-items-center rounded-[16px] bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] transition-[border-radius,background-color] duration-300 group-hover:rounded-[22px] group-hover:bg-[var(--md-sys-color-primary-container)] group-hover:text-[var(--md-sys-color-on-primary-container)]">
                              <Icon aria-hidden className="h-5 w-5" />
                            </span>
                          }
                          title={cat.title}
                          description={hit ? `Matches “${hit}” · ${cat.description}` : cat.description}
                          trailing={
                            <span className="flex items-center gap-2">
                              {dirty && <M3Chip tone="warning" size="sm" label="Unsaved" />}
                              <M3Chip
                                tone={status.tone}
                                size="sm"
                                label={status.label}
                                className={cx(
                                  'num max-w-[260px] truncate',
                                  status.tone === 'plain' && '!text-[var(--md-sys-color-on-surface)]'
                                )}
                              />
                              <ChevronRight
                                aria-hidden
                                className="h-5 w-5 text-[var(--md-sys-color-on-surface-variant)] transition-transform group-hover:translate-x-1"
                              />
                            </span>
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
        {messages}
      </div>
    );
  }

  /* ======================= VIEW B · Dedicated subpage ======================= */
  const rawIndex = SETTINGS_CATEGORIES.findIndex((c) => c.id === activeSection);
  const currentIndex = rawIndex >= 0 ? rawIndex : 0;
  const current = SETTINGS_CATEGORIES[currentIndex] ?? SETTINGS_CATEGORIES[0]!;
  const prevCat = currentIndex > 0 ? SETTINGS_CATEGORIES[currentIndex - 1] ?? null : null;
  const nextCat =
    currentIndex < SETTINGS_CATEGORIES.length - 1
      ? SETTINGS_CATEGORIES[currentIndex + 1] ?? null
      : null;
  const CurrentIcon = current.icon;
  const currentStatus = categoryStatus(current.id);

  return (
    <div key={activeSection} className="m3-view-enter max-w-[920px] space-y-3">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--md-sys-color-surface)] px-1 pb-3 pt-1">
        <M3Button
          variant="tonal"
          icon={<ArrowLeft aria-hidden className="h-5 w-5" />}
          onClick={() => navigateTo(null)}
          title="Back to Settings (Esc)"
        >
          Back to Settings
        </M3Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-[20px] bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
            <CurrentIcon aria-hidden className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2
              ref={subHeadingRef}
              tabIndex={-1}
              className="m3-title-l truncate text-[var(--md-sys-color-on-surface)] outline-none"
            >
              {current.title}
            </h2>
            <p className="m3-body-s m3-muted truncate">{current.description}</p>
          </div>
        </div>
        <M3Chip
          tone={currentStatus.tone}
          size="sm"
          label={currentStatus.label}
          className={cx('num hidden max-w-[240px] truncate md:inline-flex', currentStatus.tone === 'plain' && '!text-[var(--md-sys-color-on-surface)]')}
        />
        <nav aria-label="Settings categories" className="flex items-center gap-1">
          <M3Button
            variant="outlined"
            size="sm"
            disabled={!prevCat}
            aria-label={prevCat ? `Previous: ${prevCat.title}` : 'No previous category'}
            icon={<ChevronLeft aria-hidden className="h-4 w-4" />}
            onClick={() => prevCat && navigateTo(prevCat.id)}
          >
            Prev
          </M3Button>
          <M3Button
            variant="outlined"
            size="sm"
            disabled={!nextCat}
            aria-label={nextCat ? `Next: ${nextCat.title}` : 'No next category'}
            trailingIcon={<ChevronRight aria-hidden className="h-4 w-4" />}
            onClick={() => nextCat && navigateTo(nextCat.id)}
          >
            Next
          </M3Button>
        </nav>
      </div>

      {activeSection === 'account' && (
        <AccountSettingsSection
          settings={settings}
          draft={draft}
          setDraft={setDraft}
          patchVersion={patchVersion}
          catalogCounts={catalogCounts}
          apiKeyHealth={apiKeyHealth}
          dirty={accountDirty}
          notify={notify}
          onSave={handleSaveSettings}
          onDiscard={discardAccountDraft}
          onSettingsChanged={onSettingsChanged}
          onProfileLoaded={onProfileLoaded}
          onPatchSynced={onPatchSynced}
          onApiKeyHealthChanged={onApiKeyHealthChanged}
        />
      )}

      {activeSection === 'roles' && (
        <RolesSettingsSection settings={settings} notify={notify} onSettingsChanged={onSettingsChanged} />
      )}

      {activeSection === 'overlay' && (
        <OverlaySettingsSection
          draft={draft}
          isTauri={isTauri}
          hudLocked={hudLocked}
          customHudCoords={customHudCoords}
          onOverlayPatch={handleImmediateOverlayPatch}
          onToggleHudLock={handleToggleHudLock}
          onResetHudPosition={handleResetHudPosition}
        />
      )}

      {activeSection === 'recording' && (
        <RecordingSettingsSection
          settings={settings}
          draft={draft}
          setDraft={setDraft}
          isTauri={isTauri}
          hwStatus={hwStatus}
          replayCfg={replayCfg}
          storedRecordings={storedRecordings}
          dirty={recordingDirty}
          notify={notify}
          onHwStatusChanged={setHwStatus}
          onReplayCfgChanged={setReplayCfg}
          onSettingsChanged={onSettingsChanged}
          onSave={handleSaveSettings}
          onDiscard={discardRecordingDraft}
        />
      )}

      {activeSection === 'ai' && (
        <AiCoachSettingsSection
          settings={settings}
          draft={draft}
          setDraft={setDraft}
          dirty={aiDirty}
          notify={notify}
          onSettingsChanged={onSettingsChanged}
          onSave={handleSaveSettings}
          onDiscard={discardAiDraft}
        />
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
          patchPackStatus={patchPackStatus}
          onUpdateModeChange={handleUpdateModeChange}
          onCheckUpdate={onCheckUpdate}
          onInstallUpdate={onInstallUpdate}
          onStageUpdate={onStageUpdate}
          onInstallPatchPack={onInstallPatchPack}
        />
      )}

      <div className="space-y-2" aria-live="polite">
        {messages}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        {prevCat ? (
          <button
            type="button"
            onClick={() => navigateTo(prevCat.id)}
            className="m3-state flex items-center gap-3 rounded-[20px] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3.5 text-left hover:bg-[var(--md-sys-color-surface-container)]"
          >
            <ChevronLeft aria-hidden className="h-5 w-5 flex-none text-[var(--md-sys-color-on-surface)]" />
            <span className="min-w-0">
              <span className="m3-body-s m3-muted block">Previous</span>
              <span className="m3-title-s block truncate text-[var(--md-sys-color-on-surface)]">{prevCat.title}</span>
            </span>
          </button>
        ) : (
          <span />
        )}
        {nextCat ? (
          <button
            type="button"
            onClick={() => navigateTo(nextCat.id)}
            className="m3-state flex items-center justify-end gap-3 rounded-[20px] bg-[var(--md-sys-color-surface-container-low)] px-4 py-3.5 text-right hover:bg-[var(--md-sys-color-surface-container)]"
          >
            <span className="min-w-0">
              <span className="m3-body-s m3-muted block">Next</span>
              <span className="m3-title-s block truncate text-[var(--md-sys-color-on-surface)]">{nextCat.title}</span>
            </span>
            <ChevronRight aria-hidden className="h-5 w-5 flex-none text-[var(--md-sys-color-on-surface)]" />
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
