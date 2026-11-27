import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInterpolatedGameTime } from './useInterpolatedGameTime';

describe('useInterpolatedGameTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances 1 second per tick between backend polls and snaps cleanly on updates', () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      ({ serverTime, active }) => useInterpolatedGameTime(serverTime, active),
      { initialProps: { serverTime: 100, active: true } }
    );

    expect(result.current).toBe(100);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(101);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(102);

    // Backend poll arrives with slightly corrected timestamp
    rerender({ serverTime: 101.8, active: true });
    expect(result.current).toBe(101.8);
  });

  it('pauses on backend poll stalls (>6s) and stops when match is inactive', () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(
      ({ serverTime, active }) => useInterpolatedGameTime(serverTime, active),
      { initialProps: { serverTime: 240, active: true } }
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current).toBe(246);

    rerender({ serverTime: 240, active: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(240);
  });
});
