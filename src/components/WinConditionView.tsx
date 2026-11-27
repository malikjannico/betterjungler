import { Map as MapIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { formatChampionName } from '../domain/championNames';
import { synthesizeDemoWinConBrief } from '../domain/aiCoachFallback';
import { validateGroundedAiResponse } from '../domain/aiFactValidator';
import { getCachedAiResponse, hashAiContext, setCachedAiResponse } from '../domain/aiResponseCache';
import { DEFAULT_OBJECTIVE_TIMINGS } from '../domain/liveCoachEngine';
import type { EmptyReason } from '../domain/sessionContext';
import { generateAiDebrief } from '../services/tauriBridge';
import type {
  AiCoachConfig,
  ClimbGoal,
  DemoScenarioId,
  ObjectiveTimingsConfig,
  WinConditionPlan,
} from '../types/coaching';
import type { MapSide } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';
import { SummonersRiftMap } from './SummonersRiftMap';

interface WinConditionViewProps {
  plan: WinConditionPlan | null;
  mapSide: MapSide | null;
  championName: string | null;
  patchVersion: string;
  aiConfig: AiCoachConfig;
  focusGoal?: ClimbGoal | null;
  objectiveTimings?: ObjectiveTimingsConfig;
  emptyReason?: EmptyReason;
  draftProgress?: { locked: number; total: number };
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

export function WinConditionView({
  plan,
  mapSide,
  championName,
  patchVersion,
  aiConfig,
  focusGoal,
  objectiveTimings = DEFAULT_OBJECTIVE_TIMINGS,
  emptyReason,
  draftProgress,
  onPreviewSample,
}: WinConditionViewProps) {
  const [routeSelection, setRouteSelection] = useState<{
    recommendedId: string;
    selectedId: string;
  }>({
    recommendedId: plan?.recommendedRouteId ?? '',
    selectedId: plan?.recommendedRouteId ?? '',
  });
  const aiContextJson = useMemo(() => {
    if (!plan || !mapSide || !championName) return '';
    return JSON.stringify({
      championName: formatChampionName(championName),
      mapSide,
      strongSide: plan.strongSide,
      allyArchetype: plan.allyAnalysis.archetype,
      enemyArchetype: plan.enemyAnalysis.archetype,
      primaryWinCondition: plan.primaryWinCondition,
      enemyWinConditionToDeny: plan.enemyWinConditionToDeny,
      keyLevels: [4, 6, 11, 16],
      objectiveSpawnsSec: {
        scuttle: objectiveTimings.scuttleInitialSec,
        dragon: objectiveTimings.dragonFirstSpawnSec,
        voidgrubs: objectiveTimings.voidgrubsSpawnSec,
        herald: objectiveTimings.heraldSpawnSec,
        baron: objectiveTimings.baronSpawnSec,
      },
      patchVersion,
    });
  }, [plan, mapSide, championName, objectiveTimings, patchVersion]);
  const planKey = aiContextJson ? hashAiContext(aiContextJson) : '';
  const [aiBriefState, setAiBriefState] = useState<{
    planKey: string;
    text: string;
    verified: boolean;
  } | null>(null);
  const [aiErrorState, setAiErrorState] = useState<{
    planKey: string;
    message: string;
  } | null>(null);
  const [aiLoadingKey, setAiLoadingKey] = useState<string | null>(null);
  const aiLoading = aiLoadingKey === planKey;

  const cachedBrief = useMemo(() => {
    if (!planKey || !aiContextJson || aiConfig.provider === 'off') return null;
    const entry = getCachedAiResponse('win_con', planKey, aiConfig.provider, aiConfig.model);
    if (!entry) return null;
    return validateGroundedAiResponse(aiContextJson, entry.text).valid ? entry : null;
  }, [planKey, aiContextJson, aiConfig.provider, aiConfig.model]);
  const aiError =
    aiErrorState && aiErrorState.planKey === planKey ? aiErrorState.message : null;
  const hasLiveBrief = Boolean(aiBriefState && aiBriefState.planKey === planKey);
  const aiBrief = hasLiveBrief
    ? aiBriefState
    : !aiError && cachedBrief
      ? { planKey, text: cachedBrief.text, verified: cachedBrief.verified }
      : null;
  const aiBriefFromCache = !hasLiveBrief && !aiError && Boolean(cachedBrief);

  if (!plan || !mapSide || !championName) {
    const isDrafting = emptyReason === 'draft_in_progress' && draftProgress;
    return (
      <EmptyState
        icon={MapIcon}
        title={
          isDrafting
            ? `Draft in progress · ${draftProgress.locked}/${draftProgress.total} picks locked`
            : 'Win Plan & Map unlock once draft completes'
        }
        description={
          isDrafting
            ? 'Your custom jungle route, strong-side callout, and 1:15 ward targets lock in as soon as all 10 champions are confirmed.'
            : 'Enter Champion Select and lock all 10 champions (or start a match) to generate a draft-specific Win Plan and jungle route sequence.'
        }
        onPreviewSample={onPreviewSample ? () => onPreviewSample('loading') : undefined}
        sampleLabel="Preview sample plan & map"
      />
    );
  }

  const selectedRouteId =
    routeSelection.recommendedId === plan.recommendedRouteId
      ? routeSelection.selectedId
      : plan.recommendedRouteId;
  const setSelectedRouteId = (routeId: string) =>
    setRouteSelection({ recommendedId: plan.recommendedRouteId, selectedId: routeId });

  const activeRoute =
    plan.routes.find((r) => r.id === selectedRouteId) ??
    plan.routes.find((r) => r.id === plan.recommendedRouteId) ??
    plan.routes[0]!;

  async function handleGenerateBrief() {
    if (!plan || !mapSide || !championName || !aiContextJson) return;
    const displayChampion = formatChampionName(championName);
    const activeKey = planKey;
    setAiLoadingKey(activeKey);
    setAiBriefState(null);
    setAiErrorState(null);
    const ctx = aiContextJson;
    try {
      const text = await generateAiDebrief(ctx);
      const check = validateGroundedAiResponse(ctx, text);
      if (!check.valid) {
        setAiErrorState({
          planKey: activeKey,
          message: `Win-Con brief rejected by numeric fact validator — ungrounded figures: ${check.ungroundedTokens.join(', ')}`,
        });
        return;
      }
      if (aiConfig.provider !== 'off') {
        setCachedAiResponse('win_con', activeKey, aiConfig.provider, aiConfig.model, {
          text,
          verified: true,
        });
      }
      setAiBriefState({ planKey: activeKey, text, verified: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'DEMO_FALLBACK') {
        const fallback = synthesizeDemoWinConBrief(plan, displayChampion);
        const check = validateGroundedAiResponse(ctx, fallback);
        setAiBriefState({ planKey: activeKey, text: fallback, verified: check.valid });
      } else {
        setAiErrorState({
          planKey: activeKey,
          message: err instanceof Error ? err.message : 'AI Win-Con Brief failed.',
        });
      }
    } finally {
      setAiLoadingKey((prev) => (prev === activeKey ? null : prev));
    }
  }

  return (
    <div className="space-y-6">
      {focusGoal && (
        <div className="lg-inset flex flex-wrap items-center justify-between gap-2 px-4 py-2 t-caption">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sky-300">Match Focus</span>
            <span className="font-medium text-white/[0.92]">{focusGoal.title}</span>
          </div>
          <span className="tabular-nums text-white/[0.55]">
            Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
            {focusGoal.unit ? ` ${focusGoal.unit}` : ''}
          </span>
        </div>
      )}

      {/* Hairline-Divided Win Conditions */}
      <GlassSurface className="p-4">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="t-caption font-medium text-white/[0.55]">
              How we win · {formatChampionName(championName)}
            </div>
            <p className="t-body mt-1.5 text-white/[0.92]">
              {plan.primaryWinCondition}
            </p>
            <div className="t-caption mt-2.5 text-white/[0.62]">
              Strong side:{' '}
              <span className="font-semibold text-white">
                {plan.strongSide.toUpperCase()}
              </span>{' '}
              · Weak side: {plan.weakSide.toUpperCase()} · {plan.allyAnalysis.archetype}
            </div>
            <p className="t-caption mt-1 text-white/[0.45]">{plan.strongSideReason}</p>
          </div>

          <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="t-caption font-medium text-white/[0.55]">
              Enemy win condition to deny
            </div>
            <p className="t-body mt-1.5 text-white/[0.92]">
              {plan.enemyWinConditionToDeny}
            </p>
            <div className="t-caption mt-2.5 text-white/[0.62]">
              Enemy comp: {plan.enemyAnalysis.archetype}
            </div>
          </div>
        </div>

        {/* 3-Phase Gameplan */}
        <div className="mt-4 grid gap-4 border-t border-white/[0.08] pt-4 md:grid-cols-3">
          <div>
            <div className="t-caption font-semibold text-white/[0.92]">Early game (0–14m)</div>
            <p className="t-caption mt-1 leading-relaxed text-white/[0.62]">
              {plan.phasePlaybook.early}
            </p>
          </div>
          <div>
            <div className="t-caption font-semibold text-white/[0.92]">Mid game (14–25m)</div>
            <p className="t-caption mt-1 leading-relaxed text-white/[0.62]">
              {plan.phasePlaybook.mid}
            </p>
          </div>
          <div>
            <div className="t-caption font-semibold text-white/[0.92]">Late game (25m+)</div>
            <p className="t-caption mt-1 leading-relaxed text-white/[0.62]">
              {plan.phasePlaybook.late}
            </p>
          </div>
        </div>
      </GlassSurface>

      {/* Enemy Jungle Opening Playbook & Lane Gankability Matrix */}
      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="t-caption font-medium text-white/[0.55]">
              Enemy jungle opening &amp; lane gankability
            </div>
            <h3 className="t-title mt-0.5 text-white/[0.92]">
              vs {formatChampionName(plan.enemyJunglePlaybook.enemyChampionName)}
            </h3>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 t-caption font-semibold capitalize ${
              plan.enemyJunglePlaybook.invadeRisk === 'high'
                ? 'text-rose-300'
                : plan.enemyJunglePlaybook.invadeRisk === 'medium'
                  ? 'text-amber-300'
                  : 'text-emerald-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                plan.enemyJunglePlaybook.invadeRisk === 'high'
                  ? 'bg-rose-400'
                  : plan.enemyJunglePlaybook.invadeRisk === 'medium'
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
              }`}
            />
            Invade risk: {plan.enemyJunglePlaybook.invadeRisk}
          </span>
        </div>

        <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="t-caption font-medium text-white/[0.55]">Expected first clear</div>
            <p className="t-caption leading-relaxed text-white/[0.88]">
              {plan.enemyJunglePlaybook.expectedStart}
            </p>
          </div>
          <div className="space-y-1 md:border-l md:border-white/[0.06] md:pl-3">
            <div className="t-caption font-medium text-white/[0.55]">1:15 early ward target</div>
            <p className="t-caption leading-relaxed text-white/[0.88]">
              {plan.enemyJunglePlaybook.wardTarget115}
            </p>
          </div>
          <div className="space-y-1 md:border-l md:border-white/[0.06] md:pl-3">
            <div className="t-caption font-medium text-white/[0.55]">Counter plan</div>
            <p className="t-caption leading-relaxed text-white/[0.88]">
              {plan.enemyJunglePlaybook.counterPlan}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-white/[0.08] pt-3.5 md:grid-cols-3">
          {plan.laneGankability.map((row) => (
            <div key={row.lane} className="lg-inset p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="t-caption font-semibold capitalize text-white/[0.78]">
                  {row.lane} lane
                </span>
                <span
                  className={`t-caption font-semibold tabular-nums ${
                    row.verdict === 'Strong Side'
                      ? 'text-emerald-300'
                      : row.verdict === 'Playable'
                        ? 'text-sky-300'
                        : 'text-white/[0.55]'
                  }`}
                >
                  {row.verdict} · {row.priorityScore}/10
                </span>
              </div>
              <div className="t-caption mt-1.5 font-medium text-white/[0.92]">
                {row.allyLabel} <span className="text-white/[0.4]">vs</span> {row.enemyLabel}
              </div>
              <p className="t-caption mt-1 text-white/[0.55]">{row.tip}</p>
            </div>
          ))}
        </div>
      </GlassSurface>

      {/* Single-Row 4-Step Clear Sequence Selector */}
      <div className="space-y-2">
        <div className="flex flex-nowrap items-center justify-between gap-3">
          <div className="flex flex-nowrap items-center gap-3 overflow-x-auto">
            <span className="t-caption shrink-0 font-medium text-white/[0.62]">
              Clear sequence
            </span>
            <div
              role="group"
              aria-label="Clear sequence"
              className="lg-segmented-grid inline-grid grid-cols-4 gap-0.5"
            >
              {plan.routes.map((r) => {
                const isCurrent = activeRoute.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-label={r.label}
                    aria-pressed={isCurrent}
                    onClick={() => setSelectedRouteId(r.id)}
                    className={`relative flex h-6 min-w-[76px] items-center justify-center rounded-[7px] px-3 t-caption font-medium whitespace-nowrap transition-colors ${
                      isCurrent
                        ? 'font-semibold text-white'
                        : 'text-white/[0.58] hover:text-white/[0.92]'
                    }`}
                  >
                    {isCurrent && (
                      <motion.span
                        layoutId="clear-seq-pill"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        className="lg-segment-active absolute inset-0"
                      />
                    )}
                    <span className="relative z-10">{r.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <span className="tabular-nums t-caption shrink-0 font-medium text-white/[0.62]">
            {activeRoute.timeWindow}
          </span>
        </div>

        <p className="t-caption text-white/[0.72]">
          <span className="font-semibold text-white/[0.92]">{activeRoute.descriptor}</span>
          {' — '}
          <span className="text-white/[0.62]">{activeRoute.whyThisClear}</span>
        </p>
      </div>

      <SummonersRiftMap
        mapSide={mapSide}
        patchVersion={patchVersion}
        route={activeRoute}
        wardSpots={plan.wardSpots}
      />

      <GlassSurface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="t-caption font-medium text-white/[0.75]">
            AI Coach Pre-Game Brief (
            {aiConfig.provider === 'off'
              ? 'Built-in coaching preview'
              : `${aiConfig.provider.toUpperCase()} · ${aiConfig.model}`}
            )
          </span>
          <button
            type="button"
            disabled={aiLoading}
            onClick={() => void handleGenerateBrief()}
            className="lg-btn-glass px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {aiLoading
              ? 'Summarizing...'
              : aiBrief
                ? 'Regenerate Win-Con Brief'
                : 'Summarize Win-Con Brief'}
          </button>
        </div>
        {aiBrief && (
          <div className="mt-3 space-y-1.5">
            {(aiBrief.verified || aiBriefFromCache) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {aiBrief.verified && (
                  <div
                    title="Cited metrics and timestamps matched against provided match telemetry."
                    className="inline-flex items-center rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200"
                  >
                    Telemetry Numbers Checked
                  </div>
                )}
                {aiBriefFromCache && (
                  <div className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/[0.7]">
                    Cached
                  </div>
                )}
              </div>
            )}
            <pre className="lg-inset t-caption whitespace-pre-wrap p-3 font-sans leading-relaxed text-white/[0.88]">
              {aiBrief.text}
            </pre>
          </div>
        )}
        {aiError && <p className="t-caption mt-2 text-rose-300">{aiError}</p>}
      </GlassSurface>
    </div>
  );
}
