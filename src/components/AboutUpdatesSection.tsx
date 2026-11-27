import { useMemo, useState } from 'react';
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog } from '../domain/changelogParser';
import { openLogsFolder } from '../services/tauriBridge';
import type { AppMetaInfo, UpdateCheckResult } from '../types/coaching';
import { GlassSurface } from './GlassSurface';

interface AboutUpdatesSectionProps {
  appMeta: AppMetaInfo;
  updateInfo: UpdateCheckResult | null;
  checkingUpdate: boolean;
  installingUpdate: boolean;
  updateError: string | null;
  canInstallUpdateSafely: boolean;
  isTauri: boolean;
  onCheckUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
}

export function AboutUpdatesSection({
  appMeta,
  updateInfo,
  checkingUpdate,
  installingUpdate,
  updateError,
  canInstallUpdateSafely,
  isTauri,
  onCheckUpdate,
  onInstallUpdate,
}: AboutUpdatesSectionProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const changelogEntries = useMemo(() => parseChangelog(changelogRaw), []);

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
          <button
            type="button"
            disabled={checkingUpdate || installingUpdate}
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
            <button
              type="button"
              disabled={!canInstallUpdateSafely || installingUpdate}
              onClick={() => void onInstallUpdate()}
              className="lg-btn-glass px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"
            >
              {installingUpdate ? 'Installing...' : 'Install & Restart'}
            </button>
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
