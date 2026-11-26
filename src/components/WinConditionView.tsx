import { useState } from 'react';
import { Bot, Crosshair, Shield, Swords, Target } from 'lucide-react';
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
  aiConfig: AiCoachConfig;
}

export function WinConditionView({
  plan,
  mapSide,
  championName,
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
    <div className="space-y-3.5">
      {/* Win Conditions */}
      <div className="grid gap-3.5 md:grid-cols-2">
        <GlassSurface interactive className="p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-200">
            <Target className="h-4 w-4 text-sky-300" />
            How We Win ({championName})
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">
            {plan.primaryWinCondition}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-sky-300/30 bg-sky-400/15 px-2.5 py-0.5 font-semibold text-sky-200">
              Strong Side: {plan.strongSide.toUpperCase()}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-slate-300">
              Weak Side: {plan.weakSide.toUpperCase()}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-slate-300">
              {plan.allyAnalysis.archetype}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">{plan.strongSideReason}</p>
        </GlassSurface>

        <GlassSurface interactive className="p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-rose-200">
            <Shield className="h-4 w-4 text-rose-300" />
            Enemy Win Condition to Deny
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-200">
            {plan.enemyWinConditionToDeny}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-rose-300/30 bg-rose-400/15 px-2.5 py-0.5 font-semibold text-rose-200">
              Enemy Comp: {plan.enemyAnalysis.archetype}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-slate-300">
              AD {plan.enemyAnalysis.adScore} / AP {plan.enemyAnalysis.apScore}
            </span>
          </div>
        </GlassSurface>
      </div>

      {/* 3-Phase Gameplan */}
      <div className="grid gap-3 md:grid-cols-3">
        <GlassSurface className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
            <Crosshair className="h-3.5 w-3.5" />
            Early Game (0–14m)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.early}
          </p>
        </GlassSurface>

        <GlassSurface className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
            <Swords className="h-3.5 w-3.5" />
            Mid Game (14–25m)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.mid}
          </p>
        </GlassSurface>

        <GlassSurface className="p-3.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-300">
            <Target className="h-3.5 w-3.5" />
            Late Game (25m+)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.late}
          </p>
        </GlassSurface>
      </div>

      {/* Segmented Route Switcher */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          Clear Route
        </span>
        <div className="lg-segmented flex flex-wrap gap-1">
          {plan.routes.map((r) => {
            const isCurrent = activeRoute.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRouteId(r.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  isCurrent
                    ? 'lg-segment-active'
                    : 'border border-transparent text-slate-300 hover:bg-white/[0.04]'
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
        strongSide={plan.strongSide}
        route={activeRoute}
        wardSpots={plan.wardSpots}
      />

      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-violet-200">
            <Bot className="h-4 w-4 text-violet-300" />
            <span>
              AI Coach Pre-Game Brief (
              {aiConfig.provider === 'off'
                ? 'Deterministic Preview'
                : `${aiConfig.provider.toUpperCase()} • ${aiConfig.model}`}
              )
            </span>
          </div>
          <button
            type="button"
            disabled={aiLoading}
            onClick={() => void handleGenerateBrief()}
            className="lg-btn-glass px-3 py-1 text-xs font-semibold text-violet-200 disabled:opacity-50"
          >
            {aiLoading ? 'Summarizing...' : 'Summarize Win-Con Brief'}
          </button>
        </div>
        {aiBrief && (
          <pre className="lg-inset mt-2.5 whitespace-pre-wrap p-3 font-sans text-xs leading-relaxed text-slate-200">
            {aiBrief}
          </pre>
        )}
      </GlassSurface>
    </div>
  );
}
