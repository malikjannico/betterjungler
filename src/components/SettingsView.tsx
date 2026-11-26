import { useState } from 'react';
import { Bot, Check, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchSummonerProfile,
  saveAiApiKey,
  saveRiotApiKey,
  saveSettings,
  syncDdragonPatch,
} from '../services/tauriBridge';
import type { AiProvider, UserSettings } from '../types/coaching';
import type { SummonerProfileSummary } from '../types/riot';

interface SettingsViewProps {
  settings: UserSettings;
  patchVersion: string;
  onSettingsChanged: (next: UserSettings) => void;
  onProfileLoaded: (profile: SummonerProfileSummary) => void;
  onPatchSynced: (patch: string) => void;
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

export function SettingsView({
  settings,
  patchVersion,
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
    onSettingsChanged(draft);
    setStatusMessage('Settings saved.');
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
    onPatchSynced(patch);
    setStatusMessage(`Data Dragon synced to patch ${patch}.`);
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
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="hud-card space-y-3 rounded-xl p-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Riot Account &amp; Overlay Preferences
          </h2>

          <label className="block text-xs">
            <span className="text-slate-400">Riot ID (Name#Tag)</span>
            <input
              type="text"
              value={draft.riotId}
              onChange={(e) => setDraft({ ...draft, riotId: e.target.value })}
              placeholder="YourName#EUW"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="text-slate-400">Platform Region</span>
              <select
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
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
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
              >
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>
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
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleSaveSettings}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
            >
              <Check className="h-3.5 w-3.5" />
              Save Preferences
            </button>
            <button
              type="button"
              onClick={handleLookupProfile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Sync Riot Profile
            </button>
          </div>
        </div>

        <div className="hud-card space-y-3 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Riot Developer API Key &amp; Data Dragon
            </h2>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                draft.hasApiKey
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-amber-500/15 text-amber-300'
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
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Save Key
              </button>
            </div>
          </label>

          <div className="flex items-center justify-between rounded-lg bg-slate-900/70 px-3 py-2 text-xs">
            <div>
              <div className="font-semibold text-slate-200">Data Dragon Patch</div>
              <div className="text-[11px] text-slate-400">Active version: {patchVersion}</div>
            </div>
            <button
              type="button"
              onClick={handleSyncPatch}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Patch
            </button>
          </div>

          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5 text-[11px] text-slate-300">
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
        </div>
      </div>

      {/* Optional BYOK AI Coach */}
      <div className="hud-card space-y-3 rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-violet-300">
            <Bot className="h-4 w-4" />
            Optional BYOK AI Coach (Natural-Language Debriefs)
          </div>
          <span className="text-[11px] text-slate-400">
            Deterministic coaching always runs offline; AI is strictly optional.
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
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
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="off">Off (Deterministic Only)</option>
              <option value="gemini">Google Gemini (BYOK)</option>
              <option value="openai">OpenAI (BYOK)</option>
              <option value="ollama">Local Ollama (127.0.0.1)</option>
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
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
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
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
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
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleSaveAiKey}
                  className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/25"
                >
                  Save
                </button>
              </div>
            </label>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
