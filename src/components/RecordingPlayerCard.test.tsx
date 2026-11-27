import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MatchRecordingBundle } from '../types/coaching';
import { RecordingPlayerCard } from './RecordingPlayerCard';

describe('RecordingPlayerCard', () => {
  it('shows honest empty state and Riot Replay fallback button when .rofl exists', () => {
    const bundle: MatchRecordingBundle = {
      recording: null,
      clips: [],
      rofl: {
        matchId: 'EUW1_71001',
        fileName: 'EUW1-71001.rofl',
        filePath: 'C:\\Replays\\EUW1-71001.rofl',
        sizeBytes: 12_000_000,
      },
      replayApiConnected: false,
      replayApiEnabled: true,
    };

    render(
      <RecordingPlayerCard
        matchId="EUW1_71001"
        durationSeconds={1800}
        activeSecond={308}
        isTauri={false}
        initialBundle={bundle}
        onSelectSecond={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByText(/No gameplay recording saved for this match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in LoL Replay @ 5:00/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Recording Settings/i })).toBeInTheDocument();
  });

  it('renders video player + clip bookmarks and seeks timeline when clicked', async () => {
    const onSelectSecond = vi.fn();
    const bundle: MatchRecordingBundle = {
      recording: {
        id: 'rec-1',
        matchId: 'EUW1_71001',
        filePath: 'C:\\AppData\\recordings\\rec-1.mp4',
        startedAt: '2026-11-27T10:00:00Z',
        endedAt: '2026-11-27T10:30:00Z',
        durationSec: 1805,
        sizeBytes: 520 * 1024 * 1024,
        width: 1280,
        height: 720,
        fps: 30,
        preset: '720p30',
        encoderName: 'NVIDIA NVENC',
        syncOffsetSec: 4.0,
        pinned: false,
        status: 'ready',
      },
      clips: [
        {
          id: 'clip-1',
          recordingId: 'rec-1',
          matchId: 'EUW1_71001',
          label: 'Dragon Fight',
          kind: 'bookmark',
          gameTimeSec: 312,
          startSec: 300,
          endSec: 318,
          pinned: true,
          createdAt: '2026-11-27T10:31:00Z',
        },
      ],
      rofl: null,
      replayApiConnected: false,
      replayApiEnabled: false,
    };

    const { container } = render(
      <RecordingPlayerCard
        matchId="EUW1_71001"
        durationSeconds={1800}
        activeSecond={312}
        isTauri={false}
        initialBundle={bundle}
        onSelectSecond={onSelectSecond}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('video')).toBeInTheDocument();
    });
    expect(screen.getByText('Match Recording')).toBeInTheDocument();
    const clipBtn = screen.getByRole('button', { name: /Dragon Fight \(5:00\)/i });
    fireEvent.click(clipBtn);
    expect(onSelectSecond).toHaveBeenCalledWith(300);
  });
});
