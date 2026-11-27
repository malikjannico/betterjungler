import { useMemo, useState } from 'react';
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
import { GlassSurface } from './GlassSurface';

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
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [packImportOpen, setPackImportOpen] = useState(false);
  const [packJsonInput, setPackJsonInput] = useState('');
  const [packBusy, setPackBusy] = useState(false);
  const [packMessage, setPackMessage] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const changelogEntries = useMemo(() => parseChangelog(changelogRaw), []);

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
    <GlassSurface className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            About &amp; Automatic Updates
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white">
            <span className="tabular-nums font-semibold">v{appMeta.version}</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-[11px] text-slate-400">
              build {appMeta.commitSha}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span>Update Mode</span>
            <select
              aria-label="Update Mode"
              value={updateMode}
              onChange={(e) => onUpdateModeChange(e.target.value as UpdateMode)}
              className="rounded-lg border border-white/10 bg-black/45 px-2 py-1 text-xs text-slate-100 outline-none"
            >
              <option value="manual" className="bg-zinc-900">
                Manual
              </option>
              <option value="install_on_quit" className="bg-zinc-900">
                Download &amp; Install on Quit
              </option>
            </select>
          </label>
          <button
            type="button"
            disabled={checkingUpdate || installingUpdate || stagingUpdate}
            onClick={() => void onCheckUpdate()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {checkingUpdate ? 'Checking...' : 'Check for Updates'}
          </button>
          <button
            type="button"
            aria-expanded={changelogOpen}
            onClick={() => setChangelogOpen((v) => !v)}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-slate-200"
          >
            {changelogOpen ? 'Hide Changelog' : 'View Changelog'}
          </button>
          <button
            type="button"
            disabled={!isTauri}
            onClick={() => void handleOpenLogs()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-slate-300 disabled:opacity-50"
          >
            Open Logs Folder
          </button>
        </div>
      </div>

      {stagedUpdateVersion && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-200">
          Staged v{stagedUpdateVersion} — installs on quit
        </div>
      )}

      {updateInfo && !updateInfo.available && (
        <div className="lg-inset px-3 py-2 text-[11px] text-slate-300">
          You are on the latest release (v{updateInfo.currentVersion}).
        </div>
      )}

      {updateInfo?.available && (
        <div className="lg-inset space-y-2.5 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-emerald-200">
              Update available: v{updateInfo.latestVersion}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  stagingUpdate ||
                  installingUpdate ||
                  stagedUpdateVersion === updateInfo.latestVersion
                }
                onClick={() => void onStageUpdate()}
                className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-slate-100 disabled:opacity-50"
              >
                {stagingUpdate
                  ? 'Staging...'
                  : stagedUpdateVersion === updateInfo.latestVersion
                    ? 'Staged for Quit'
                    : 'Stage for Quit'}
              </button>
              <button
                type="button"
                disabled={!canInstallUpdateSafely || installingUpdate}
                onClick={() => void onInstallUpdate()}
                className="lg-btn-glass px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"
              >
                {installingUpdate ? 'Installing...' : 'Install & Restart'}
              </button>
            </div>
          </div>
          {!canInstallUpdateSafely && (
            <p className="text-[11px] text-amber-300">
              Update installation is paused during Champ Select or an active match so gameplay is never interrupted.
            </p>
          )}
          {updateInfo.body && (
            <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-slate-300">
              {updateInfo.body}
            </pre>
          )}
        </div>
      )}

      {(updateError || logsError) && (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          {updateError ?? logsError}
        </p>
      )}

      {patchPackStatus && (
        <div className="lg-inset space-y-2.5 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-white">
                Signed Patch Pack (Ed25519) · {patchPackStatus.patch}
              </div>
              <div className="text-[11px] text-slate-400">
                Source: {patchPackStatus.source.replace('_', ' ')} · Dragon{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.dragonFirstSpawnSec)} · Grubs{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.voidgrubsSpawnSec)} · Baron{' '}
                {formatClock(patchPackStatus.payload.objectiveTimings.baronSpawnSec)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  patchPackStatus.verified
                    ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
                    : 'border-rose-400/35 bg-rose-500/15 text-rose-200'
                }`}
              >
                {patchPackStatus.verified ? 'Ed25519 Verified' : 'Unverified'}
              </span>
              {patchPackStatus.metaVerified && (
                <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-200">
                  Meta Pack Verified
                </span>
              )}
              {onInstallPatchPack && isTauri && (
                <button
                  type="button"
                  disabled={packBusy}
                  onClick={() => setPackImportOpen((prev) => !prev)}
                  className="lg-btn-glass px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  {packImportOpen ? 'Cancel' : 'Import Pack JSON'}
                </button>
              )}
            </div>
          </div>

          {patchPackStatus.fallbackReason && (
            <p className="text-[11px] text-amber-200">
              Fallback active: {patchPackStatus.fallbackReason}
            </p>
          )}
          {packMessage && <p className="text-[11px] text-emerald-300">{packMessage}</p>}
          {packError && (
            <p role="alert" className="text-[11px] text-rose-300">
              {packError}
            </p>
          )}

          {packImportOpen && (
            <div className="space-y-2 border-t border-white/[0.08] pt-2">
              <textarea
                aria-label="Signed Patch Pack JSON"
                rows={4}
                disabled={packBusy}
                value={packJsonInput}
                onChange={(e) => setPackJsonInput(e.target.value)}
                placeholder='Paste signed Ed25519 envelope JSON from `node scripts/sign-patch-pack.mjs`'
                className="w-full rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-slate-100 outline-none disabled:opacity-50"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={packBusy || !packJsonInput.trim()}
                  onClick={() => void handleInstallPack()}
                  className="lg-btn-primary px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                >
                  {packBusy ? 'Verifying Signature...' : 'Verify & Hot-Swap Pack'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {changelogOpen && (
        <div className="space-y-3 border-t border-white/[0.08] pt-3">
          {changelogEntries.map((entry) => (
            <div key={entry.version} className="lg-inset p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="tabular-nums font-semibold text-white">
                  v{entry.version}
                </span>
                {entry.date && (
                  <span className="tabular-nums text-[10px] text-slate-400">
                    {entry.date}
                  </span>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {entry.sections.map((section) => (
                  <div key={section.title}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {section.title}
                    </div>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-300">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassSurface>
  );
}
