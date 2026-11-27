import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AboutUpdatesSection } from './AboutUpdatesSection';
import * as tauriBridge from '../services/tauriBridge';

describe('AboutUpdatesSection', () => {
  it('renders app version, commit SHA, blocked install safety notice, changelog, and handles log folder errors', async () => {
    const spyLogs = vi
      .spyOn(tauriBridge, 'openLogsFolder')
      .mockRejectedValueOnce(new Error('Explorer launch failed'));

    render(
      <AboutUpdatesSection
        appMeta={{ version: '0.2.0', commitSha: 'abc1234', logDir: 'C:\\logs' }}
        updateInfo={{
          available: true,
          currentVersion: '0.2.0',
          latestVersion: '0.2.1',
          body: 'Fix Smite indicator timing',
        }}
        checkingUpdate={false}
        installingUpdate={false}
        updateError={null}
        canInstallUpdateSafely={false}
        isTauri
        onCheckUpdate={vi.fn(async () => {})}
        onInstallUpdate={vi.fn(async () => {})}
      />
    );

    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
    expect(screen.getByText('build abc1234')).toBeInTheDocument();
    expect(screen.getByText(/Update available: v0\.2\.1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install & Restart' })).toBeDisabled();
    expect(screen.getByText(/paused during Champ Select/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View Changelog' }));
    expect(screen.getByText(/Tauri v2 Auto-Updater with In-Game Safety Gate/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Logs Folder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Explorer launch failed');
    spyLogs.mockRestore();
  });
});
