import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';
import * as tauriBridge from '../services/tauriBridge';
import type { UserSettings } from '../types/coaching';

const BASE_SETTINGS: UserSettings = {
  riotId: 'Jungler#EUW',
  region: 'EUW1',
  lolInstallPath: 'C:\\Riot Games\\League of Legends',
  overlayHotkey: 'Alt+J',
  hudCorner: 'beside-minimap',
  hudOpacity: 92,
  hudScale: 100,
  hudMonitor: 'primary',
  minimapSide: 'right',
  targetDivision: 'PLATINUM IV',
  hasApiKey: false,
  aiCoach: {
    provider: 'off',
    model: 'gemini-2.5-flash',
    endpoint: 'http://127.0.0.1:11434',
    hasApiKey: false,
  },
};

describe('SettingsView overlay rollback', () => {
  it('reverts optimistic hotkey & displays error if Tauri overlay preference update fails', async () => {
    const spyEnv = vi.spyOn(tauriBridge, 'isTauriEnvironment').mockReturnValue(true);
    const spyPrefs = vi
      .spyOn(tauriBridge, 'updateOverlayPreferences')
      .mockRejectedValueOnce(new Error('Hotkey Alt+B is already registered by another app'));
    const onSettingsChanged = vi.fn();

    render(
      <SettingsView
        settings={BASE_SETTINGS}
        patchVersion="16.23.1"
        catalogCounts={{ champions: 0, items: 0 }}
        apiKeyHealth={null}
        appMeta={{ version: '0.3.0', commitSha: 'abc1234', logDir: '' }}
        updateInfo={null}
        checkingUpdate={false}
        installingUpdate={false}
        updateError={null}
        canInstallUpdateSafely
        isTauri
        onSettingsChanged={onSettingsChanged}
        onProfileLoaded={vi.fn()}
        onPatchSynced={vi.fn()}
        onApiKeyHealthChanged={vi.fn()}
        onCheckUpdate={vi.fn(async () => {})}
        onInstallUpdate={vi.fn(async () => {})}
      />
    );

    const hotkeySelect = screen.getByLabelText('Global Hotkey') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(hotkeySelect, { target: { value: 'Alt+B' } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      await screen.findByText(/Hotkey Alt\+B is already registered/i)
    ).toBeInTheDocument();
    expect(hotkeySelect.value).toBe('Alt+J');
    expect(onSettingsChanged).toHaveBeenLastCalledWith(BASE_SETTINGS);

    spyEnv.mockRestore();
    spyPrefs.mockRestore();
  });
});
