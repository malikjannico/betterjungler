import { useId, useState, type ReactNode } from 'react';
import {
  CircleCheck,
  Info,
  KeyRound,
  RefreshCw,
  Save,
  TriangleAlert,
  Undo2,
  UserRound,
} from 'lucide-react';
import { syncFullDdragonCatalog } from '../../services/ddragonService';
import {
  checkRiotApiKeyHealth,
  fetchSummonerProfile,
  saveRiotApiKey,
  saveSettings,
  syncDdragonPatch,
} from '../../services/tauriBridge';
import type { ApiKeyHealthStatus, UserSettings } from '../../types/coaching';
import type { SummonerProfileSummary } from '../../types/riot';
import { M3Button, M3Card, M3Chip, cx, type M3ChipTone } from '../m3';

/* ------------------------------------------------------------------ */
/* Shared Settings building blocks                                     */
/* (exported for the sibling section modules; kept here so sections    */
/*  never import runtime code from SettingsView → no import cycle)     */
/* ------------------------------------------------------------------ */

export interface SettingsNotifier {
  status: (message: string) => void;
  error: (message: string) => void;
  clear: () => void;
}

/** Text fields / selects: elevated well uses on-surface text (never on-surface-variant). */
export const SETTINGS_FIELD_CLASS =
  'h-10 w-full min-w-0 rounded-[8px] bg-[var(--md-sys-color-surface-container-highest)] px-3 text-[13px] text-[var(--md-sys-color-on-surface)] outline-none shadow-[inset_0_-1px_0_var(--md-sys-color-outline)] placeholder:text-[var(--md-sys-color-outline)] focus-visible:shadow-[inset_0_-2px_0_var(--md-sys-color-primary)] disabled:opacity-50';

/** Unselected segments sit on surface-container-highest → lift their text to on-surface for contrast. */
export const SEG_CONTRAST_CLASS =
  '[&_button:not([aria-pressed=true]):not(:disabled)]:text-[var(--md-sys-color-on-surface)]';

export function SettingsGroup({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <M3Card as="section" variant="hero" className="!px-2 !pb-2 !pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pb-1.5">
        <div className="min-w-0">
          <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">{title}</h3>
          {description && <p className="m3-body-s m3-muted mt-0.5">{description}</p>}
        </div>
        {aside}
      </div>
      <div className="divide-y divide-[color:rgba(68,71,78,0.55)]">{children}</div>
    </M3Card>
  );
}

export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  stacked = false,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Put the control below the label instead of to its right. */
  stacked?: boolean;
}) {
  const labelNode = htmlFor ? (
    <label htmlFor={htmlFor} className="m3-title-s text-[var(--md-sys-color-on-surface)]">
      {label}
    </label>
  ) : (
    <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">{label}</div>
  );
  return (
    <div
      className={cx(
        'px-4 py-3.5',
        stacked ? 'space-y-2.5' : 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5'
      )}
    >
      <div className={cx('min-w-0', !stacked && 'flex-1 basis-64')}>
        {labelNode}
        {description && <div className="m3-body-s m3-muted mt-0.5 max-w-[560px]">{description}</div>}
      </div>
      {children !== undefined && (
        <div className={cx('min-w-0', !stacked && 'flex flex-none flex-wrap items-center gap-2')}>
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-8 w-[52px] flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        checked
          ? 'bg-[var(--md-sys-color-primary)]'
          : 'bg-[var(--md-sys-color-surface-container-highest)] shadow-[inset_0_0_0_2px_var(--md-sys-color-outline)]'
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-all duration-300',
          checked
            ? 'left-6 h-6 w-6 bg-[var(--md-sys-color-on-primary)] text-[var(--md-sys-color-primary)]'
            : 'left-2 h-4 w-4 bg-[var(--md-sys-color-outline)]'
        )}
      >
        {checked && <CircleCheck className="h-4 w-4" strokeWidth={2.5} />}
      </span>
    </button>
  );
}

export type SettingsNoticeTone = 'success' | 'warning' | 'error' | 'info';

export function SettingsNotice({
  tone = 'info',
  children,
  role,
}: {
  tone?: SettingsNoticeTone;
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  const toneClass: Record<SettingsNoticeTone, string> = {
    success:
      'bg-[var(--md-ext-success-container)] text-[var(--md-ext-on-success-container)]',
    warning:
      'bg-[var(--md-ext-warning-container)] text-[var(--md-ext-on-warning-container)]',
    error:
      'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]',
    info: 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
  };
  const Icon = tone === 'success' ? CircleCheck : tone === 'info' ? Info : TriangleAlert;
  return (
    <div
      role={role}
      className={cx('flex items-start gap-3 rounded-[16px] px-4 py-3 text-[13px] leading-[19px]', toneClass[tone])}
    >
      <Icon aria-hidden className="mt-px h-[18px] w-[18px] flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Sticky, dirty-aware save bar shared by Account / Recording / AI Coach subpages. */
export function SettingsSaveBar({
  dirty,
  saveLabel,
  onSave,
  onDiscard,
  disabled = false,
  cleanHint = 'All changes saved',
}: {
  dirty: boolean;
  saveLabel: string;
  onSave: () => void;
  onDiscard?: () => void;
  disabled?: boolean;
  cleanHint?: string;
}) {
  return (
    <div
      className={cx(
        'sticky bottom-0 z-[5] flex flex-wrap items-center gap-2 rounded-[28px] py-2.5 pl-5 pr-3 shadow-[0_-10px_24px_rgba(17,19,24,0.9)] transition-colors',
        dirty
          ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
          : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]'
      )}
    >
      <span className="m3-label-l flex min-w-0 flex-1 items-center gap-2">
        {dirty ? (
          <>
            <span aria-hidden className="m3-dot m3-dot--warning" />
            Unsaved changes
          </>
        ) : (
          <>
            <CircleCheck aria-hidden className="h-4 w-4 text-[var(--md-ext-success)]" />
            {cleanHint}
          </>
        )}
      </span>
      {dirty && onDiscard && (
        <M3Button
          variant="text"
          size="sm"
          icon={<Undo2 aria-hidden className="h-4 w-4" />}
          onClick={onDiscard}
          className="!text-[var(--md-sys-color-on-primary-container)]"
        >
          Discard
        </M3Button>
      )}
      <M3Button
        variant="filled"
        size="sm"
        disabled={disabled}
        icon={<Save aria-hidden className="h-4 w-4" />}
        onClick={onSave}
      >
        {saveLabel}
      </M3Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account-specific helpers                                            */
/* ------------------------------------------------------------------ */

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

/** Single source of truth for the Riot API key / proxy badge (subpage + category list). */
export function describeRiotApiStatus(
  apiKeyHealth: ApiKeyHealthStatus | null,
  hasApiKey: boolean,
  proxyUrl: string | undefined
): { label: string; short: string; tone: M3ChipTone } {
  const proxyActive = Boolean(proxyUrl?.trim()) && !validateHttpsProxyUrl(proxyUrl ?? '');
  if (apiKeyHealth?.status === 'valid') return { label: 'Verified Active', short: 'Verified', tone: 'success' };
  if (apiKeyHealth?.status === 'expired')
    return { label: 'Key Rejected (401/403)', short: 'Key rejected', tone: 'error' };
  if (apiKeyHealth?.status === 'rate_limited')
    return { label: 'Rate Limited (429)', short: 'Rate limited', tone: 'warning' };
  if (proxyActive) return { label: 'HTTPS Proxy Configured', short: 'HTTPS proxy', tone: 'primary' };
  if (hasApiKey) return { label: 'Key Stored (Unverified)', short: 'Key stored', tone: 'plain' };
  return { label: 'No Key Saved', short: 'Keyless LCU', tone: 'warning' };
}

export const REGIONS = [
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

export const DIVISIONS = [
  'SILVER IV',
  'GOLD IV',
  'PLATINUM IV',
  'EMERALD IV',
  'DIAMOND IV',
  'MASTER',
];

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export interface AccountSettingsSectionProps {
  settings: UserSettings;
  draft: UserSettings;
  setDraft: (updater: (prev: UserSettings) => UserSettings) => void;
  patchVersion: string;
  catalogCounts: { champions: number; items: number };
  apiKeyHealth: ApiKeyHealthStatus | null;
  dirty: boolean;
  notify: SettingsNotifier;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string, counts?: { champions: number; items: number }) => void;
  onApiKeyHealthChanged: (health: ApiKeyHealthStatus) => void;
}

export function AccountSettingsSection({
  settings,
  draft,
  setDraft,
  patchVersion,
  catalogCounts,
  apiKeyHealth,
  dirty,
  notify,
  onSave,
  onDiscard,
  onSettingsChanged,
  onProfileLoaded,
  onPatchSynced,
  onApiKeyHealthChanged,
}: AccountSettingsSectionProps) {
  const ids = useId();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [profile, setProfile] = useState<SummonerProfileSummary | null>(null);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [syncingPatch, setSyncingPatch] = useState(false);
  const proxyValidationError = validateHttpsProxyUrl(draft.riotApiProxyUrl ?? '');
  const apiStatus = describeRiotApiStatus(apiKeyHealth, draft.hasApiKey, draft.riotApiProxyUrl);

  async function handleSaveApiKey() {
    notify.clear();
    if (!apiKeyInput.trim()) {
      notify.error('Enter a Riot Developer API key first.');
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
        notify.status(
          'Riot API Key stored in Windows Credential Manager (HTTPS Proxy URL is active, so live requests route through your proxy).'
        );
        return;
      }

      try {
        const health = await checkRiotApiKeyHealth(updated.region);
        onApiKeyHealthChanged(health);
        if (health.status === 'valid') {
          notify.status(`Riot API Key stored. ${health.message}`);
          const parts = updated.riotId.trim().split('#');
          if (parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.trim())) {
            void fetchSummonerProfile(updated.riotId.trim(), updated.region)
              .then((p) => {
                setProfile(p);
                onProfileLoaded(p);
              })
              .catch(() => {});
          }
        } else if (health.status === 'expired') {
          notify.status(
            'Riot API Key stored in Windows Credential Manager; verification returned 401/403 (see details below).'
          );
        } else {
          notify.error(
            `Riot API Key stored in Windows Credential Manager, but live probe failed: ${health.message}`
          );
        }
      } catch (probeErr) {
        notify.error(
          `Riot API Key stored in Windows Credential Manager, but verification check failed: ${
            probeErr instanceof Error ? probeErr.message : 'Unknown error'
          }`
        );
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to store Riot API key.');
    }
  }

  async function handleLookupProfile() {
    notify.clear();
    setSyncingProfile(true);
    try {
      const next = await fetchSummonerProfile(draft.riotId, draft.region);
      setProfile(next);
      onProfileLoaded(next);
      notify.status(`Synced profile: ${next.riotId} (${next.tier} ${next.rank}).`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to fetch Riot profile.');
    } finally {
      setSyncingProfile(false);
    }
  }

  async function handleSyncPatch() {
    notify.clear();
    setSyncingPatch(true);
    try {
      const patch = await syncDdragonPatch();
      const catalog = await syncFullDdragonCatalog(patch);
      const counts = {
        champions: Object.keys(catalog.championsById).length,
        items: Object.keys(catalog.itemsById).length,
      };
      onPatchSynced(catalog.patch, counts);
      notify.status(
        `Data Dragon synced to patch ${catalog.patch} (${counts.champions} champions, ${counts.items} items).`
      );
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to sync Data Dragon catalog.');
    } finally {
      setSyncingPatch(false);
    }
  }

  const riotIdId = `${ids}-riot-id`;
  const regionId = `${ids}-region`;
  const divisionId = `${ids}-division`;
  const installId = `${ids}-install`;
  const apiKeyId = `${ids}-api-key`;
  const proxyId = `${ids}-proxy`;
  const proxyHelpId = `${ids}-proxy-help`;

  return (
    <div className="space-y-3">
      <SettingsGroup
        title="Riot Account & Climb Target"
        description="Used for match-history sync and to scale benchmarks to your climb target."
      >
        <div className="px-2 pb-1 pt-2">
          <SettingsNotice tone="success">
            <strong>Keyless LCU Mode active:</strong> Open League of Legends for automatic Champ
            Select &amp; Live HUD coaching without an API key. Add a Riot API key below only for
            Match-V5 timeline history sync.
          </SettingsNotice>
        </div>

        <SettingsRow
          label="Riot ID (Name#Tag)"
          htmlFor={riotIdId}
          description="Exactly as shown in the League client."
        >
          <input
            id={riotIdId}
            type="text"
            value={draft.riotId}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((prev) => ({ ...prev, riotId: value }));
            }}
            placeholder="YourName#EUW"
            autoComplete="off"
            spellCheck={false}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-72')}
          />
        </SettingsRow>

        <SettingsRow
          label="Platform Region"
          htmlFor={regionId}
          description="Routes Match-V5 and League-V4 requests."
        >
          <select
            id={regionId}
            value={draft.region}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((prev) => ({ ...prev, region: value }));
            }}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-48')}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r} className="bg-zinc-900">
                {r}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow
          label="Target Division"
          htmlFor={divisionId}
          description="Benchmarks and LP goals are scaled to this target."
        >
          <select
            id={divisionId}
            value={draft.targetDivision}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((prev) => ({ ...prev, targetDivision: value }));
            }}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-48')}
          >
            {DIVISIONS.map((d) => (
              <option key={d} value={d} className="bg-zinc-900">
                {d}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow
          label="League Install Folder"
          htmlFor={installId}
          description="Needed for game.cfg (Replay API) and recording window detection."
          stacked
        >
          <input
            id={installId}
            type="text"
            value={draft.lolInstallPath}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((prev) => ({ ...prev, lolInstallPath: value }));
            }}
            spellCheck={false}
            className={cx(SETTINGS_FIELD_CLASS, 'font-mono text-[12px]')}
          />
        </SettingsRow>

        <SettingsRow
          label="Summoner Profile"
          description={
            profile
              ? 'Last synced from Riot League-V4 in this session.'
              : 'Fetch level, rank and LP for the Riot ID above (requires a key or HTTPS proxy).'
          }
        >
          <M3Button
            variant="tonal"
            size="sm"
            disabled={syncingProfile}
            icon={<UserRound aria-hidden className="h-4 w-4" />}
            onClick={() => void handleLookupProfile()}
          >
            {syncingProfile ? 'Syncing Profile...' : 'Sync Riot Profile'}
          </M3Button>
        </SettingsRow>
        {profile && (
          <div className="px-2 pb-2">
            <M3Card variant="module" className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="m3-title-m truncate text-[var(--md-sys-color-on-surface)]">
                  {profile.riotId}
                </div>
                <div className="m3-body-s m3-muted num">
                  {profile.region} · Level {profile.summonerLevel}
                </div>
              </div>
              <M3Chip
                tone="primary"
                size="sm"
                label={`${profile.tier} ${profile.rank} · ${profile.leaguePoints} LP`}
                className="num"
              />
              <span className="m3-body-s num text-[var(--md-sys-color-on-surface)]">
                {profile.wins}W {profile.losses}L
              </span>
            </M3Card>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Riot API Key & Data Dragon"
        description="Stored in Windows Credential Manager — never written to disk in plain text."
        aside={<M3Chip tone={apiStatus.tone} size="sm" label={apiStatus.label} />}
      >
        {apiKeyHealth && apiKeyHealth.status === 'expired' && (
          <div className="px-2 pb-1 pt-2">
            <SettingsNotice tone="error">{apiKeyHealth.message}</SettingsNotice>
          </div>
        )}

        <SettingsRow
          label="Personal Riot API Key (Windows Credential Manager)"
          htmlFor={apiKeyId}
          description="Development keys expire every 24 h; you are warned on 401/403."
          stacked
        >
          <div className="flex flex-wrap gap-2">
            <input
              id={apiKeyId}
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={draft.hasApiKey ? 'Key stored · paste a new key to replace' : 'RGAPI-xxxxxxxx-xxxx-...'}
              autoComplete="off"
              className={cx(SETTINGS_FIELD_CLASS, 'flex-1 basis-64 font-mono text-[12px]')}
            />
            <M3Button
              variant="tonal"
              size="sm"
              className="!h-10"
              icon={<KeyRound aria-hidden className="h-4 w-4" />}
              onClick={() => void handleSaveApiKey()}
            >
              Save &amp; Verify Key
            </M3Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Riot API Proxy URL (HTTPS)"
          htmlFor={proxyId}
          description="Optional zero-trust Cloudflare Worker relay."
          stacked
        >
          <input
            id={proxyId}
            type="url"
            value={draft.riotApiProxyUrl ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((prev) => ({ ...prev, riotApiProxyUrl: value }));
            }}
            aria-invalid={proxyValidationError ? true : undefined}
            aria-describedby={proxyHelpId}
            placeholder="https://betterjungler-riot-proxy.your-subdomain.workers.dev"
            spellCheck={false}
            className={cx(SETTINGS_FIELD_CLASS, 'font-mono text-[12px]')}
          />
          {proxyValidationError ? (
            <span
              id={proxyHelpId}
              role="alert"
              className="m3-body-s block text-[var(--md-sys-color-error)]"
            >
              {proxyValidationError}
            </span>
          ) : (
            <span id={proxyHelpId} className="m3-body-s m3-muted block">
              When set, Riot requests route over HTTPS with{' '}
              <code className="font-mono text-[var(--md-sys-color-on-surface)]">X-App-Client</code>{' '}
              instead of a personal key.
            </span>
          )}
        </SettingsRow>

        <SettingsRow
          label="Data Dragon Patch & Catalog"
          description={
            <span className="num">
              Patch {patchVersion} · {catalogCounts.champions} champions / {catalogCounts.items}{' '}
              items hydrated
            </span>
          }
        >
          <M3Chip tone="plain" size="sm" label={patchVersion} className="num !text-[var(--md-sys-color-on-surface)]" />
          <M3Button
            variant="outlined"
            size="sm"
            disabled={syncingPatch}
            icon={<RefreshCw aria-hidden className={cx('h-4 w-4', syncingPatch && 'animate-spin')} />}
            onClick={() => void handleSyncPatch()}
          >
            {syncingPatch ? 'Syncing...' : 'Sync Patch'}
          </M3Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saveLabel="Save Riot ID & Account Settings"
        disabled={Boolean(proxyValidationError)}
        onSave={() => void onSave()}
        onDiscard={onDiscard}
      />
    </div>
  );
}
