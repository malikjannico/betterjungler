import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAiResponseCache,
  hashAiContext,
  setCachedAiResponse,
} from '../domain/aiResponseCache';
import { formatClock } from '../domain/liveCoachEngine';
import { DEMO_POST_GAME_MATCHES } from '../domain/postGameFixtures';
import { analyzePostGameMatch } from '../domain/postGameReviewEngine';
import { ADC_FIXTURE_JINX_CARRY_WIN } from '../domain/adc/adcFixtures';
import * as tauriBridge from '../services/tauriBridge';
import { PostGameReviewView } from './PostGameReviewView';

function buildMatchCacheKey(
  match: (typeof DEMO_POST_GAME_MATCHES)[number],
  targetDivision: string
): string {
  const report = analyzePostGameMatch(match, targetDivision);
  const ctx = JSON.stringify({
    champion: report.championName,
    enemyJungler: report.enemyJunglerName,
    duration: formatClock(report.durationSeconds),
    win: report.win,
    grade: report.grade,
    targetDivision,
    kpis: report.kpis,
    highlights: report.highlights.map((h) => h.title),
    mistakes: report.mistakes.map((m) => m.title),
    improvements: report.improvements.map((imp) => imp.title),
  });
  return `${match.matchId}:${hashAiContext(ctx)}`;
}

describe('PostGameReviewView stacked match cards, ADC grading & role normalization', () => {
  beforeEach(() => {
    clearAiResponseCache();
  });

  it('lists stacked match cards without tabs, opens per-game detail subpages, evaluates ADC, and keeps Top/Mid/Support off-role ungraded', () => {
    const jgMatch = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      championId: 62,
      championName: 'MonkeyKing',
      enemyJunglerChampionId: 121,
      enemyJunglerName: 'Khazix',
      role: 'JUNGLE',
    };
    const adcMatch = {
      ...ADC_FIXTURE_JINX_CARRY_WIN,
      matchId: 'EUW1_ADC_TEST',
    };
    const topOffRoleMatch = {
      ...DEMO_POST_GAME_MATCHES[1]!,
      matchId: 'EUW1_TOP_OFFROLE',
      championId: 266,
      championName: 'Aatrox',
      role: 'TOP',
    };

    render(
      <PostGameReviewView
        matches={[jgMatch, adcMatch, topOffRoleMatch]}
        targetDivision="PLATINUM IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'off',
          model: 'gemini-2.5-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: false,
        }}
        canSyncLive={false}
        isTauri={false}
        onSyncMatches={vi.fn(async () => {})}
      />
    );

    // No horizontal match or section tabs on mount — stacked match list with normalized champion names
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    const list = screen.getByRole('list', { name: 'Match history' });
    expect(list).toBeInTheDocument();
    const jgCard = screen.getByRole('button', { name: /Open Wukong, vs Kha'Zix/i });
    expect(jgCard).toBeInTheDocument();

    // Open Jungle detail page -> renders KPIs, RiftMap timeline slider, and "← All Matches"
    fireEvent.click(jgCard);
    expect(screen.getByRole('heading', { name: "Wukong vs Kha'Zix" })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Inspect match timeline minute' })).toBeInTheDocument();

    // Return to match list and open graded ADC detail page (Jinx vs Ezreal)
    fireEvent.click(screen.getByRole('button', { name: /Back to all matches/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open Jinx, vs Ezreal/i }));
    expect(screen.getByRole('heading', { name: 'Jinx vs Ezreal' })).toBeInTheDocument();
    expect(screen.getByText(/Provisional Benchmark/i)).toBeInTheDocument();
    expect(screen.getByText(/Lane Gold Diff @15/i)).toBeInTheDocument();

    // Return to match list and open Top off-role card -> ungraded scoreboard only, no AI Debrief
    fireEvent.click(screen.getByRole('button', { name: /Back to all matches/i }));
    fireEvent.click(screen.getByRole('button', { name: /Open Aatrox/i }));
    expect(screen.getByText(/Off-role game \(Top\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate AI Coach Debrief' })).not.toBeInTheDocument();
  });

  it('excludes the selected match from its personal EWM baseline comparison', () => {
    const baseClean = DEMO_POST_GAME_MATCHES[0]!;
    const outlierSelected = {
      ...baseClean,
      matchId: 'EUW1_OUTLIER_NEW',
      playedAt: '2026-11-27T18:00:00Z',
      durationSeconds: 1800,
      cs: 90,
    };
    const priorGames = Array.from({ length: 3 }, (_, idx) => ({
      ...baseClean,
      matchId: `EUW1_PRIOR_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, 10 + idx, 0, 0)).toISOString(),
      durationSeconds: 1800,
      cs: 216,
    }));

    render(
      <PostGameReviewView
        matches={[outlierSelected, ...priorGames]}
        targetDivision="PLATINUM IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'off',
          model: 'gemini-2.5-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: false,
        }}
        canSyncLive={false}
        isTauri={false}
        onSyncMatches={vi.fn(async () => {})}
      />
    );

    const listButtons = screen.getByRole('list', { name: 'Match history' }).querySelectorAll('button');
    fireEvent.click(listButtons[0]!);

    const baselineLine = screen.getByText(/vs Personal EWM Baseline:/i).textContent ?? '';
    expect(baselineLine).toContain('6.8 CS/min');
  });

  it('hydrates cached AI debrief without duplicate IPC calls, ignores stale cache on targetDivision change, and updates cache on Regenerate', async () => {
    const match = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      role: 'JUNGLE',
    };
    const platKey = buildMatchCacheKey(match, 'PLATINUM IV');
    setCachedAiResponse('post_game', platKey, 'gemini', 'gemini-3.8-flash', {
      text: 'Cached debrief: chain 1 Control Ward before Dragon setups.',
      verified: true,
    });

    const spyDebrief = vi
      .spyOn(tauriBridge, 'generateAiDebrief')
      .mockResolvedValueOnce('Fresh debrief: contest with 1 Control Ward ready.');

    const { rerender } = render(
      <PostGameReviewView
        matches={[match]}
        targetDivision="PLATINUM IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: true,
        }}
        canSyncLive={false}
        isTauri
        onSyncMatches={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Open Viego, vs Nocturne/i }));
    expect(
      screen.getByText('Cached debrief: chain 1 Control Ward before Dragon setups.')
    ).toBeInTheDocument();
    expect(screen.getByText('Telemetry Numbers Checked')).toBeInTheDocument();
    expect(screen.getByText('Cached')).toBeInTheDocument();
    expect(spyDebrief).not.toHaveBeenCalled();

    rerender(
      <PostGameReviewView
        matches={[match]}
        targetDivision="GOLD IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: true,
        }}
        canSyncLive={false}
        isTauri
        onSyncMatches={vi.fn(async () => {})}
      />
    );
    expect(
      screen.queryByText('Cached debrief: chain 1 Control Ward before Dragon setups.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate AI Coach Debrief' })).toBeInTheDocument();

    rerender(
      <PostGameReviewView
        matches={[match]}
        targetDivision="PLATINUM IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: true,
        }}
        canSyncLive={false}
        isTauri
        onSyncMatches={vi.fn(async () => {})}
      />
    );

    const regenBtn = screen.getByRole('button', { name: 'Regenerate AI Debrief' });
    await act(async () => {
      fireEvent.click(regenBtn);
      await Promise.resolve();
    });

    expect(spyDebrief).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText('Fresh debrief: contest with 1 Control Ward ready.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Cached')).not.toBeInTheDocument();

    spyDebrief.mockRestore();
  });

  it('rejects unvalidated cached debriefs on hydration and hides stale cache when Regenerate fails', async () => {
    const match = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      role: 'JUNGLE',
    };
    const platKey = buildMatchCacheKey(match, 'PLATINUM IV');
    setCachedAiResponse('post_game', platKey, 'gemini', 'gemini-3.8-flash', {
      text: 'Fabricated cached stat: 999.9 CS/min.',
      verified: true,
    });

    const { rerender } = render(
      <PostGameReviewView
        matches={[match]}
        targetDivision="PLATINUM IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: true,
        }}
        canSyncLive={false}
        isTauri
        onSyncMatches={vi.fn(async () => {})}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Open Viego, vs Nocturne/i }));
    expect(screen.queryByText(/999\.9/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate AI Coach Debrief' })).toBeInTheDocument();

    const goldKey = buildMatchCacheKey(match, 'GOLD IV');
    setCachedAiResponse('post_game', goldKey, 'gemini', 'gemini-4-hydrogen', {
      text: 'Valid cached debrief: keep 1 Control Ward ready.',
      verified: true,
    });
    const spyFail = vi
      .spyOn(tauriBridge, 'generateAiDebrief')
      .mockRejectedValueOnce(new Error('Gemini rate limit reached'));

    rerender(
      <PostGameReviewView
        matches={[match]}
        targetDivision="GOLD IV"
        patchVersion="16.23.1"
        aiConfig={{
          provider: 'gemini',
          model: 'gemini-4-hydrogen',
          endpoint: 'http://127.0.0.1:11434',
          hasApiKey: true,
        }}
        canSyncLive={false}
        isTauri
        onSyncMatches={vi.fn(async () => {})}
      />
    );
    expect(
      screen.getByText('Valid cached debrief: keep 1 Control Ward ready.')
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate AI Debrief' }));
      await Promise.resolve();
    });

    expect(await screen.findByText(/Gemini rate limit reached/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Valid cached debrief: keep 1 Control Ward ready.')
    ).not.toBeInTheDocument();

    spyFail.mockRestore();
  });
});
