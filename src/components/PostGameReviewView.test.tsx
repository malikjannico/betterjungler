import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from '../domain/postGameFixtures';
import { PostGameReviewView } from './PostGameReviewView';

describe('PostGameReviewView subpages & role/champion normalization', () => {
  it('renders clean per-game subpages, normalizes MonkeyKing to Wukong, and separates off-role games', () => {
    const jgMatch = {
      ...DEMO_POST_GAME_MATCHES[0]!,
      championId: 62,
      championName: 'MonkeyKing',
      enemyJunglerChampionId: 121,
      enemyJunglerName: 'Khazix',
      role: 'JUNGLE',
    };
    const adcMatch = {
      ...DEMO_POST_GAME_MATCHES[1]!,
      matchId: 'EUW1_ADC_TEST',
      championId: 222,
      championName: 'Jinx',
      role: 'BOTTOM',
    };

    render(
      <PostGameReviewView
        matches={[jgMatch, adcMatch]}
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

    // Champion display name normalized everywhere
    expect(screen.getByText("Wukong vs Kha'Zix")).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Map & Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video & Replay' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'AI Debrief' })).toBeInTheDocument();

    // Switching to Map & Timeline renders interactive Rift Replay
    fireEvent.click(screen.getByRole('tab', { name: 'Map & Timeline' }));
    expect(screen.getByRole('slider', { name: 'Inspect match timeline minute' })).toBeInTheDocument();

    // Switching to off-role ADC match resets cleanly to Overview with off-role notice & basic stats
    fireEvent.click(screen.getByRole('button', { name: /Jinx/i }));
    expect(screen.getByText('Jinx (ADC)')).toBeInTheDocument();
    expect(screen.getByText(/Off-role game \(ADC\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No deep jungle evaluation or lane-CS grading is generated here/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Map & Timeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'AI Debrief' })).not.toBeInTheDocument();
  });

  it('excludes the selected match from its personal EWM baseline comparison', () => {
    // 3 older games have clean ~7.2 CS/min; newest selected game has 3.0 CS/min outlier
    const baseClean = DEMO_POST_GAME_MATCHES[0]!;
    const outlierSelected = {
      ...baseClean,
      matchId: 'EUW1_OUTLIER_NEW',
      playedAt: '2026-11-27T18:00:00Z',
      durationSeconds: 1800,
      cs: 90, // 3.0 CS/min outlier
    };
    const priorGames = Array.from({ length: 3 }, (_, idx) => ({
      ...baseClean,
      matchId: `EUW1_PRIOR_${idx}`,
      playedAt: new Date(Date.UTC(2026, 10, 27, 10 + idx, 0, 0)).toISOString(),
      durationSeconds: 1800,
      cs: 216, // 7.2 CS/min
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

    // EWM baseline across the 3 prior games excludes 3.0 CS/min and stays near prior+6.6/7.2
    const baselineLine = screen.getByText(/vs Personal EWM Baseline:/i).textContent ?? '';
    expect(baselineLine).toContain('6.8 CS/min');
  });
});
