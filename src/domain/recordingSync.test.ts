import { describe, expect, it } from 'vitest';
import {
  buildClipWindow,
  formatStorageBytes,
  gameTimeToVideoSeconds,
  resolveReplaySeekTarget,
  videoSecondsToGameTime,
} from './recordingSync';

describe('recordingSync', () => {
  it('converts bi-directionally between match game time and video timestamps within bounds', () => {
    expect(gameTimeToVideoSeconds(310, 4.2, 1850)).toBeCloseTo(314.2);
    expect(gameTimeToVideoSeconds(2000, 4.2, 1850)).toBe(1850);
    expect(videoSecondsToGameTime(314.2, 4.2, 1800)).toBe(310);
    expect(videoSecondsToGameTime(1, 4.2, 1800)).toBe(0);
  });

  it('builds bounded -12s..+6s clip windows and replay lead-in targets', () => {
    expect(buildClipWindow(6, 1800)).toEqual({
      startSec: 0,
      endSec: 12,
      gameTimeSec: 6,
    });
    expect(buildClipWindow(1798, 1800)).toEqual({
      startSec: 1786,
      endSec: 1800,
      gameTimeSec: 1798,
    });
    expect(resolveReplaySeekTarget(305)).toBe(297);
    expect(resolveReplaySeekTarget(4)).toBe(0);
  });

  it('formats storage sizes cleanly across MB and GB', () => {
    expect(formatStorageBytes(0)).toBe('0 MB');
    expect(formatStorageBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatStorageBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatStorageBytes(2.25 * 1024 * 1024 * 1024)).toBe('2.25 GB');
  });
});
