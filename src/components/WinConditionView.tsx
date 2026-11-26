import { useState } from 'react';
import { synthesizeDemoWinConBrief } from '../domain/aiCoachFallback';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig, WinConditionPlan } from '../types/coaching';
import type { MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { SummonersRiftMap } from './SummonersRiftMap';

interface WinConditionViewProps {
  plan: WinConditionPlan;
  mapSide: MapSide;
  championName: string;
  patchVersion: string;
  aiConfig: AiCoachConfig;
}

export function WinConditionView({
  plan,
  mapSide,
  championName,
  patchVersion,
  aiConfig,
}: WinConditionViewProps) {
  const [selectedRouteId, setSelectedRouteId] = useState<string>(plan.recommendedRouteId);
  const [aiBrief, setAiBrief] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const activeRoute =
    plan.routes.find((r) => r.id === selectedRouteId) ??
    plan.routes.find((r) => r.id === plan.recommendedRouteId) ??
    plan.routes[0]!;

  async function handleGenerateBrief() {
    setAiLoading(true);
    try {
      const ctx = JSON.stringify({
        championName,
        mapSide,
        strongSide: plan.strongSide,
        allyArchetype: plan.allyAnalysis.archetype,
        enemyArchetype: plan.enemyAnalysis.archetype,
        primaryWinCondition: plan.primaryWinCondition,
        enemyWinConditionToDeny: plan.enemyWinConditionToDeny,
      });
      const text = await generateAiDebrief(ctx);
      setAiBrief(text);
    } catch {
      setAiBrief(synthesizeDemoWinConBrief(plan, championName));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Hairline-Divided Win Conditions */}
      <GlassSurface className="p-5">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
              How We Win · {championName}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
              {plan.primaryWinCondition}
            </p>
            <div className="mt-2.5 text-[11px] text-slate-400">
              Strong Side:{' '}
              <span className="font-semibold text-white">
                {plan.strongSide.toUpperCase()}
              </span>{' '}
              · Weak Side: {plan.weakSide.toUpperCase()} · {plan.allyAnalysis.archetype}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{plan.strongSideReason}</p>
          </div>

          <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Enemy Win Condition to Deny
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
              {plan.enemyWinConditionToDeny}
            </p>
            <div className="mt-2.5 text-[11px] text-slate-400">
              Enemy Comp: {plan.enemyAnalysis.archetype} · AD {plan.enemyAnalysis.adScore} / AP{' '}
              {plan.enemyAnalysis.apScore}
            </div>
          </div>
        </div>

        {/* 3-Phase Gameplan */}
        <div className="mt-5 grid gap-4 border-t border-white/[0.08] pt-4 md:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold text-white">Early Game (0–14m)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {plan.phasePlaybook.early}
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-white">Mid Game (14–25m)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {plan.phasePlaybook.mid}
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-white">Late Game (25m+)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {plan.phasePlaybook.late}
            </p>
          </div>
        </div>
      </GlassSurface>

      {/* Multi-Clear Stage Selector */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
          Clear Sequence
        </span>
        <div className="lg-segmented flex flex-wrap gap-1">
          {plan.routes.map((r) => {
            const isCurrent = activeRoute.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRouteId(r.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                  isCurrent
                    ? 'lg-segment-active font-semibold'
                    : 'border border-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                {r.label}
                {r.id === plan.recommendedRouteId ? ' ★' : ''}
              </button>
            );
          })}
        </div>
      </div>

      <SummonersRiftMap
        mapSide={mapSide}
        patchVersion={patchVersion}
        route={activeRoute}
        wardSpots={plan.wardSpots}
      />

      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-300">
            AI Coach Pre-Game Brief (
            {aiConfig.provider === 'off'
              ? 'Deterministic Preview'
              : `${aiConfig.provider.toUpperCase()} · ${aiConfig.model}`}
            )
          </span>
          <button
            type="button"
            disabled={aiLoading}
            onClick={() => void handleGenerateBrief()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {aiLoading ? 'Summarizing...' : 'Summarize Win-Con Brief'}
          </button>
        </div>
        {aiBrief && (
          <pre className="lg-inset mt-3 whitespace-pre-wrap p-3 font-sans text-xs leading-relaxed text-slate-200">
            {aiBrief}
          </pre>
        )}
      </GlassSurface>
    </div>
  );
}
