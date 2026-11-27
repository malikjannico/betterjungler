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
  primaryRole: 'jungle',
  secondaryRole: 'bottom',
  autoDetectRole: true,
  aiCoach: {
    provider: 'off',
    model: 'gemini-2.5-flash',
    endpoint: 'http://127.0.0.1:11434',
    hasApiKey: false,
  },
};

function renderSettings(overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return render(
    <SettingsView
      settings={BASE_SETTINGS}
      patchVersion="16.23.1"
      catalogCounts={{ champions: 0, items: 0 }}
      apiKeyHealth={null}
      appMeta={{ version: '2.0.0', commitSha: 'abc1234', logDir: '' }}
      updateInfo={null}
      checkingUpdate={false}
      installingUpdate={false}
      stagingUpdate={false}
      stagedUpdateVersion={null}
      updateError={null}
      canInstallUpdateSafely
      isTauri
      onSettingsChanged={vi.fn()}
      onProfileLoaded={vi.fn()}
      onPatchSynced={vi.fn()}
      onApiKeyHealthChanged={vi.fn()}
      onCheckUpdate={vi.fn(async () => {})}
      onInstallUpdate={vi.fn(async () => {})}
      onStageUpdate={vi.fn(async () => {})}
      {...overrides}
    />
  );
}

describe('SettingsView master-detail categories, rollback & roles', () => {
  it('renders stacked category cards instead of tabs, preserves unsaved drafts across subpages, and rolls back failed overlay updates', async () => {
    const spyEnv = vi.spyOn(tauriBridge, 'isTauriEnvironment').mockReturnValue(true);
    const spyPrefs = vi
      .spyOn(tauriBridge, 'updateOverlayPreferences')
      .mockRejectedValueOnce(new Error('Hotkey Alt+B is already registered by another app'));
    const onSettingsChanged = vi.fn();

    renderSettings({ onSettingsChanged });

    // No horizontal tab strip — stacked category list with descriptions renders first
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Account & Riot API/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Roles & Preferences/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Overlay & HUD/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Account & Riot API/ }));
    const riotIdInput = screen.getByLabelText(/Riot ID/i) as HTMLInputElement;
    fireEvent.change(riotIdInput, { target: { value: 'DraftSaver#EUW' } });

    fireEvent.click(screen.getByRole('button', { name: /^Back to Settings/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Overlay & HUD/ }));

    expect(screen.getByText(/Recommended In-Game League HUD Settings/i)).toBeInTheDocument();
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

    // Returning to Account & Riot API preserves unsaved draft edits across subpage navigation
    fireEvent.click(screen.getByRole('button', { name: /^Back to Settings/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Account & Riot API/ }));
    expect((screen.getByLabelText(/Riot ID/i) as HTMLInputElement).value).toBe('DraftSaver#EUW');

    spyEnv.mockRestore();
    spyPrefs.mockRestore();
  });

  it('provides curated AI presets with Free/Paid tier guidance, custom model fallback, and Test Connection', async () => {
    const spyTestAi = vi
      .spyOn(tauriBridge, 'testAiConnection')
      .mockResolvedValueOnce('Connected to Google Gemini (gemini-4-hydrogen) — ready for coaching debriefs.');

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /^AI Coach/ }));
    fireEvent.change(screen.getByLabelText('AI Provider'), { target: { value: 'gemini' } });

    const presetSelect = screen.getByLabelText('AI Model Preset') as HTMLSelectElement;
    expect(presetSelect.value).toBe('gemini-3.8-flash');
    expect(screen.getByText('Free-Tier Eligible · Recommended')).toBeInTheDocument();

    fireEvent.change(presetSelect, { target: { value: 'gemini-4-neon' } });
    expect(screen.getByText('Paid Tier Required')).toBeInTheDocument();

    fireEvent.change(presetSelect, { target: { value: 'gemini-4-hydrogen' } });
    expect(screen.getByText('Free-Tier Eligible · Gemini 4')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
      await Promise.resolve();
    });

    expect(spyTestAi).toHaveBeenCalledWith('gemini', 'gemini-4-hydrogen', 'http://127.0.0.1:11434');
    expect(
      await screen.findByText(/Connected to Google Gemini \(gemini-4-hydrogen\)/i)
    ).toBeInTheDocument();

    fireEvent.change(presetSelect, { target: { value: '__custom__' } });
    const customInput = screen.getByLabelText('Custom AI Model') as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'gemini-3.6-flash' } });
    expect(customInput.value).toBe('gemini-3.6-flash');

    spyTestAi.mockRestore();
  });

  it('saves Roles & Preferences immediately and supports deep-linking via initialSectionToken', async () => {
    const spySave = vi.spyOn(tauriBridge, 'saveSettings').mockResolvedValue(undefined);
    const onSettingsChanged = vi.fn();

    const { rerender } = renderSettings({
      initialSection: 'roles',
      initialSectionToken: 1,
      onSettingsChanged,
    });

    expect(screen.getByRole('heading', { name: 'Roles & Preferences' })).toBeInTheDocument();

    const autoDetectToggle = screen.getByRole('switch', {
      name: /Auto-detect role from Champ Select/i,
    });
    await act(async () => {
      fireEvent.click(autoDetectToggle);
      await Promise.resolve();
    });

    expect(spySave).toHaveBeenCalledWith(expect.objectContaining({ autoDetectRole: false }));
    expect(onSettingsChanged).toHaveBeenCalledWith(expect.objectContaining({ autoDetectRole: false }));

    rerender(
      <SettingsView
        settings={BASE_SETTINGS}
        patchVersion="16.23.1"
        catalogCounts={{ champions: 0, items: 0 }}
        apiKeyHealth={null}
        appMeta={{ version: '2.0.0', commitSha: 'abc1234', logDir: '' }}
        updateInfo={null}
        checkingUpdate={false}
        installingUpdate={false}
        stagingUpdate={false}
        stagedUpdateVersion={null}
        updateError={null}
        canInstallUpdateSafely
        isTauri
        initialSection="ai"
        initialSectionToken={2}
        onSettingsChanged={onSettingsChanged}
        onProfileLoaded={vi.fn()}
        onPatchSynced={vi.fn()}
        onApiKeyHealthChanged={vi.fn()}
        onCheckUpdate={vi.fn(async () => {})}
        onInstallUpdate={vi.fn(async () => {})}
        onStageUpdate={vi.fn(async () => {})}
      />
    );

    expect(screen.getByRole('heading', { name: 'AI Coach' })).toBeInTheDocument();
    spySave.mockRestore();
  });
});
