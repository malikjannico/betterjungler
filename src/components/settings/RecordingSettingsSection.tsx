import { useId, useState } from 'react';
import { Cpu, FolderOpen, Plug, RefreshCw } from 'lucide-react';
import { formatStorageBytes } from '../../domain/recordingSync';
import {
  DEFAULT_RECORDING_SETTINGS,
  openRecordingsFolder,
  probeHardwareEncoder,
  setReplayApiEnabled,
} from '../../services/tauriBridge';
import type {
  GameCfgReplayStatus,
  HardwareEncoderStatus,
  RecordingPreset,
  RecordingRecord,
  RecordingSettings,
  UserSettings,
} from '../../types/coaching';
import { M3Button, M3Chip, M3SegmentedButton, cx } from '../m3';
import {
  SEG_CONTRAST_CLASS,
  SETTINGS_FIELD_CLASS,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSaveBar,
  SettingsSwitch,
  type SettingsNotifier,
} from './AccountSettingsSection';

const MAX_STORAGE_GB = 50;

/** "NVENC" / "QSV" / "AMF" short label from the probed encoder name. */
export function shortEncoderLabel(status: HardwareEncoderStatus | null): string {
  if (!status) return 'Encoder unchecked';
  if (!status.hardwareAvailable) return 'Software only';
  const name = status.encoderNames[0] ?? '';
  if (/nvenc|nvidia/i.test(name)) return 'NVENC/Hardware';
  if (/qsv|quick\s*sync|intel/i.test(name)) return 'QSV/Hardware';
  if (/amf|amd|radeon/i.test(name)) return 'AMF/Hardware';
  return 'H.264/Hardware';
}

const PRESET_OPTIONS: ReadonlyArray<{ value: RecordingPreset; label: string; title: string }> = [
  { value: '720p30', label: '30fps · 3.5 Mbps', title: 'Native Window · Recommended' },
  { value: '1080p60', label: '60fps · 8 Mbps', title: 'Native Window · dGPU' },
  { value: 'clips_only', label: 'Clips Focus', title: '30fps · Keep Last 3 Games' },
];

export interface RecordingSettingsSectionProps {
  settings: UserSettings;
  draft: UserSettings;
  setDraft: (updater: (prev: UserSettings) => UserSettings) => void;
  isTauri: boolean;
  hwStatus: HardwareEncoderStatus | null;
  replayCfg: GameCfgReplayStatus | null;
  storedRecordings: RecordingRecord[];
  dirty: boolean;
  notify: SettingsNotifier;
  onHwStatusChanged: (status: HardwareEncoderStatus) => void;
  onReplayCfgChanged: (cfg: GameCfgReplayStatus) => void;
  onSettingsChanged: (next: UserSettings) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}

export function RecordingSettingsSection({
  settings,
  draft,
  setDraft,
  isTauri,
  hwStatus,
  replayCfg,
  storedRecordings,
  dirty,
  notify,
  onHwStatusChanged,
  onReplayCfgChanged,
  onSettingsChanged,
  onSave,
  onDiscard,
}: RecordingSettingsSectionProps) {
  const ids = useId();
  const [probing, setProbing] = useState(false);
  const [togglingReplay, setTogglingReplay] = useState(false);
  const rec = draft.recording ?? DEFAULT_RECORDING_SETTINGS;
  const totalUsedBytes = storedRecordings.reduce((acc, row) => acc + row.sizeBytes, 0);
  const quotaPct = Math.min(100, (totalUsedBytes / (rec.maxStorageGb * 1024 ** 3)) * 100);
  const sliderPct = ((rec.maxStorageGb - 1) / (MAX_STORAGE_GB - 1)) * 100;
  const replayEnabled = replayCfg?.replayApiEnabled ?? rec.replayApiEnabled;

  function patchRecording(patch: Partial<RecordingSettings>) {
    setDraft((prev) => ({
      ...prev,
      recording: { ...(prev.recording ?? DEFAULT_RECORDING_SETTINGS), ...patch },
    }));
  }

  async function handleReprobeHardware() {
    notify.clear();
    setProbing(true);
    try {
      const next = await probeHardwareEncoder();
      onHwStatusChanged(next);
      notify.status(next.message);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Hardware encoder probe failed.');
    } finally {
      setProbing(false);
    }
  }

  async function handleToggleReplayApi() {
    const nextEnable = !replayEnabled;
    setTogglingReplay(true);
    notify.clear();
    try {
      const cfg = await setReplayApiEnabled(nextEnable);
      onReplayCfgChanged(cfg);
      const baseRec = settings.recording ?? DEFAULT_RECORDING_SETTINGS;
      const nextSettingsRec = { ...baseRec, replayApiEnabled: cfg.replayApiEnabled };
      setDraft((prev) => ({
        ...prev,
        recording: {
          ...(prev.recording ?? DEFAULT_RECORDING_SETTINGS),
          replayApiEnabled: cfg.replayApiEnabled,
        },
      }));
      onSettingsChanged({ ...settings, recording: nextSettingsRec });
      notify.status(
        cfg.replayApiEnabled
          ? `Enabled EnableReplayApi=1 in game.cfg (backup saved as game.cfg.bak).`
          : `Disabled EnableReplayApi in game.cfg (backup saved as game.cfg.bak).`
      );
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update game.cfg.');
    } finally {
      setTogglingReplay(false);
    }
  }

  function handleOpenFolder() {
    void openRecordingsFolder().catch((err) => {
      notify.error(err instanceof Error ? err.message : 'Unable to open recordings folder.');
    });
  }

  const quotaId = `${ids}-quota`;
  const keepId = `${ids}-keep`;
  const encoderBlocked = isTauri && hwStatus !== null && !hwStatus.hardwareAvailable && !rec.enabled;

  return (
    <div className="space-y-3">
      <SettingsGroup
        title="GPU Encoder"
        description="Off by default · OS H.264 encoder (GPU probe) · League HWND only."
        aside={
          hwStatus ? (
            <M3Chip
              tone={hwStatus.hardwareAvailable ? 'success' : 'warning'}
              size="sm"
              icon={<Cpu aria-hidden />}
              label={shortEncoderLabel(hwStatus)}
            />
          ) : undefined
        }
      >
        <SettingsRow
          label={
            hwStatus
              ? hwStatus.hardwareAvailable
                ? `GPU Encoder Ready: ${hwStatus.encoderNames[0] ?? 'Hardware H.264'}`
                : 'Hardware GPU H.264 Encoder Not Detected'
              : 'GPU Encoder Probe'
          }
          description={hwStatus?.message ?? 'Checks NVENC / QSV (QuickSync) / AMF hardware capability.'}
        >
          <M3Button
            variant="outlined"
            size="sm"
            disabled={probing}
            icon={<RefreshCw aria-hidden className={cx('h-4 w-4', probing && 'animate-spin')} />}
            onClick={() => void handleReprobeHardware()}
          >
            {probing ? 'Probing...' : 'Re-check GPU'}
          </M3Button>
        </SettingsRow>
        {hwStatus?.leagueWindowMode === 'fullscreen' && (
          <div className="px-2 pb-2">
            <SettingsNotice tone="warning">
              League WindowMode=0 (Exclusive Fullscreen) detected. Switch to Borderless for optimal
              WGC capture and overlay visibility.
            </SettingsNotice>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Opt-In Gameplay Recording"
        description="Nothing is captured until you opt in. Captures the League window only."
        aside={
          <M3Chip
            tone={rec.enabled ? 'error' : 'plain'}
            size="sm"
            label={rec.enabled ? 'Recording enabled' : 'Off'}
            className={cx(!rec.enabled && '!text-[var(--md-sys-color-on-surface)]')}
          />
        }
      >
        <SettingsRow
          label="Enable GPU Gameplay Recording"
          description={
            encoderBlocked
              ? 'Unavailable: no hardware H.264 encoder detected on this PC.'
              : 'Records the League window with near-zero FPS impact.'
          }
        >
          <SettingsSwitch
            ariaLabel="Enable GPU Gameplay Recording"
            checked={rec.enabled}
            disabled={encoderBlocked}
            onChange={(enabled) => patchRecording({ enabled })}
          />
        </SettingsRow>

        <SettingsRow label="Quality Preset" description="Clips Focus keeps only the last 3 games." stacked>
          <M3SegmentedButton<RecordingPreset>
            ariaLabel="Recording Quality Preset"
            size="sm"
            className={SEG_CONTRAST_CLASS}
            options={PRESET_OPTIONS}
            value={rec.preset}
            onChange={(preset) => patchRecording({ preset })}
          />
        </SettingsRow>

        <SettingsRow
          label="Disk Quota (GB)"
          htmlFor={quotaId}
          description="Oldest recordings are pruned first once the cap is reached."
        >
          <div className="flex min-w-[240px] items-center gap-3">
            <input
              id={quotaId}
              type="range"
              aria-label="Recording Disk Quota GB"
              min={1}
              max={MAX_STORAGE_GB}
              value={rec.maxStorageGb}
              onChange={(e) =>
                patchRecording({
                  maxStorageGb: Math.min(MAX_STORAGE_GB, Math.max(1, Number(e.target.value) || 5)),
                })
              }
              style={{
                background: `linear-gradient(90deg, var(--md-sys-color-primary) 0 ${sliderPct}%, var(--md-sys-color-secondary-container) ${sliderPct}% 100%)`,
              }}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--md-sys-color-primary)]"
            />
            <output
              htmlFor={quotaId}
              className="m3-label-l w-14 text-right num text-[var(--md-sys-color-on-surface)]"
            >
              {rec.maxStorageGb} GB
            </output>
          </div>
        </SettingsRow>

        <SettingsRow label="Keep Last N Games" htmlFor={keepId} description="Maximum number of full recordings.">
          <input
            id={keepId}
            type="number"
            aria-label="Keep Last N Recordings"
            min={1}
            max={100}
            value={rec.keepLastNGames}
            onChange={(e) =>
              patchRecording({
                keepLastNGames: Math.min(100, Math.max(1, Number(e.target.value) || 10)),
              })
            }
            className={cx(SETTINGS_FIELD_CLASS, 'w-28 num')}
          />
        </SettingsRow>

        <SettingsRow
          label="Auto-record Ranked Solo/Duo only"
          description="Record Ranked Solo/Duo matches automatically (skip non-ranked modes)."
        >
          <SettingsSwitch
            ariaLabel="Auto-record Ranked Solo/Duo only"
            checked={rec.autoRecordRanked}
            onChange={(autoRecordRanked) => patchRecording({ autoRecordRanked })}
          />
        </SettingsRow>

        <SettingsRow
          label="Storage"
          description={
            <span className="num">
              {storedRecordings.length} saved ({formatStorageBytes(totalUsedBytes)}) of{' '}
              {rec.maxStorageGb} GB
            </span>
          }
        >
          <div
            role="meter"
            aria-label="Recording storage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(quotaPct)}
            className="h-2 w-32 overflow-hidden rounded-full bg-[var(--md-sys-color-secondary-container)]"
          >
            <div
              className={cx(
                'h-full rounded-full',
                quotaPct > 90 ? 'bg-[var(--md-ext-warning)]' : 'bg-[var(--md-sys-color-primary)]'
              )}
              style={{ width: `${quotaPct}%` }}
            />
          </div>
          <M3Button
            variant="outlined"
            size="sm"
            icon={<FolderOpen aria-hidden className="h-4 w-4" />}
            onClick={handleOpenFolder}
          >
            Open Recordings Folder
          </M3Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="League Replay API"
        aside={
          <M3Chip
            tone={replayEnabled ? 'success' : 'plain'}
            size="sm"
            label={replayEnabled ? 'game.cfg · Enabled' : 'game.cfg · Disabled'}
            className={cx(!replayEnabled && '!text-[var(--md-sys-color-on-surface)]')}
          />
        }
      >
        <SettingsRow
          label="Zero-Overhead Riot Replay API (127.0.0.1:2999)"
          description={
            replayCfg?.replayApiEnabled
              ? 'Enabled in League game.cfg (EnableReplayApi=1). One-click Seek works for .rofl replays.'
              : 'Disabled by default by Riot. Close League before toggling so game.cfg edits persist (.cfg.bak backup created).'
          }
        >
          <M3Button
            variant={replayCfg?.replayApiEnabled ? 'outlined' : 'tonal'}
            size="sm"
            disabled={togglingReplay}
            icon={<Plug aria-hidden className="h-4 w-4" />}
            onClick={() => void handleToggleReplayApi()}
          >
            {togglingReplay
              ? 'Updating game.cfg...'
              : replayCfg?.replayApiEnabled
                ? 'Disable Replay API'
                : 'Enable Replay API'}
          </M3Button>
        </SettingsRow>
        {replayCfg?.previewDiff && (
          <div className="px-4 pb-3">
            <pre className="overflow-x-auto rounded-[8px] bg-[var(--md-sys-color-surface-container-lowest)] px-3 py-2 font-mono text-[11px] text-[var(--md-sys-color-on-surface)]">
              {replayCfg.previewDiff}
            </pre>
          </div>
        )}
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saveLabel="Save Recording Settings"
        onSave={() => void onSave()}
        onDiscard={onDiscard}
      />
    </div>
  );
}
