import { BookmarkPlus, ExternalLink, Film, Pin, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../domain/liveCoachEngine';
import {
  formatStorageBytes,
  gameTimeToVideoSeconds,
  resolveReplaySeekTarget,
  videoSecondsToGameTime,
} from '../domain/recordingSync';
import {
  deleteRecording,
  deleteRecordingClip,
  getMatchRecording,
  saveRecordingClip,
  seekRiotReplay,
  toAssetUrl,
  toggleRecordingPin,
} from '../services/tauriBridge';
import type { MatchRecordingBundle, RecordingClipRecord } from '../types/coaching';
import { GlassSurface } from './GlassSurface';

interface RecordingPlayerCardProps {
  matchId: string;
  durationSeconds: number;
  activeSecond: number;
  isTauri: boolean;
  initialBundle?: MatchRecordingBundle | null;
  onSelectSecond: (second: number) => void;
  onOpenSettings?: () => void;
}

export function RecordingPlayerCard({
  matchId,
  durationSeconds,
  activeSecond,
  isTauri,
  initialBundle = null,
  onSelectSecond,
  onOpenSettings,
}: RecordingPlayerCardProps) {
  const [bundle, setBundle] = useState<MatchRecordingBundle | null>(initialBundle);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mountedRef = useRef(true);
  const activeMatchRef = useRef(matchId);
  const pendingSeekTargetRef = useRef<number | null>(null);
  const lastEmitAtRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeMatchRef.current = matchId;
    setBundle(initialBundle);
    setConfirmDelete(false);
    setNotice(null);
    pendingSeekTargetRef.current = null;
    if (!isTauri && !initialBundle) {
      return;
    }
    let cancelled = false;
    if (isTauri) {
      void getMatchRecording(matchId)
        .then((next) => {
          if (!cancelled && mountedRef.current && activeMatchRef.current === matchId) {
            setBundle(next);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [matchId, isTauri, initialBundle]);

  const recording =
    bundle?.recording && bundle.recording.status === 'ready' ? bundle.recording : null;

  useEffect(() => {
    if (!recording?.filePath) {
      setAssetUrl(null);
      return;
    }
    let cancelled = false;
    void toAssetUrl(recording.filePath)
      .then((src) => {
        if (!cancelled && mountedRef.current) setAssetUrl(src);
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setAssetUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [recording?.filePath]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !recording || !assetUrl || video.readyState < 1) return;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : recording.durationSec;
    const targetVideoSec = gameTimeToVideoSeconds(
      activeSecond,
      recording.syncOffsetSec,
      duration
    );
    if (Math.abs(video.currentTime - targetVideoSec) > 1.25) {
      pendingSeekTargetRef.current = targetVideoSec;
      video.currentTime = targetVideoSec;
    }
  }, [activeSecond, recording, assetUrl]);

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video || !recording) return;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : recording.durationSec;
    const targetVideoSec = gameTimeToVideoSeconds(
      activeSecond,
      recording.syncOffsetSec,
      duration
    );
    if (Math.abs(video.currentTime - targetVideoSec) > 0.75) {
      pendingSeekTargetRef.current = targetVideoSec;
      video.currentTime = targetVideoSec;
    }
  }

  function handleVideoTimeUpdate() {
    const video = videoRef.current;
    if (!video || !recording || video.readyState < 1) return;
    if (
      pendingSeekTargetRef.current !== null &&
      Math.abs(video.currentTime - pendingSeekTargetRef.current) > 0.8
    ) {
      return;
    }
    pendingSeekTargetRef.current = null;

    const now = Date.now();
    if (now - lastEmitAtRef.current < 300) return;
    lastEmitAtRef.current = now;
    const mappedGameSec = videoSecondsToGameTime(
      video.currentTime,
      recording.syncOffsetSec,
      durationSeconds
    );
    if (Math.abs(mappedGameSec - activeSecond) >= 2) {
      onSelectSecond(mappedGameSec);
    }
  }

  async function handleSaveClip() {
    if (!recording) return;
    const reqMatch = matchId;
    setBusyAction('clip');
    setNotice(null);
    try {
      const label = `Moment @ ${formatClock(activeSecond)}`;
      const saved = await saveRecordingClip(
        recording.id,
        matchId,
        label,
        'bookmark',
        activeSecond
      );
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setBundle((prev) =>
        prev
          ? { ...prev, clips: [...prev.clips, saved].sort((a, b) => a.gameTimeSec - b.gameTimeSec) }
          : prev
      );
      setNotice(`Saved clip "${saved.label}" (-12s/+6s).`);
    } catch (err) {
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setNotice(err instanceof Error ? err.message : 'Unable to save clip bookmark.');
    } finally {
      if (mountedRef.current && activeMatchRef.current === reqMatch) {
        setBusyAction(null);
      }
    }
  }

  async function handleTogglePin() {
    if (!recording) return;
    const reqMatch = matchId;
    setBusyAction('pin');
    setNotice(null);
    try {
      const updated = await toggleRecordingPin(recording.id, !recording.pinned);
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      if (updated) {
        setBundle((prev) => (prev ? { ...prev, recording: updated } : prev));
        setNotice(
          updated.pinned ? 'Recording pinned (exempt from storage cap).' : 'Recording unpinned.'
        );
      }
    } catch (err) {
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setNotice(err instanceof Error ? err.message : 'Unable to update pin state.');
    } finally {
      if (mountedRef.current && activeMatchRef.current === reqMatch) {
        setBusyAction(null);
      }
    }
  }

  async function handleDeleteRecording() {
    if (!recording) return;
    const reqMatch = matchId;
    const prevAssetUrl = assetUrl;
    setBusyAction('delete');
    setNotice(null);
    // Pause & unload <video> first so WebView2 releases Windows file lock before fs::remove_file
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    setAssetUrl(null);
    if (prevAssetUrl) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    try {
      await deleteRecording(recording.id);
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setBundle((prev) => (prev ? { ...prev, recording: null, clips: [] } : prev));
      setConfirmDelete(false);
      setNotice('Recording deleted from disk.');
    } catch (err) {
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      if (prevAssetUrl) setAssetUrl(prevAssetUrl);
      setNotice(err instanceof Error ? err.message : 'Unable to delete recording.');
    } finally {
      if (mountedRef.current && activeMatchRef.current === reqMatch) {
        setBusyAction(null);
      }
    }
  }

  async function handleDeleteClip(clip: RecordingClipRecord) {
    const reqMatch = matchId;
    setBusyAction(`del-${clip.id}`);
    try {
      await deleteRecordingClip(clip.id);
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setBundle((prev) =>
        prev ? { ...prev, clips: prev.clips.filter((c) => c.id !== clip.id) } : prev
      );
    } catch (err) {
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setNotice(err instanceof Error ? err.message : 'Unable to remove clip.');
    } finally {
      if (mountedRef.current && activeMatchRef.current === reqMatch) {
        setBusyAction(null);
      }
    }
  }

  async function handleReplaySeek() {
    const reqMatch = matchId;
    setBusyAction('replay');
    setNotice(null);
    try {
      const target = resolveReplaySeekTarget(activeSecond);
      const res = await seekRiotReplay(matchId, target, true);
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setNotice(res.message);
    } catch (err) {
      if (!mountedRef.current || activeMatchRef.current !== reqMatch) return;
      setNotice(err instanceof Error ? err.message : 'Unable to reach Riot Replay client.');
    } finally {
      if (mountedRef.current && activeMatchRef.current === reqMatch) {
        setBusyAction(null);
      }
    }
  }

  const hasReplayFallback = Boolean(bundle?.rofl || bundle?.replayApiConnected);

  if (!recording) {
    return (
      <GlassSurface className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5 text-xs">
          <Film className="h-4 w-4 shrink-0 text-white/[0.45]" />
          <div>
            <span className="font-medium text-white/[0.85]">
              No gameplay recording saved for this match
            </span>
            <span className="ml-2 text-white/[0.52]">
              {bundle?.rofl
                ? `${bundle.rofl.fileName} detected in LoL Replays.`
                : 'Gameplay capture is opt-in (off by default).'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasReplayFallback && (
            <button
              type="button"
              disabled={busyAction === 'replay'}
              onClick={() => void handleReplaySeek()}
              className="lg-btn-glass inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {bundle?.replayApiConnected
                ? `Seek LoL Replay @ ${formatClock(resolveReplaySeekTarget(activeSecond))}`
                : `Open in LoL Replay @ ${formatClock(resolveReplaySeekTarget(activeSecond))}`}
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white/[0.85]"
            >
              Recording Settings
            </button>
          )}
        </div>
        {notice && <p className="t-caption w-full text-amber-200">{notice}</p>}
      </GlassSurface>
    );
  }

  return (
    <GlassSurface className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Film className="h-4 w-4 text-emerald-300" />
          <span className="font-semibold text-white/[0.92]">Match Recording</span>
          <span className="tabular-nums text-white/[0.55]">
            {recording.height}p{recording.fps} · {formatStorageBytes(recording.sizeBytes)} · Synced{' '}
            {formatClock(activeSecond)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleSaveClip()}
            className="lg-btn-glass inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            Save -12s/+6s Clip
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => void handleTogglePin()}
            aria-pressed={recording.pinned}
            className={`lg-btn-glass inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
              recording.pinned ? 'border-amber-400/45 text-amber-200' : 'text-white/[0.8]'
            }`}
          >
            <Pin className="h-3.5 w-3.5" />
            {recording.pinned ? 'Pinned' : 'Pin'}
          </button>
          {hasReplayFallback && (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleReplaySeek()}
              className="lg-btn-glass inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white/[0.85] disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              LoL Replay
            </button>
          )}
          {!confirmDelete ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => setConfirmDelete(true)}
              className="lg-btn-glass inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-200 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ) : (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleDeleteRecording()}
              className="rounded-[7px] border border-rose-400/45 bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-100 disabled:opacity-50"
            >
              Confirm Delete
            </button>
          )}
        </div>
      </div>

      {assetUrl && (
        <div className="overflow-hidden rounded-[8px] border border-white/[0.08] bg-black">
          <video
            ref={videoRef}
            src={assetUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onSeeked={() => {
              pendingSeekTargetRef.current = null;
            }}
            onTimeUpdate={handleVideoTimeUpdate}
            className="max-h-[340px] w-full"
          />
        </div>
      )}

      {bundle && bundle.clips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="t-caption mr-1 text-white/[0.52]">Clips:</span>
          {bundle.clips.map((clip) => (
            <div
              key={clip.id}
              className="inline-flex items-center rounded-[7px] border border-white/[0.1] bg-white/[0.04] text-xs"
            >
              <button
                type="button"
                onClick={() => onSelectSecond(Math.round(clip.startSec))}
                className="px-2.5 py-1 text-white/[0.85] hover:text-white"
              >
                {clip.label} ({formatClock(clip.startSec)})
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                aria-label={`Remove clip ${clip.label}`}
                onClick={() => void handleDeleteClip(clip)}
                className="border-l border-white/[0.08] px-1.5 py-1 text-white/[0.45] hover:text-rose-200 disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {notice && <p className="t-caption text-emerald-200">{notice}</p>}
    </GlassSurface>
  );
}
