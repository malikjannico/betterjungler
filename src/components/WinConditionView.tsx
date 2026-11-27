import { useState } from 'react';
import { synthesizeDemoWinConBrief } from '../domain/aiCoachFallback';
import { generateAiDebrief } from '../services/tauriBridge';
import type { AiCoachConfig, ClimbGoal, WinConditionPlan } from '../types/coaching';
import type { MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { SummonersRiftMap } from './SummonersRiftMap';

interface WinConditionViewProps {
  plan: WinConditionPlan;
  mapSide: MapSide;
  championName: string;
  patchVersion: string;
  aiConfig: AiCoachConfig;
  focusGoal?: ClimbGoal | null;
}

export function WinConditionView({
  plan,
  mapSide,
  championName,
  patchVersion,
  aiConfig,
  focusGoal,
}: WinConditionViewProps) {
  const [routeSelection, setRouteSelection] = useState<{
    recommendedId: string;
    selectedId: string;
  }>({
    recommendedId: plan.recommendedRouteId,
    selectedId: plan.recommendedRouteId,
  });
  const selectedRouteId =
    routeSelection.recommendedId === plan.recommendedRouteId
      ? routeSelection.selectedId
      : plan.recommendedRouteId;
  const setSelectedRouteId = (routeId: string) =>
    setRouteSelection({ recommendedId: plan.recommendedRouteId, selectedId: routeId });
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
      {focusGoal && (
        <div className="lg-inset flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-sky-400/35 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
              Match Focus
            </span>
            <span className="font-medium text-white">{focusGoal.title}</span>
          </div>
          <span className="tabular-nums text-[11px] text-slate-400">
            Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
            {focusGoal.unit ? ` ${focusGoal.unit}` : ''}
          </span>
        </div>
      )}

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
              Enemy Comp: {plan.enemyAnalysis.archetype}
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

      {/* Enemy Jungle Opening Playbook & Lane Gankability Matrix */}
      <GlassSurface className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Enemy Jungle Opening &amp; Lane Gankability
            </div>
            <h3 className="mt-0.5 text-sm font-semibold text-white">
              vs {plan.enemyJunglePlaybook.enemyChampionName}
            </h3>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              plan.enemyJunglePlaybook.invadeRisk === 'high'
                ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                : plan.enemyJunglePlaybook.invadeRisk === 'medium'
                  ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                  : 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
            }`}
          >
            Invade Risk: {plan.enemyJunglePlaybook.invadeRisk}
          </span>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="lg-inset p-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Expected First Clear
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-100">
              {plan.enemyJunglePlaybook.expectedStart}
            </p>
          </div>
          <div className="lg-inset p-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              1:15 Early Ward Target
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-100">
              {plan.enemyJunglePlaybook.wardTarget115}
            </p>
          </div>
          <div className="lg-inset p-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Counter Plan
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-100">
              {plan.enemyJunglePlaybook.counterPlan}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 border-t border-white/[0.08] pt-3.5 md:grid-cols-3">
          {plan.laneGankability.map((row) => (
            <div key={row.lane} className="lg-inset p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                  {row.lane} Lane
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                    row.verdict === 'Strong Side'
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : row.verdict === 'Playable'
                        ? 'bg-sky-500/20 text-sky-200'
                        : 'bg-slate-500/20 text-slate-300'
                  }`}
                >
                  {row.verdict} · {row.priorityScore}/10
                </span>
              </div>
              <div className="mt-1.5 text-[11px] font-medium text-white">
                {row.allyLabel} <span className="text-slate-500">vs</span> {row.enemyLabel}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">{row.tip}</p>
            </div>
          ))}
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
                aria-pressed={isCurrent}
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
              ? 'Built-in Coaching Preview'
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
