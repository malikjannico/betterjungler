import type { AiProvider } from '../types/coaching';

export interface AiModelPreset {
  id: string;
  label: string;
  tier: 'free' | 'paid' | 'local';
  tierLabel: string;
  note: string;
}

export const AI_MODEL_PRESETS: Record<Exclude<AiProvider, 'off'>, AiModelPreset[]> = {
  gemini: [
    {
      id: 'gemini-3.8-flash',
      label: 'gemini-3.8-flash (Recommended · Fast)',
      tier: 'free',
      tierLabel: 'Free-Tier Eligible · Recommended',
      note: 'Fast workhorse with free AI Studio quota; ideal for match summaries.',
    },
    {
      id: 'gemini-3.5-flash-lite',
      label: 'gemini-3.5-flash-lite (Highest Quota)',
      tier: 'free',
      tierLabel: 'Free-Tier Eligible · Highest Quota',
      note: 'Ultra-low latency and maximum free-tier headroom.',
    },
    {
      id: 'gemini-4-hydrogen',
      label: 'gemini-4-hydrogen (Gemini 4 Fast)',
      tier: 'free',
      tierLabel: 'Free-Tier Eligible · Gemini 4',
      note: 'Gemini 4 speed model; works on both Free Tier and Paid Tier 1.',
    },
    {
      id: 'gemini-4-neon',
      label: 'gemini-4-neon (Frontier · Paid Tier)',
      tier: 'paid',
      tierLabel: 'Paid Tier Required',
      note: 'Frontier Gemini 4 model; requires Tier 1 billing with a >$0 prepaid balance.',
    },
  ],
  openai: [
    {
      id: 'gpt-6-luna',
      label: 'gpt-6-luna (Recommended · Budget)',
      tier: 'paid',
      tierLabel: 'Paid Tier · Recommended',
      note: 'Fast & ultra-low cost (~$0.10/1M input tokens).',
    },
    {
      id: 'gpt-4.1-mini',
      label: 'gpt-4.1-mini (Reliable Mini)',
      tier: 'paid',
      tierLabel: 'Paid Tier',
      note: 'Reliable budget model (~$0.15/1M input tokens).',
    },
    {
      id: 'gpt-4o-mini',
      label: 'gpt-4o-mini (Legacy Mini)',
      tier: 'paid',
      tierLabel: 'Paid Tier · Legacy',
      note: 'Classic lightweight OpenAI model.',
    },
  ],
  ollama: [
    {
      id: 'llama3.1:8b',
      label: 'llama3.1:8b (Recommended · Local)',
      tier: 'local',
      tierLabel: 'Local & Free · Recommended',
      note: 'Zero rate limits, 100% offline (~8GB VRAM recommended).',
    },
    {
      id: 'qwen2.5:7b',
      label: 'qwen2.5:7b (Local)',
      tier: 'local',
      tierLabel: 'Local & Free',
      note: 'Strong concise instruction following locally.',
    },
  ],
};

export function getDefaultModelForProvider(provider: AiProvider, fallback = 'gemini-3.8-flash'): string {
  if (provider === 'off') return fallback;
  return AI_MODEL_PRESETS[provider][0]?.id ?? fallback;
}

export function findModelPreset(provider: AiProvider, model: string): AiModelPreset | null {
  if (provider === 'off') return null;
  const trimmed = model.trim();
  return AI_MODEL_PRESETS[provider].find((preset) => preset.id === trimmed) ?? null;
}
