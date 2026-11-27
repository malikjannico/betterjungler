import { useEffect, useState } from 'react';

const STALL_PAUSE_MS = 6000;

/**
 * Smoothly advances the in-game match clock at 1-second cadence between backend polls,
 * snapping to authoritative Live Client timestamps and pausing automatically on stalls.
 */
export function useInterpolatedGameTime(
  serverGameTimeSeconds: number,
  isLiveActive: boolean
): number {
  const [anchor, setAnchor] = useState<{ serverTime: number; capturedAt: number }>(() => ({
    serverTime: serverGameTimeSeconds,
    capturedAt: Date.now(),
  }));
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const now = Date.now();
    setAnchor({ serverTime: serverGameTimeSeconds, capturedAt: now });
    setNowMs(now);
  }, [serverGameTimeSeconds, isLiveActive]);

  useEffect(() => {
    if (!isLiveActive) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLiveActive]);

  if (!isLiveActive) {
    return serverGameTimeSeconds;
  }

  const elapsedMs = Math.max(0, Math.min(STALL_PAUSE_MS, nowMs - anchor.capturedAt));
  return anchor.serverTime + Math.floor(elapsedMs / 1000);
}
