import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAiResponseCache,
  getCachedAiResponse,
  setCachedAiResponse,
} from './aiResponseCache';

describe('aiResponseCache', () => {
  beforeEach(() => {
    clearAiResponseCache();
  });

  it('caches and retrieves verified entries keyed by kind, target, provider, and model', () => {
    setCachedAiResponse('post_game', 'EUW1_123', 'gemini', 'gemini-3.8-flash', {
      text: 'Cached debrief for match 123.',
      verified: true,
    });

    expect(
      getCachedAiResponse('post_game', 'EUW1_123', 'gemini', 'gemini-3.8-flash')?.text
    ).toBe('Cached debrief for match 123.');
    expect(
      getCachedAiResponse('post_game', 'EUW1_123', 'gemini', 'gemini-4-hydrogen')
    ).toBeNull();
    expect(
      getCachedAiResponse('post_game', 'EUW1_123', 'off', 'gemini-3.8-flash')
    ).toBeNull();
  });

  it('ignores unverified responses and caps storage at 30 entries', () => {
    setCachedAiResponse('win_con', 'plan-1', 'gemini', 'gemini-3.8-flash', {
      text: 'Should not cache unverified',
      verified: false,
    });
    expect(getCachedAiResponse('win_con', 'plan-1', 'gemini', 'gemini-3.8-flash')).toBeNull();

    for (let i = 0; i < 35; i++) {
      setCachedAiResponse('post_game', `EUW1_${i}`, 'gemini', 'gemini-3.8-flash', {
        text: `Debrief ${i}`,
        verified: true,
        cachedAt: `2026-11-27T12:${String(i).padStart(2, '0')}:00Z`,
      });
    }

    expect(getCachedAiResponse('post_game', 'EUW1_0', 'gemini', 'gemini-3.8-flash')).toBeNull();
    expect(getCachedAiResponse('post_game', 'EUW1_34', 'gemini', 'gemini-3.8-flash')?.text).toBe(
      'Debrief 34'
    );
  });

  it('handles corrupted localStorage JSON safely', () => {
    localStorage.setItem('betterjungler.ai_cache.v1', '{not valid json');
    expect(
      getCachedAiResponse('post_game', 'EUW1_123', 'gemini', 'gemini-3.8-flash')
    ).toBeNull();
  });
});
