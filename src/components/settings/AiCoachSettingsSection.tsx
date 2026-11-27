import { useId, useState } from 'react';
import { KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import {
  AI_MODEL_PRESETS,
  findModelPreset,
  getDefaultModelForProvider,
} from '../../domain/aiModelCatalog';
import { saveAiApiKey, saveSettings, testAiConnection } from '../../services/tauriBridge';
import type { AiProvider, UserSettings } from '../../types/coaching';
import { M3Button, M3Card, M3Chip, cx } from '../m3';
import {
  SETTINGS_FIELD_CLASS,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSaveBar,
  type SettingsNotifier,
} from './AccountSettingsSection';

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  off: 'Off',
  gemini: 'Gemini',
  openai: 'OpenAI',
  ollama: 'Ollama',
};

/** Turns provider errors into actionable billing / quota / key guidance. */
export function diagnoseAiError(message: string): string | null {
  if (/429|rate.?limit|quota|resource.?exhausted|too many requests/i.test(message)) {
    return 'Rate limit / quota hit (429). Free-tier keys allow only a few requests per minute: wait ~60 s, switch to the highest-quota preset (gemini-3.5-flash-lite), or enable billing on your provider account. Cached debriefs are reused automatically.';
  }
  if (/billing|prepaid|payment|insufficient|credit|402|paid tier/i.test(message)) {
    return 'This model needs a paid tier. Add billing (a >$0 prepaid balance) on your provider account or pick a "Free-Tier Eligible" preset.';
  }
  if (/401|403|unauthori[sz]ed|forbidden|invalid.*key|api key/i.test(message)) {
    return 'The provider rejected the API key. Paste a fresh key, click Save, then Test Connection again.';
  }
  if (/econnrefused|connection refused|11434|ollama/i.test(message)) {
    return 'Ollama is not reachable. Start it with `ollama serve` and confirm the Local Ollama URL above.';
  }
  if (/404|not.?found|model/i.test(message)) {
    return 'The model ID was not found for this provider. Choose a curated preset or double-check the custom model ID.';
  }
  return null;
}

export interface AiCoachSettingsSectionProps {
  settings: UserSettings;
  draft: UserSettings;
  setDraft: (updater: (prev: UserSettings) => UserSettings) => void;
  dirty: boolean;
  notify: SettingsNotifier;
  onSettingsChanged: (next: UserSettings) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
}

export function AiCoachSettingsSection({
  settings,
  draft,
  setDraft,
  dirty,
  notify,
  onSettingsChanged,
  onSave,
  onDiscard,
}: AiCoachSettingsSectionProps) {
  const ids = useId();
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [testingAi, setTestingAi] = useState(false);
  const [customAiModelMode, setCustomAiModelMode] = useState(false);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);

  const aiProvider = draft.aiCoach.provider;
  const presets = aiProvider === 'off' ? [] : AI_MODEL_PRESETS[aiProvider];
  const activePreset = findModelPreset(aiProvider, draft.aiCoach.model);
  const selectValue =
    aiProvider === 'off' ? '' : customAiModelMode || !activePreset ? '__custom__' : activePreset.id;

  function patchAi(patch: Partial<UserSettings['aiCoach']>) {
    setDraft((prev) => ({ ...prev, aiCoach: { ...prev.aiCoach, ...patch } }));
  }

  async function handleSaveAiKey() {
    notify.clear();
    if (!aiKeyInput.trim()) {
      notify.error('Enter an AI provider API key first.');
      return;
    }
    try {
      const ok = await saveAiApiKey(aiKeyInput.trim());
      if (ok) {
        const persisted: UserSettings = {
          ...settings,
          aiCoach: { ...draft.aiCoach, hasApiKey: true },
        };
        setDraft((prev) => ({ ...prev, aiCoach: { ...prev.aiCoach, hasApiKey: true } }));
        await saveSettings(persisted);
        onSettingsChanged(persisted);
        setAiKeyInput('');
        notify.status('AI Coach API key stored in Windows Credential Manager.');
      }
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to store AI API key.');
    }
  }

  async function handleTestAiConnection() {
    notify.clear();
    setDiagnosis(null);
    setTestingAi(true);
    try {
      const result = await testAiConnection(
        draft.aiCoach.provider,
        draft.aiCoach.model,
        draft.aiCoach.endpoint
      );
      notify.status(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI Coach connection check failed.';
      notify.error(message);
      setDiagnosis(diagnoseAiError(message));
    } finally {
      setTestingAi(false);
    }
  }

  const providerId = `${ids}-provider`;
  const presetId = `${ids}-preset`;
  const customId = `${ids}-custom`;
  const endpointId = `${ids}-endpoint`;
  const keyId = `${ids}-key`;

  return (
    <div className="space-y-3">
      <SettingsGroup
        title="Optional BYOK AI Coach"
        description="Natural-language debriefs. Deterministic coaching always runs offline; AI is strictly optional."
        aside={
          aiProvider === 'off' ? (
            <M3Chip tone="plain" size="sm" label="Off · deterministic" className="!text-[var(--md-sys-color-on-surface)]" />
          ) : (
            <M3Chip
              tone="tertiary"
              size="sm"
              icon={<Sparkles aria-hidden />}
              label={`${AI_PROVIDER_LABELS[aiProvider]} · ${draft.aiCoach.model}`}
            />
          )
        }
      >
        <SettingsRow label="AI Provider" htmlFor={providerId} description="Ollama runs fully local on 127.0.0.1.">
          <select
            id={providerId}
            value={aiProvider}
            onChange={(e) => {
              const provider = e.target.value as AiProvider;
              const defaultModel = getDefaultModelForProvider(provider, draft.aiCoach.model);
              setCustomAiModelMode(false);
              setDiagnosis(null);
              patchAi({ provider, model: defaultModel });
            }}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-64')}
          >
            <option value="off" className="bg-zinc-900">
              Off (Deterministic Only)
            </option>
            <option value="gemini" className="bg-zinc-900">
              Google Gemini (BYOK)
            </option>
            <option value="openai" className="bg-zinc-900">
              OpenAI (BYOK)
            </option>
            <option value="ollama" className="bg-zinc-900">
              Local Ollama (127.0.0.1)
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="AI Model Preset"
          htmlFor={presetId}
          description="Curated presets are tuned for short, grounded debriefs."
        >
          {aiProvider === 'off' ? (
            <input
              id={presetId}
              type="text"
              disabled
              value="Deterministic only (no LLM)"
              className={cx(SETTINGS_FIELD_CLASS, 'sm:w-72')}
            />
          ) : (
            <select
              id={presetId}
              value={selectValue}
              onChange={(e) => {
                const val = e.target.value;
                setDiagnosis(null);
                if (val === '__custom__') {
                  setCustomAiModelMode(true);
                } else {
                  setCustomAiModelMode(false);
                  patchAi({ model: val });
                }
              }}
              className={cx(SETTINGS_FIELD_CLASS, 'sm:w-72')}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id} className="bg-zinc-900">
                  {preset.label}
                </option>
              ))}
              <option value="__custom__" className="bg-zinc-900">
                Custom model ID...
              </option>
            </select>
          )}
        </SettingsRow>

        {aiProvider !== 'off' && selectValue === '__custom__' && (
          <SettingsRow label="Custom AI Model" htmlFor={customId} description="Exact provider model ID." stacked>
            <input
              id={customId}
              type="text"
              value={draft.aiCoach.model}
              onChange={(e) => {
                const value = e.target.value;
                patchAi({ model: value });
              }}
              placeholder="Enter exact provider model ID (e.g. gemini-3.8-flash)"
              spellCheck={false}
              className={cx(SETTINGS_FIELD_CLASS, 'font-mono text-[12px]')}
            />
          </SettingsRow>
        )}

        {activePreset && (
          <div className="px-4 py-3">
            <M3Card
              variant="module"
              className={cx(
                'flex flex-wrap items-center gap-2.5 !py-3',
                activePreset.tier === 'paid'
                  ? 'shadow-[inset_0_0_0_1px_rgba(243,192,107,0.35)]'
                  : 'shadow-[inset_0_0_0_1px_rgba(143,216,160,0.3)]'
              )}
            >
              <M3Chip
                tone={activePreset.tier === 'paid' ? 'warning' : 'success'}
                size="sm"
                label={activePreset.tierLabel}
              />
              <span className="m3-body-s text-[var(--md-sys-color-on-surface)]">{activePreset.note}</span>
            </M3Card>
          </div>
        )}

        {aiProvider === 'ollama' ? (
          <SettingsRow label="Local Ollama URL" htmlFor={endpointId} description="Requests never leave this PC." stacked>
            <input
              id={endpointId}
              type="text"
              value={draft.aiCoach.endpoint}
              onChange={(e) => {
                const value = e.target.value;
                patchAi({ endpoint: value });
              }}
              spellCheck={false}
              className={cx(SETTINGS_FIELD_CLASS, 'font-mono text-[12px]')}
            />
          </SettingsRow>
        ) : aiProvider !== 'off' ? (
          <SettingsRow
            label={`AI Key (${draft.aiCoach.hasApiKey ? 'Stored Securely' : 'Not Saved'})`}
            htmlFor={keyId}
            description="Stored in Windows Credential Manager · only ever sent to the selected provider."
            stacked
          >
            <div className="flex flex-wrap gap-2">
              <input
                id={keyId}
                type="password"
                value={aiKeyInput}
                onChange={(e) => setAiKeyInput(e.target.value)}
                placeholder="Paste Gemini / OpenAI key"
                autoComplete="off"
                className={cx(SETTINGS_FIELD_CLASS, 'flex-1 basis-64 font-mono text-[12px]')}
              />
              <M3Button
                variant="tonal"
                size="sm"
                className="!h-10"
                icon={<KeyRound aria-hidden className="h-4 w-4" />}
                onClick={() => void handleSaveAiKey()}
              >
                Save Key
              </M3Button>
            </div>
          </SettingsRow>
        ) : null}

        <SettingsRow
          label="Connection"
          description="Sends one tiny prompt to verify the key, model and billing tier."
        >
          <M3Button
            variant="outlined"
            size="sm"
            disabled={aiProvider === 'off' || testingAi}
            onClick={() => void handleTestAiConnection()}
          >
            {testingAi ? 'Testing Connection...' : 'Test Connection'}
          </M3Button>
        </SettingsRow>
        {diagnosis && (
          <div className="px-2 pb-2">
            <SettingsNotice tone="warning">{diagnosis}</SettingsNotice>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Privacy">
        <div className="px-2 pb-1 pt-1.5">
          <SettingsNotice tone="info">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ShieldCheck aria-hidden className="h-4 w-4 text-[var(--md-ext-success)]" />
              What leaves your PC:
            </span>{' '}
            Only the match telemetry summary used for a debrief (KPIs, timeline facts, champions) is
            sent to the provider you choose, together with your AI key. Your Riot API key and
            recordings never leave this PC. A grounded validator rejects AI claims that are not
            backed by your match data. With{' '}
            <strong>Off</strong> or <strong>Local Ollama</strong>, nothing is sent to a third party.
          </SettingsNotice>
        </div>
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saveLabel="Save AI Coach Settings"
        onSave={() => void onSave()}
        onDiscard={() => {
          setCustomAiModelMode(false);
          setDiagnosis(null);
          onDiscard();
        }}
      />
    </div>
  );
}
