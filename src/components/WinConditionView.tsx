import { useState } from 'react';
import { Bot, Crosshair, Shield, Swords, Target } from 'lucide-react';
import { synthesizeDemoWinConBrief } from '../domain/aiCoachFallback';
import { generateAiDebrief } from '../services/tauriBridge';
import { SummonersRiftMap } from './SummonersRiftMap';
import type { AiCoachConfig, WinConditionPlan } from '../types/coaching';
import type { MapSide } from '../types/riot';

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

  const activeRoute =
    plan.routes.find((r) => r.id === selectedRouteId) ??
    plan.routes.find((r) => r.id === plan.recommendedRouteId) ??
    plan.routes[0]!;

  return (
    <div className="space-y-3">
      {/* Win Conditions Header */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="hud-card rounded-xl border-cyan-500/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
            <Target className="h-4 w-4" />
            How We Win ({championName})
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
            {plan.primaryWinCondition}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-semibold text-cyan-200">
              Strong Side: {plan.strongSide.toUpperCase()}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              Weak Side: {plan.weakSide.toUpperCase()}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              Archetype: {plan.allyAnalysis.archetype}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">{plan.strongSideReason}</p>
        </div>

        <div className="hud-card rounded-xl border-rose-500/30 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
            <Shield className="h-4 w-4" />
            Enemy Win Condition to Deny
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
            {plan.enemyWinConditionToDeny}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded bg-rose-500/20 px-2 py-0.5 font-semibold text-rose-200">
              Enemy Comp: {plan.enemyAnalysis.archetype}
            </span>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              AD {plan.enemyAnalysis.adScore} / AP {plan.enemyAnalysis.apScore}
            </span>
          </div>
        </div>
      </div>

      {/* 3-Phase Gameplan */}
      <div className="grid gap-2 md:grid-cols-3">
        <div className="hud-card rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
            <Crosshair className="h-3.5 w-3.5" />
            Early Game (0–14m)
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.early}
          </p>
        </div>
        <div className="hud-card rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
            <Swords className="h-3.5 w-3.5" />
            Mid Game (14–25m)
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.mid}
          </p>
        </div>
        <div className="hud-card rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-violet-300">
            <Target className="h-3.5 w-3.5" />
            Late Game (25m+)
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {plan.phasePlaybook.late}
          </p>
        </div>
      </div>

      {/* Route Switcher + Interactive Tactical Map */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Clear Route:
        </span>
        {plan.routes.map((r) => {
          const isCurrent = activeRoute.id === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedRouteId(r.id)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                isCurrent
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                  : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500'
              }`}
            >
              {r.label}
              {r.id === plan.recommendedRouteId ? ' ★' : ''}
            </button>
          );
        })}
      </div>

      <SummonersRiftMap
        mapSide={mapSide}
        strongSide={plan.strongSide}
        route={activeRoute}
        wardSpots={plan.wardSpots}
      />

      <div className="hud-card rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-violet-300">
            <Bot className="h-4 w-4" />
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
            className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/25 disabled:opacity-50"
          >
            {aiLoading ? 'Summarizing...' : 'Summarize Win-Con Brief'}
          </button>
        </div>
        {aiBrief && (
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900/80 p-2.5 font-sans text-xs leading-relaxed text-slate-200">
            {aiBrief}
          </pre>
        )}
      </div>
    </div>
  );
}
