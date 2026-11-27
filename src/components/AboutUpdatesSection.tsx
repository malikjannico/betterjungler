import { useId, useMemo, useState } from 'react';
import { CircleCheck, Download, FolderOpen, RefreshCw, ScrollText, ShieldCheck } from 'lucide-react';
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog } from '../domain/changelogParser';
import { formatClock } from '../domain/liveCoachEngine';
import { openLogsFolder } from '../services/tauriBridge';
import type {
  ActivePatchPackStatus,
  AppMetaInfo,
  UpdateCheckResult,
  UpdateMode,
} from '../types/coaching';
import { M3Button, M3Card, M3Chip, cx } from './m3';

interface AboutUpdatesSectionProps {
  appMeta: AppMetaInfo;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  stagingUpdate: boolean;
  stagedUpdateVersion: string | null;
  updateMode: UpdateMode;
  updateError: string | null;
  canInstallUpdateSafely: boolean;
  isTauri: boolean;
  patchPackStatus?: ActivePatchPackStatus | null;
  onUpdateModeChange: (mode: UpdateMode) => void;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onStageUpdate: () => Promise<void>;
  onInstallPatchPack?: (envelopeJson: string) => Promise<void>;
}

const FIELD_CLASS =
  'h-10 rounded-[8px] bg-[var(--md-sys-color-surface-container-highest)] px-3 text-[13px] text-[var(--md-sys-color-on-surface)] outline-none shadow-[inset_0_-1px_0_var(--md-sys-color-outline)] focus-visible:shadow-[inset_0_-2px_0_var(--md-sys-color-primary)]';

/** Category-list summary, e.g. "v2.0.0 · Up to date". */
export function describeUpdateStatus(
  version: string,
  updateInfo: UpdateCheckResult | null,
  stagedUpdateVersion: string | null
): { label: string; tone: 'success' | 'primary' | 'plain' } {
  if (stagedUpdateVersion) return { label: `v${version} · v${stagedUpdateVersion} staged`, tone: 'primary' };
  if (updateInfo?.available) return { label: `v${version} · v${updateInfo.latestVersion} available`, tone: 'primary' };
  if (updateInfo) return { label: `v${version} · Up to date`, tone: 'success' };
  return { label: `v${version} · Not checked`, tone: 'plain' };
}

export function AboutUpdatesSection({
  appMeta,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  stagingUpdate,
  stagedUpdateVersion,
  updateMode,
  updateError,
  canInstallUpdateSafely,
  isTauri,
  patchPackStatus,
  onUpdateModeChange,
  onCheckUpdate,
  onInstallUpdate,
  onStageUpdate,
  onInstallPatchPack,
}: AboutUpdatesSectionProps) {
  const ids = useId();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [packImportOpen, setPackImportOpen] = useState(false);
  const [packJsonInput, setPackJsonInput] = useState('');
  const [packBusy, setPackBusy] = useState(false);
  const [packMessage, setPackMessage] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const changelogEntries = useMemo(() => parseChangelog(changelogRaw), []);
  const changelogId = `${ids}-changelog`;

  async function handleInstallPack() {
    if (!onInstallPatchPack || !packJsonInput.trim() || packBusy) return;
    setPackBusy(true);
    setPackError(null);
    setPackMessage(null);
    try {
      await onInstallPatchPack(packJsonInput.trim());
      setPackMessage('Signed Ed25519 patch pack verified and hot-swapped.');
      setPackJsonInput('');
      setPackImportOpen(false);
    } catch (err) {
      setPackError(err instanceof Error ? err.message : 'Patch pack verification failed.');
    } finally {
      setPackBusy(false);
    }
  }

  async function handleOpenLogs() {
    setLogsError(null);
    try {
      await openLogsFolder();
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : 'Unable to open logs folder.');
    }
  }

  return (
    <div className="space-y-3">
      <M3Card as="section" variant="hero" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
              About &amp; Automatic Updates
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <M3Chip tone="primary" size="sm" className="num">
                <span className="tabular-nums font-semibold">v{appMeta.version}</span>
              </M3Chip>
              <span className="m3-body-s font-mono text-[var(--md-sys-color-on-surface)]">
                build {appMeta.commitSha}
              </span>
              {updateInfo && !updateInfo.available && !stagedUpdateVersion && (
                <M3Chip tone="success" size="sm" icon={<CircleCheck aria-hidden />} label="Up to date" />
              )}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <span className="m3-label-l text-[var(--md-sys-color-on-surface)]">Update Mode</span>
            <select
              aria-label="Update Mode"
              value={updateMode}
              onChange={(e) => onUpdateModeChange(e.target.value as UpdateMode)}
              className={FIELD_CLASS}
            >
              <option value="manual" className="bg-zinc-900">
                Manual
              </option>
              <option value="install_on_quit" className="bg-zinc-900">
                Download &amp; Install on Quit
              </option>
            </select>
          </label>
        </div>

        <p className="m3-body-s m3-muted max-w-[640px]">
          Install on Quit stages the update and applies it when you close the app — never mid-game.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <M3Button
            variant="tonal"
            size="sm"
            disabled={checkingUpdate || installingUpdate || stagingUpdate}
            icon={<RefreshCw aria-hidden className={cx('h-4 w-4', checkingUpdate && 'animate-spin')} />}
            onClick={() => void onCheckUpdate()}
          >
            {checkingUpdate ? 'Checking...' : 'Check for Updates'}
          </M3Button>
          <M3Button
            variant="outlined"
            size="sm"
            aria-expanded={changelogOpen}
            aria-controls={changelogId}
            icon={<ScrollText aria-hidden className="h-4 w-4" />}
            onClick={() => setChangelogOpen((v) => !v)}
          >
            {changelogOpen ? 'Hide Changelog' : 'View Changelog'}
          </M3Button>
          <M3Button
            variant="outlined"
            size="sm"
            disabled={!isTauri}
            icon={<FolderOpen aria-hidden className="h-4 w-4" />}
            onClick={() => void handleOpenLogs()}
          >
            Open Logs Folder
          </M3Button>
        </div>

        {stagedUpdateVersion && (
          <div className="rounded-[16px] bg-[var(--md-ext-success-container)] px-4 py-2.5 text-[13px] font-medium text-[var(--md-ext-on-success-container)]">
            Staged v{stagedUpdateVersion} — installs on quit
          </div>
        )}

        {updateInfo && !updateInfo.available && (
          <div className="rounded-[16px] bg-[var(--md-sys-color-surface-container-high)] px-4 py-2.5 text-[13px] text-[var(--md-sys-color-on-surface)]">
            You are on the latest release (v{updateInfo.currentVersion}).
          </div>
        )}

        {updateInfo?.available && (
          <M3Card variant="module" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="m3-title-s flex items-center gap-2 text-[var(--md-ext-success)]">
                <Download aria-hidden className="h-4 w-4" />
                Update available: v{updateInfo.latestVersion}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <M3Button
                  variant="tonal"
                  size="sm"
                  disabled={
                    stagingUpdate ||
                    installingUpdate ||
                    stagedUpdateVersion === updateInfo.latestVersion
                  }
                  onClick={() => void onStageUpdate()}
                >
                  {stagingUpdate
                    ? 'Staging...'
                    : stagedUpdateVersion === updateInfo.latestVersion
                      ? 'Staged for Quit'
                      : 'Stage for Quit'}
                </M3Button>
                <M3Button
                  variant="filled"
                  size="sm"
                  disabled={!canInstallUpdateSafely || installingUpdate}
                  onClick={() => void onInstallUpdate()}
                >
                  {installingUpdate ? 'Installing...' : 'Install & Restart'}
                </M3Button>
              </div>
            </div>
            {!canInstallUpdateSafely && (
              <p className="m3-body-s text-[var(--md-ext-warning)]">
                Update installation is paused during Champ Select or an active match so gameplay is never interrupted.
              </p>
            )}
            {updateInfo.body && (
              <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-[var(--md-sys-color-on-surface)]">
                {updateInfo.body}
              </pre>
            )}
          </M3Card>
        )}

        {(updateError || logsError) && (
          <p
            role="alert"
            className="rounded-[16px] bg-[var(--md-sys-color-error-container)] px-4 py-2.5 text-[13px] text-[var(--md-sys-color-on-error-container)]"
          >
            {updateError ?? logsError}
          </p>
        )}
      </M3Card>

      {patchPackStatus && (
        <M3Card as="section" variant="hero" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
                Signed Patch Pack (Ed25519) · {patchPackStatus.patch}
              </h3>
              <div className="m3-body-s m3-muted num">
                Source: {patchPackStatus.source.replace('_', ' ')} · Dragon{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.dragonFirstSpawnSec)} · Grubs{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.voidgrubsSpawnSec)} · Baron{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.baronSpawnSec)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <M3Chip
                tone={patchPackStatus.verified ? 'success' : 'error'}
                size="sm"
                icon={<ShieldCheck aria-hidden />}
                label={patchPackStatus.verified ? 'Ed25519 Verified' : 'Unverified'}
              />
              {patchPackStatus.metaVerified && (
                <M3Chip tone="primary" size="sm" label="Meta Pack Verified" />
              )}
              {onInstallPatchPack && isTauri && (
                <M3Button
                  variant="outlined"
                  size="sm"
                  disabled={packBusy}
                  onClick={() => setPackImportOpen((prev) => !prev)}
                >
                  {packImportOpen ? 'Cancel' : 'Import Pack JSON'}
                </M3Button>
              )}
            </div>
          </div>

          {patchPackStatus.fallbackReason && (
            <p className="m3-body-s text-[var(--md-ext-warning)]">
              Fallback active: {patchPackStatus.fallbackReason}
            </p>
          )}
          {packMessage && <p className="m3-body-s text-[var(--md-ext-success)]">{packMessage}</p>}
          {packError && (
            <p role="alert" className="m3-body-s text-[var(--md-sys-color-error)]">
              {packError}
            </p>
          )}

          {packImportOpen && (
            <div className="space-y-2 border-t border-[var(--md-sys-color-outline-variant)] pt-2.5">
              <textarea
                aria-label="Signed Patch Pack JSON"
                rows={4}
                disabled={packBusy}
                value={packJsonInput}
                onChange={(e) => setPackJsonInput(e.target.value)}
                placeholder='Paste signed Ed25519 envelope JSON from `node scripts/sign-patch-pack.mjs`'
                className="w-full rounded-[12px] bg-[var(--md-sys-color-surface-container-lowest)] p-3 font-mono text-[12px] text-[var(--md-sys-color-on-surface)] outline-none shadow-[inset_0_0_0_1px_var(--md-sys-color-outline-variant)] focus-visible:shadow-[inset_0_0_0_2px_var(--md-sys-color-primary)] disabled:opacity-50"
              />
              <div className="flex justify-end">
                <M3Button
                  variant="filled"
                  size="sm"
                  disabled={packBusy || !packJsonInput.trim()}
                  onClick={() => void handleInstallPack()}
                >
                  {packBusy ? 'Verifying Signature...' : 'Verify & Hot-Swap Pack'}
                </M3Button>
              </div>
            </div>
          )}
        </M3Card>
      )}

      {changelogOpen && (
        <M3Card as="section" variant="hero" id={changelogId} className="space-y-2.5">
          <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">Changelog</h3>
          {changelogEntries.map((entry) => (
            <M3Card key={entry.version} variant="module" as="article">
              <div className="flex items-center justify-between gap-2">
                <span className="m3-title-s tabular-nums text-[var(--md-sys-color-on-surface)]">
                  v{entry.version}
                </span>
                {entry.date && (
                  <span className="m3-body-s tabular-nums text-[var(--md-sys-color-on-surface)]">
                    {entry.date}
                  </span>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {entry.sections.map((section) => (
                  <div key={section.title}>
                    <div className="m3-label-m uppercase tracking-wider text-[var(--md-sys-color-primary)]">
                      {section.title}
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-[var(--md-sys-color-on-surface)]">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </M3Card>
          ))}
        </M3Card>
      )}
    </div>
  );
}
