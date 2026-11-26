import { useState } from 'react';
import { Bot, Check, KeyRound, RefreshCw, ShieldCheck, Sliders } from 'lucide-react';
import { syncFullDdragonCatalog } from '../services/ddragonService';
import {
  fetchSummonerProfile,
  saveAiApiKey,
  saveRiotApiKey,
  saveSettings,
  syncDdragonPatch,
  updateOverlayPreferences,
} from '../services/tauriBridge';
import type {
  AiProvider,
  HudCorner,
  OverlayHotkeyPreset,
  UserSettings,
} from '../types/coaching';
import type { SummonerProfileSummary } from '../types/riot';
import { GlassSurface } from './GlassSurface';

interface SettingsViewProps {
  settings: UserSettings;
  patchVersion: string;
  catalogCounts: { champions: number; items: number };
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string, counts?: { champions: number; items: number }) => void;
}

const REGIONS = ['EUW1', 'EUN1', 'NA1', 'KR', 'BR1', 'JP1', 'OC1', 'TR1', 'LA1', 'LA2'];
const DIVISIONS = [
  'SILVER IV',
  'GOLD IV',
  'PLATINUM IV',
  'EMERALD IV',
  'DIAMOND IV',
  'MASTER',
];
const HUD_CORNERS: Array<{ value: HudCorner; label: string }> = [
  { value: 'top-right', label: 'Top-Right' },
  { value: 'top-left', label: 'Top-Left' },
  { value: 'bottom-right', label: 'Bottom-Right' },
  { value: 'bottom-left', label: 'Bottom-Left' },
];
const HOTKEY_PRESETS: OverlayHotkeyPreset[] = ['Alt+J', 'Alt+B', 'Ctrl+Shift+J', 'F8'];

export function SettingsView({
  settings,
  patchVersion,
  catalogCounts,
  onSettingsChanged,
  onProfileLoaded,
  onPatchSynced,
}: SettingsViewProps) {
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSaveSettings() {
    setErrorMessage(null);
    await saveSettings(draft);
    await updateOverlayPreferences(draft.hudCorner, draft.overlayHotkey);
    onSettingsChanged(draft);
    setStatusMessage('Preferences & Overlay Ergonomics saved.');
  }

  async function handleSaveApiKey() {
    setErrorMessage(null);
    if (!apiKeyInput.trim()) {
      setErrorMessage('Enter a Riot Developer API key first.');
      return;
    }
    const ok = await saveRiotApiKey(apiKeyInput.trim());
    if (ok) {
      const updated = { ...draft, hasApiKey: true };
      setDraft(updated);
      onSettingsChanged(updated);
      setApiKeyInput('');
      setStatusMessage('Riot API Key stored in Windows Credential Manager.');
    }
  }

  async function handleLookupProfile() {
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const profile = await fetchSummonerProfile(draft.riotId, draft.region);
      onProfileLoaded(profile);
      setStatusMessage(`Synced profile: ${profile.riotId} (${profile.tier} ${profile.rank}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to fetch Riot profile.');
    }
  }

  async function handleSyncPatch() {
    const patch = await syncDdragonPatch();
    const catalog = await syncFullDdragonCatalog(patch);
    const counts = {
      champions: Object.keys(catalog.championsById).length,
      items: Object.keys(catalog.itemsById).length,
    };
    onPatchSynced(catalog.patch, counts);
    setStatusMessage(
      `Data Dragon synced to patch ${catalog.patch} (${counts.champions} champions, ${counts.items} items).`
    );
  }

  async function handleSaveAiKey() {
    setErrorMessage(null);
    if (!aiKeyInput.trim()) {
      setErrorMessage('Enter an AI provider API key first.');
      return;
    }
    const ok = await saveAiApiKey(aiKeyInput.trim());
    if (ok) {
      const updated: UserSettings = {
        ...draft,
        aiCoach: { ...draft.aiCoach, hasApiKey: true },
      };
      setDraft(updated);
      await saveSettings(updated);
      onSettingsChanged(updated);
      setAiKeyInput('');
      setStatusMessage('AI Coach API key stored in Windows Credential Manager.');
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3.5 md:grid-cols-2">
        <GlassSurface className="space-y-3 p-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-200">
            Riot Account &amp; Climb Target
          </h2>

          <label className="block text-xs">
            <span className="text-slate-400">Riot ID (Name#Tag)</span>
            <input
              type="text"
              value={draft.riotId}
              onChange={(e) => setDraft({ ...draft, riotId: e.target.value })}
              placeholder="YourName#EUW"
              className="lg-inset mt-1 w-full px-3 py-2 text-xs text-slate-100 outline-none focus:border-sky-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-xs">
              <span className="text-slate-400">Platform Region</span>
              <select
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                className="lg-inset mt-1 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r} className="bg-slate-900">
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs">
              <span className="text-slate-400">Target Division</span>
              <select
                value={draft.targetDivision}
                onChange={(e) => setDraft({ ...draft, targetDivision: e.target.value })}
                className="lg-inset mt-1 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
              >
                {DIVISIONS.map((d) => (
                  <option key={d} value={d} className="bg-slate-900">
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs">
            <span className="text-slate-400">League Install Path (for LCU lockfile)</span>
            <input
              type="text"
              value={draft.lolInstallPath}
              onChange={(e) => setDraft({ ...draft, lolInstallPath: e.target.value })}
              className="lg-inset mt-1 w-full px-3 py-2 text-xs text-slate-100 outline-none focus:border-sky-400"
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveSettings}
              className="lg-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold"
            >
              <Check className="h-3.5 w-3.5" />
              Save Preferences
            </button>
            <button
              type="button"
              onClick={handleLookupProfile}
              className="lg-btn-glass inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200"
            >
              Sync Riot Profile
            </button>
          </div>
        </GlassSurface>

        <GlassSurface className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-200">
              Riot API Key &amp; Data Dragon
            </h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                draft.hasApiKey
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-amber-400/15 text-amber-200'
              }`}
            >
              {draft.hasApiKey ? 'Key Stored Securely' : 'No Key Saved'}
            </span>
          </div>

          <label className="block text-xs">
            <span className="text-slate-400">
              Personal Riot API Key (stored in Windows Credential Manager)
            </span>
            <div className="mt-1 flex gap-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="RGAPI-xxxxxxxx-xxxx-..."
                className="lg-inset flex-1 px-3 py-2 text-xs text-slate-100 outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="lg-btn-glass inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-sky-200"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Save Key
              </button>
            </div>
          </label>

          <div className="lg-inset flex items-center justify-between px-3 py-2.5 text-xs">
            <div>
              <div className="font-semibold text-slate-200">Data Dragon Patch &amp; Catalog</div>
              <div className="text-[11px] text-slate-400">
                Patch {patchVersion} • {catalogCounts.champions} champions / {catalogCounts.items}{' '}
                items hydrated
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncPatch}
              className="lg-btn-glass inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Patch
            </button>
          </div>

          <div className="lg-inset p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.07em] text-sky-300">
              <Sliders className="h-3.5 w-3.5" />
              Overlay Ergonomics
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-[11px]">
                <span className="text-slate-400">Compact HUD Corner</span>
                <select
                  aria-label="Compact HUD Corner"
                  value={draft.hudCorner}
                  onChange={(e) => {
                    const next = { ...draft, hudCorner: e.target.value as HudCorner };
                    setDraft(next);
                    onSettingsChanged(next);
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-100"
                >
                  {HUD_CORNERS.map((c) => (
                    <option key={c.value} value={c.value} className="bg-slate-900">
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">Global Hotkey</span>
                <select
                  aria-label="Global Hotkey"
                  value={draft.overlayHotkey}
                  onChange={(e) => {
                    const next = { ...draft, overlayHotkey: e.target.value };
                    setDraft(next);
                    onSettingsChanged(next);
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-100"
                >
                  {HOTKEY_PRESETS.map((k) => (
                    <option key={k} value={k} className="bg-slate-900">
                      {k}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px]">
                <span className="text-slate-400">HUD Opacity ({draft.hudOpacity}%)</span>
                <input
                  type="range"
                  aria-label="HUD Opacity"
                  min={50}
                  max={100}
                  value={draft.hudOpacity}
                  onChange={(e) => {
                    const next = { ...draft, hudOpacity: Number(e.target.value) };
                    setDraft(next);
                    onSettingsChanged(next);
                  }}
                  className="mt-2 w-full accent-sky-400"
                />
              </label>
            </div>
          </div>

          <div className="lg-inset border-emerald-400/20 bg-emerald-400/[0.04] p-2.5 text-[11px] text-slate-300">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Riot Developer Policy Compliance
            </div>
            <p className="mt-1 text-slate-400">
              Uses official Riot APIs, LCU Champ Select read + manual rune/spell apply, and Live
              Client Data API (127.0.0.1:2999). Never reads game memory, never tracks enemy
              ultimates, and enforces Solo/Duo Champ Select anonymity.
            </p>
          </div>
        </GlassSurface>
      </div>

      {/* Optional BYOK AI Coach */}
      <GlassSurface className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.07em] text-violet-200">
            <Bot className="h-4 w-4 text-violet-300" />
            Optional BYOK AI Coach (Natural-Language Debriefs)
          </div>
          <span className="text-[11px] text-slate-400">
            Deterministic coaching always runs offline; AI is strictly optional.
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-3">
          <label className="block text-xs">
            <span className="text-slate-400">AI Provider</span>
            <select
              aria-label="AI Provider"
              value={draft.aiCoach.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                const defaultModel =
                  provider === 'gemini'
                    ? 'gemini-2.5-flash'
                    : provider === 'openai'
                      ? 'gpt-4o-mini'
                      : provider === 'ollama'
                        ? 'llama3.1'
                        : draft.aiCoach.model;
                setDraft({
                  ...draft,
                  aiCoach: { ...draft.aiCoach, provider, model: defaultModel },
                });
              }}
              className="lg-inset mt-1 w-full px-2.5 py-2 text-xs text-slate-100 outline-none"
            >
              <option value="off" className="bg-slate-900">
                Off (Deterministic Only)
              </option>
              <option value="gemini" className="bg-slate-900">
                Google Gemini (BYOK)
              </option>
              <option value="openai" className="bg-slate-900">
                OpenAI (BYOK)
              </option>
              <option value="ollama" className="bg-slate-900">
                Local Ollama (127.0.0.1)
              </option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="text-slate-400">Model</span>
            <input
              type="text"
              value={draft.aiCoach.model}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  aiCoach: { ...draft.aiCoach, model: e.target.value },
                })
              }
              className="lg-inset mt-1 w-full px-3 py-2 text-xs text-slate-100 outline-none"
            />
          </label>

          {draft.aiCoach.provider === 'ollama' ? (
            <label className="block text-xs">
              <span className="text-slate-400">Local Ollama URL</span>
              <input
                type="text"
                value={draft.aiCoach.endpoint}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    aiCoach: { ...draft.aiCoach, endpoint: e.target.value },
                  })
                }
                className="lg-inset mt-1 w-full px-3 py-2 text-xs text-slate-100 outline-none"
              />
            </label>
          ) : (
            <label className="block text-xs">
              <span className="text-slate-400">
                AI Key ({draft.aiCoach.hasApiKey ? 'Stored Securely' : 'Not Saved'})
              </span>
              <div className="mt-1 flex gap-1.5">
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder="Paste Gemini / OpenAI key"
                  className="lg-inset flex-1 px-2.5 py-2 text-xs text-slate-100 outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveAiKey}
                  className="lg-btn-glass px-3 py-2 text-xs font-semibold text-violet-200"
                >
                  Save
                </button>
              </div>
            </label>
          )}
        </div>
      </GlassSurface>

      {statusMessage && (
        <div className="lg-inset border-emerald-400/35 bg-emerald-400/10 px-3.5 py-2 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="lg-inset border-rose-400/35 bg-rose-400/10 px-3.5 py-2 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
