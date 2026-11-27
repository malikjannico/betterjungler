export function gameTimeToVideoSeconds(
  gameTimeSec: number,
  syncOffsetSec: number,
  videoDurationSec?: number
): number {
  if (!Number.isFinite(gameTimeSec)) return 0;
  const offset = Number.isFinite(syncOffsetSec) ? syncOffsetSec : 0;
  const raw = Math.max(0, gameTimeSec + offset);
  if (videoDurationSec !== undefined && Number.isFinite(videoDurationSec) && videoDurationSec > 0) {
    return Math.min(raw, videoDurationSec);
  }
  return raw;
}

export function videoSecondsToGameTime(
  videoSec: number,
  syncOffsetSec: number,
  matchDurationSec?: number
): number {
  if (!Number.isFinite(videoSec)) return 0;
  const offset = Number.isFinite(syncOffsetSec) ? syncOffsetSec : 0;
  const raw = Math.max(0, Math.round(videoSec - offset));
  if (matchDurationSec !== undefined && Number.isFinite(matchDurationSec) && matchDurationSec > 0) {
    return Math.min(raw, matchDurationSec);
  }
  return raw;
}

export function buildClipWindow(
  gameTimeSec: number,
  matchDurationSec?: number
): { startSec: number; endSec: number; gameTimeSec: number } {
  const clean = Number.isFinite(gameTimeSec) ? Math.max(0, Math.round(gameTimeSec)) : 0;
  const startSec = Math.max(0, clean - 12);
  const rawEnd = clean + 6;
  const endSec =
    matchDurationSec !== undefined && Number.isFinite(matchDurationSec) && matchDurationSec > 0
      ? Math.min(rawEnd, matchDurationSec)
      : rawEnd;
  return { startSec, endSec, gameTimeSec: clean };
}

export function resolveReplaySeekTarget(gameTimeSec: number, leadInSec = 8): number {
  if (!Number.isFinite(gameTimeSec)) return 0;
  const lead = Number.isFinite(leadInSec) ? Math.max(0, leadInSec) : 0;
  return Math.max(0, Math.round(gameTimeSec - lead));
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(2)} GB`;
}
