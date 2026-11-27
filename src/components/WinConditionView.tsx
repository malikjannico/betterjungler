import {
  ArrowRightLeft,
  BadgeCheck,
  Castle,
  Crosshair,
  Eye,
  Flag,
  Flame,
  HeartHandshake,
  Map as MapIcon,
  ShieldAlert,
  Sparkles,
  Timer,
  TreePine,
  TriangleAlert,
  Waves,
  Zap,
} from 'lucide-react';
import { useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { AdcWinConditionPlan, InferredEnemyBotLane, MacroPhasePlan } from '../domain/adc/types';
import { synthesizeDemoWinConBrief } from '../domain/aiCoachFallback';
import { validateGroundedAiResponse } from '../domain/aiFactValidator';
import { getCachedAiResponse, hashAiContext, setCachedAiResponse } from '../domain/aiResponseCache';
import { formatChampionName } from '../domain/championNames';
import { DEFAULT_OBJECTIVE_TIMINGS } from '../domain/liveCoachEngine';
import type { CoachedRole } from '../domain/roles/types';
import type { EmptyReason } from '../domain/sessionContext';
import { getItemIconUrl } from '../services/ddragonService';
import { generateAiDebrief } from '../services/tauriBridge';
import type {
  AiCoachConfig,
  ClimbGoal,
  DemoScenarioId,
  ObjectiveTimingsConfig,
  TeamCompAnalysis,
  WinConditionPlan,
} from '../types/coaching';
import type { MapSide } from '../types/riot';
import { EmptyState } from './EmptyState';
import { SummonersRiftMap } from './SummonersRiftMap';
import { M3Button, M3Card, M3Chip, M3ListItem, M3SegmentedButton, cx } from './m3';
import type { M3ChipTone } from './m3';

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
  /** Coached role currently driving the plan. `'bottom'` + `adcPlan` = ADC Bot Game Plan. */
  activeRole?: CoachedRole;
  adcPlan?: AdcWinConditionPlan | null;
  onSelectRole?: (role: CoachedRole) => void;
}

/** Season 2026 fixed lane/camp timings (objective spawns come from `objectiveTimings`). */
const MINION_WAVE_SEC = 30;
const CAMP_SPAWN_SEC = 55;
const PLATES_FALL_SEC = 840;

const ROLE_OPTIONS = [
  { value: 'jungle', label: 'Jungle', icon: <TreePine size={16} aria-hidden /> },
  { value: 'bottom', label: 'ADC · Bot', icon: <Crosshair size={16} aria-hidden /> },
] as const;

const ON_SURFACE = 'text-[var(--md-sys-color-on-surface)]';
const MUTED = 'text-[var(--md-sys-color-on-surface-variant)]';

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Corrects legacy pre-2026 timing phrases from upstream copy for display only. */
function season2026Text(text: string, scuttleSec: number): string {
  return text.replace(/\b3:30 Scuttle\b/g, `${fmtClock(scuttleSec)} Scuttle`);
}

function hideOnError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = 'hidden';
}

const RISK_TONE: Record<'low' | 'medium' | 'high', M3ChipTone> = {
  low: 'success',
  medium: 'warning',
  high: 'error',
};

const DRAGON_TONE: Record<'low' | 'medium' | 'high', M3ChipTone> = {
  low: 'plain',
  medium: 'warning',
  high: 'primary',
};

function likelyBotLabel(enemy: InferredEnemyBotLane | null | undefined): string {
  if (!enemy) return 'Likely enemy bot lane: not visible yet';
  return `Likely enemy bot lane: ${enemy.adcName ?? 'Unknown ADC'} + ${enemy.supportName ?? 'Unknown support'}`;
}

function Overline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'm3-label-m flex items-center gap-1.5 font-bold uppercase tracking-[0.7px]',
        className
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season 2026 objective track
// ---------------------------------------------------------------------------

interface TrackMark {
  sec: number;
  label: string;
  lane?: boolean;
}

function ObjectiveTrack({
  marks,
  highlight,
}: {
  marks: TrackMark[];
  highlight?: [number, number];
}) {
  const maxSec = Math.max(1260, ...marks.map((m) => m.sec + 60));
  const pct = (s: number) => `${(s / maxSec) * 100}%`;
  return (
    <M3Card variant="hero" as="section" aria-label="Season 2026 objective timings" className="!px-5 !py-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative h-11 min-w-[320px] flex-1">
          <div className="absolute inset-x-0 top-5 h-1 rounded-full bg-[var(--md-sys-color-secondary-container)]" />
          {highlight && (
            <div
              className="absolute top-[18px] h-2 rounded-full bg-[var(--md-sys-color-primary)] opacity-90"
              style={{ left: pct(highlight[0]), width: `max(10px, ${pct(highlight[1] - highlight[0])})` }}
            />
          )}
          {marks.map((m) => {
            const dim = highlight ? m.sec < highlight[0] - 5 || m.sec > highlight[1] + 5 : false;
            return (
              <div
                key={`${m.label}-${m.sec}`}
                className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5"
                style={{ left: pct(m.sec) }}
                title={`${m.label} · ${fmtClock(m.sec)}`}
              >
                <span
                  className={cx(
                    'm3-label-m whitespace-nowrap text-[11px] font-bold leading-[14px]',
                    dim ? 'text-[var(--md-sys-color-outline)]' : MUTED
                  )}
                >
                  {m.label}
                </span>
                <span
                  className={cx(
                    'mt-px h-3 w-3 shadow-[0_0_0_3px_var(--md-sys-color-surface-container)]',
                    m.lane ? 'rotate-45 rounded-[3px]' : 'rounded-full',
                    dim
                      ? 'bg-[var(--md-sys-color-outline-variant)]'
                      : m.lane
                        ? 'bg-[var(--md-ext-warning)]'
                        : 'bg-[var(--md-sys-color-tertiary)]'
                  )}
                />
                <span
                  className={cx(
                    'num whitespace-nowrap text-[11px] font-bold leading-[14px]',
                    dim ? 'text-[var(--md-sys-color-outline)]' : ON_SURFACE
                  )}
                >
                  {fmtClock(m.sec)}
                </span>
              </div>
            );
          })}
        </div>
        <M3Chip size="sm" tone="plain" className={ON_SURFACE} title="Atakhan removed for Season 2026">
          No Atakhan
        </M3Chip>
      </div>
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// Team comp breakdown
// ---------------------------------------------------------------------------

function CompBreakdown({ ally, enemy }: { ally: TeamCompAnalysis; enemy: TeamCompAnalysis }) {
  const rows: Array<[string, number, number]> = [
    ['Engage', ally.engageScore, enemy.engageScore],
    ['Crowd control', ally.ccScore, enemy.ccScore],
    ['Frontline', ally.frontlineScore, enemy.frontlineScore],
    ['Early power', ally.earlyPower, enemy.earlyPower],
    ['Late power', ally.latePower, enemy.latePower],
    ['AD weight', ally.adScore, enemy.adScore],
    ['AP weight', ally.apScore, enemy.apScore],
  ];
  return (
    <M3Card variant="hero" as="article" className="!p-4" aria-label="Team composition breakdown">
      <h3 className="m3-title-m mb-3">Team comp breakdown</h3>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <M3Card variant="module" className="!px-3 !py-2.5">
          <div className="m3-label-m font-bold text-[var(--md-sys-color-primary)]">Ally</div>
          <div className="m3-title-s">{ally.archetype}</div>
        </M3Card>
        <M3Card variant="module" className="!px-3 !py-2.5">
          <div className="m3-label-m font-bold text-[var(--md-sys-color-error)]">Enemy</div>
          <div className="m3-title-s">{enemy.archetype}</div>
        </M3Card>
      </div>
      <div className="space-y-2">
        {rows.map(([label, a, e]) => {
          const max = Math.max(10, a, e);
          return (
            <div key={label} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
              <span className={cx('m3-body-s', MUTED)}>{label}</span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--md-sys-color-secondary-container)]">
                    <div
                      className="h-full rounded-full bg-[var(--md-sys-color-primary)] transition-all duration-500 motion-reduce:transition-none"
                      style={{ width: `${(a / max) * 100}%` }}
                    />
                  </div>
                  <span className="num m3-label-m w-6 text-right">{a}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--md-sys-color-secondary-container)]">
                    <div
                      className="h-full rounded-full bg-[var(--md-sys-color-error)] transition-all duration-500 motion-reduce:transition-none"
                      style={{ width: `${(e / max) * 100}%` }}
                    />
                  </div>
                  <span className="num m3-label-m w-6 text-right">{e}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {ally.gaps.length > 0 && (
        <div className="mt-3">
          <M3Chip size="sm" tone="warning" icon={<TriangleAlert aria-hidden />}>
            Ally gaps: {ally.gaps.join(' · ')}
          </M3Chip>
        </div>
      )}
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// AI Tactical Brief
// ---------------------------------------------------------------------------

function AiBriefCard({
  aiConfig,
  loading,
  brief,
  fromCache,
  error,
  onGenerate,
}: {
  aiConfig: AiCoachConfig;
  loading: boolean;
  brief: { text: string; verified: boolean } | null;
  fromCache: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const tokens = brief?.verified
    ? Array.from(new Set(brief.text.match(/\b\d{1,2}:\d{2}\b/g) ?? []))
    : [];
  return (
    <M3Card variant="hero" as="article" className="!p-4" aria-label="AI Tactical Brief">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m3-title-m">AI Tactical Brief</h3>
          <p className={cx('m3-body-s', MUTED)}>
            {aiConfig.provider === 'off'
              ? 'Built-in coaching preview'
              : `${aiConfig.provider.toUpperCase()} · ${aiConfig.model}`}{' '}
            · grounded on draft + Season 2026 timings
          </p>
        </div>
        <M3Button
          variant="tonal"
          size="sm"
          disabled={loading}
          onClick={onGenerate}
          icon={<Sparkles size={16} aria-hidden />}
        >
          {loading ? 'Summarizing…' : brief ? 'Regenerate' : 'Generate brief'}
        </M3Button>
      </div>
      {brief && (
        <div className="space-y-2">
          {(brief.verified || fromCache) && (
            <div className="flex flex-wrap gap-1.5">
              {brief.verified && (
                <M3Chip
                  size="sm"
                  tone="success"
                  icon={<BadgeCheck aria-hidden />}
                  title="Cited metrics and timestamps matched against the provided draft & timing context."
                >
                  Numbers checked
                </M3Chip>
              )}
              {fromCache && (
                <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
                  Cached
                </M3Chip>
              )}
            </div>
          )}
          <pre className="m3-body-m whitespace-pre-wrap rounded-[16px] bg-[var(--md-sys-color-surface-container-lowest)] p-3 font-sans leading-relaxed text-[var(--md-sys-color-on-surface)]">
            {brief.text}
          </pre>
          {tokens.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label="Grounded timestamps">
              {tokens.map((t) => (
                <M3Chip key={t} size="sm" tone="success" className="num">
                  {t}
                </M3Chip>
              ))}
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="m3-body-s mt-2 text-[var(--md-sys-color-error)]">
          {error}
        </p>
      )}
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

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
  activeRole,
  adcPlan,
  onSelectRole,
}: WinConditionViewProps) {
  const [localRole, setLocalRole] = useState<CoachedRole>('jungle');
  const role: CoachedRole = activeRole ?? localRole;
  const isAdcMode = role === 'bottom' && Boolean(adcPlan);

  const [routeSelection, setRouteSelection] = useState<{
    recommendedId: string;
    selectedId: string;
  }>({
    recommendedId: plan?.recommendedRouteId ?? '',
    selectedId: plan?.recommendedRouteId ?? '',
  });
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);

  const aiContextJson = useMemo(() => {
    if (!mapSide || !championName) return '';
    if (isAdcMode && adcPlan) {
      return JSON.stringify({
        role: 'bottom',
        championName: formatChampionName(championName, adcPlan.championId),
        mapSide,
        archetype: adcPlan.archetype,
        botMatchup: {
          verdict: adcPlan.botMatchupSummary.verdict,
          level2Delta: adcPlan.botMatchupSummary.level2Delta,
          summary: adcPlan.botMatchupSummary.summary,
          likelyEnemyBotLane: likelyBotLabel(adcPlan.enemyBotLane),
        },
        wavePlan: {
          minionSpawnSec: adcPlan.wavePlan.minionSpawnSec,
          decision: adcPlan.wavePlan.decision,
          level2Rule: adcPlan.wavePlan.level2Rule,
          instruction: adcPlan.wavePlan.instruction,
        },
        supportPlaybook: adcPlan.supportSynergyPlaybook.playbook,
        enemyJunglerThreat: {
          name: adcPlan.enemyJunglerThreat.enemyJunglerName,
          threatLevel: adcPlan.enemyJunglerThreat.threatLevel,
          dangerWindowSec: [
            adcPlan.enemyJunglerThreat.dangerWindow.startSec,
            adcPlan.enemyJunglerThreat.dangerWindow.endSec,
          ],
          dangerWindowLabel: adcPlan.enemyJunglerThreat.dangerWindow.label,
          safeUntilSec: adcPlan.enemyJunglerThreat.safeUntilSec,
        },
        plateDeadlineSec: adcPlan.plateWindow.deadlineSec,
        dragon: {
          firstSpawnSec: adcPlan.dragonPriority.firstSpawnSec,
          priority: adcPlan.dragonPriority.priority,
        },
        midSwapTrigger: adcPlan.midSwap.trigger,
        macroPhases: adcPlan.macroPhases.map((p) => ({ label: p.label, timeWindow: p.timeWindow })),
        powerSpikes: adcPlan.powerSpikes.map((s) => ({ label: s.label, note: s.note })),
        primaryWinCondition: adcPlan.primaryWinCondition,
        enemyWinConditionToDeny: adcPlan.enemyWinConditionToDeny,
        objectiveSpawnsSec: {
          dragon: objectiveTimings.dragonFirstSpawnSec,
          voidgrubs: objectiveTimings.voidgrubsSpawnSec,
          herald: objectiveTimings.heraldSpawnSec,
          baron: objectiveTimings.baronSpawnSec,
        },
        patchVersion,
      });
    }
    if (!plan) return '';
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
        camps: CAMP_SPAWN_SEC,
        scuttle: objectiveTimings.scuttleInitialSec,
        dragon: objectiveTimings.dragonFirstSpawnSec,
        voidgrubs: objectiveTimings.voidgrubsSpawnSec,
        herald: objectiveTimings.heraldSpawnSec,
        baron: objectiveTimings.baronSpawnSec,
      },
      patchVersion,
    });
  }, [isAdcMode, adcPlan, plan, mapSide, championName, objectiveTimings, patchVersion]);
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

  const activePlan: WinConditionPlan | AdcWinConditionPlan | null = isAdcMode
    ? (adcPlan ?? null)
    : plan;

  if (!activePlan || !mapSide || !championName) {
    const isDrafting = emptyReason === 'draft_in_progress' && draftProgress;
    const wantsAdc = role === 'bottom';
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
            ? wantsAdc
              ? 'Your 2v2 bot matchup, level-2 wave plan, enemy jungler gank windows, and bot-lane vision targets lock in as soon as all 10 champions are confirmed.'
              : `Your custom jungle route (Clear 1 from ${fmtClock(CAMP_SPAWN_SEC)}, ${fmtClock(objectiveTimings.scuttleInitialSec)} Scuttle), strong-side callout, and Season 2026 ward targets lock in as soon as all 10 champions are confirmed.`
            : `Enter Champion Select and lock all 10 champions (or start a match) to generate a draft-specific Win Plan and ${wantsAdc ? 'bot-lane game plan' : 'jungle route sequence'}.`
        }
        onPreviewSample={onPreviewSample ? () => onPreviewSample('loading') : undefined}
        sampleLabel="Preview sample plan & map"
      />
    );
  }

  const displayChampion = formatChampionName(
    championName,
    isAdcMode && adcPlan ? adcPlan.championId : undefined
  );

  async function handleGenerateBrief() {
    if (!activePlan || !mapSide || !championName || !aiContextJson) return;
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
        const fallback = synthesizeDemoWinConBrief(activePlan, displayChampion);
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

  function selectRole(next: CoachedRole) {
    setLocalRole(next);
    onSelectRole?.(next);
  }

  const aiCard = (
    <AiBriefCard
      aiConfig={aiConfig}
      loading={aiLoading}
      brief={aiBrief}
      fromCache={aiBriefFromCache}
      error={aiError}
      onGenerate={() => void handleGenerateBrief()}
    />
  );

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="m3-headline-s">Win Plan &amp; Map</h2>
        <p className={cx('m3-body-s mt-0.5', MUTED)}>
          {displayChampion} {isAdcMode ? 'ADC' : 'jungle'} · {mapSide === 'blue' ? 'Blue' : 'Red'} side
          · Season 2026 · Patch {patchVersion}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {focusGoal && (
          <M3Chip tone="primary" className="num">
            <span className="font-bold">Match Focus</span>
            <span>{focusGoal.title}</span>
            <span>
              Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
              {focusGoal.unit ? ` ${focusGoal.unit}` : ''}
            </span>
          </M3Chip>
        )}
        <M3SegmentedButton<CoachedRole>
          ariaLabel="Coached role"
          size="sm"
          options={ROLE_OPTIONS}
          value={role}
          onChange={selectRole}
        />
      </div>
    </div>
  );

  const baseMarks: TrackMark[] = [
    { sec: MINION_WAVE_SEC, label: 'Wave', lane: true },
    { sec: CAMP_SPAWN_SEC, label: 'Camps' },
    { sec: objectiveTimings.scuttleInitialSec, label: 'Scuttle' },
    { sec: objectiveTimings.dragonFirstSpawnSec, label: 'Dragon' },
    { sec: objectiveTimings.voidgrubsSpawnSec, label: 'Grubs' },
    { sec: PLATES_FALL_SEC, label: 'Plates', lane: true },
    { sec: objectiveTimings.heraldSpawnSec, label: 'Herald' },
    { sec: objectiveTimings.baronSpawnSec, label: 'Baron' },
  ];

  // =========================================================================
  // ADC mode
  // =========================================================================
  if (isAdcMode && adcPlan) {
    const ap = adcPlan;
    const phases = [...ap.macroPhases].sort((a, b) => a.order - b.order);
    const activePhase: MacroPhasePlan | undefined =
      phases.find((p) => p.id === selectedPhaseId) ?? phases[0];
    const threat = ap.enemyJunglerThreat;
    const pushLv2 = ap.wavePlan.decision === 'push_lv2_all_in';
    const verdictTone: M3ChipTone =
      ap.botMatchupSummary.verdict === 'favored'
        ? 'success'
        : ap.botMatchupSummary.verdict === 'unfavored'
          ? 'error'
          : 'plain';
    const threatAxisMax = Math.max(360, threat.safeUntilSec + 60, threat.dangerWindow.endSec + 60);
    const axisPct = (s: number) => `${(Math.min(s, threatAxisMax) / threatAxisMax) * 100}%`;
    const adcMarks = baseMarks.filter((m) => m.label !== 'Camps' && m.label !== 'Scuttle');
    const highlight: [number, number] | undefined = activePhase
      ? [activePhase.startSec, activePhase.endSec ?? Math.max(activePhase.startSec + 120, objectiveTimings.baronSpawnSec)]
      : undefined;

    return (
      <div className="space-y-4">
        {header}
        <ObjectiveTrack marks={adcMarks} highlight={highlight} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-4">
            {/* Hero · 2v2 Bot Matchup & Level-2 Plan */}
            <M3Card variant="tonal" as="article" className="!p-5" aria-label="2v2 bot matchup and level-2 plan">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Overline className="text-[var(--md-sys-color-primary)]">
                    <Crosshair size={14} aria-hidden /> 2v2 Bot Matchup &amp; Level-2 Plan
                  </Overline>
                  <h3 className="m3-headline-s mt-1">{displayChampion} · {ap.archetype.replace('_', ' ')}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <M3Chip size="sm" tone={verdictTone} className={verdictTone === 'plain' ? ON_SURFACE : undefined}>
                    <span className="capitalize">{ap.botMatchupSummary.verdict}</span>
                  </M3Chip>
                  <M3Chip size="sm" tone="plain" className={cx('num', ON_SURFACE)}>
                    Lv2 Δ {ap.botMatchupSummary.level2Delta > 0 ? '+' : ''}
                    {ap.botMatchupSummary.level2Delta}
                  </M3Chip>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <M3Chip size="sm" tone="warning" title="Riot hides enemy positions in Solo/Duo — inferred from visible picks only">
                  Likely
                </M3Chip>
                <span className="m3-body-m">{likelyBotLabel(ap.enemyBotLane)}</span>
              </div>
              <p className="m3-body-m mt-2">{ap.botMatchupSummary.summary}</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[16px] bg-[rgba(12,14,19,0.4)] p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Waves size={16} aria-hidden />
                    <span className="m3-title-s">Wave plan</span>
                    <M3Chip size="sm" tone="primary" className="num">
                      Wave 1 · {fmtClock(ap.wavePlan.minionSpawnSec)}
                    </M3Chip>
                    <M3Chip size="sm" tone={pushLv2 ? 'success' : 'warning'}>
                      {pushLv2 ? 'Push for Lv2 All-In' : 'Concede & Trim'}
                    </M3Chip>
                  </div>
                  <p className="m3-body-s">{ap.wavePlan.level2Rule}</p>
                  <p className="m3-body-s mt-1 font-semibold">{ap.wavePlan.instruction}</p>
                </div>
                <div className="rounded-[16px] bg-[rgba(12,14,19,0.4)] p-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <HeartHandshake size={16} aria-hidden />
                    <span className="m3-title-s">Support synergy playbook</span>
                    {ap.supportSynergyPlaybook.supportName && (
                      <M3Chip size="sm" tone="tertiary" className="capitalize">
                        {ap.supportSynergyPlaybook.supportName}
                        {ap.supportSynergyPlaybook.supportArchetype
                          ? ` · ${ap.supportSynergyPlaybook.supportArchetype}`
                          : ''}
                      </M3Chip>
                    )}
                  </div>
                  <p className="m3-body-s">{ap.supportSynergyPlaybook.playbook}</p>
                  {ap.supportSynergyPlaybook.synergy?.comboNote && (
                    <p className="m3-body-s mt-1 font-semibold">{ap.supportSynergyPlaybook.synergy.comboNote}</p>
                  )}
                  {ap.supportSynergyPlaybook.allInWindows.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ap.supportSynergyPlaybook.allInWindows.map((w) => (
                        <M3Chip key={w} size="sm" tone="plain" className={ON_SURFACE}>
                          {w}
                        </M3Chip>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </M3Card>

            {/* Objective & Rotation strip */}
            <div className="grid gap-3 md:grid-cols-3" aria-label="Objective and rotation strip">
              <M3Card variant="module">
                <Overline className={MUTED}>
                  <Flame size={14} aria-hidden /> First Dragon
                </Overline>
                <div className="mt-1 flex items-center gap-2">
                  <b className="num m3-title-l">{fmtClock(ap.dragonPriority.firstSpawnSec)}</b>
                  <M3Chip
                    size="sm"
                    tone={DRAGON_TONE[ap.dragonPriority.priority]}
                    className={cx('capitalize', ap.dragonPriority.priority === 'low' && ON_SURFACE)}
                  >
                    {ap.dragonPriority.priority} priority
                  </M3Chip>
                </div>
                <p className="m3-body-s mt-1.5">{ap.dragonPriority.instruction}</p>
              </M3Card>
              <M3Card variant="module">
                <Overline className={MUTED}>
                  <Castle size={14} aria-hidden /> Plates deadline
                </Overline>
                <b className="num m3-title-l mt-1 block">{fmtClock(ap.plateWindow.deadlineSec)}</b>
                <p className="m3-body-s mt-1.5">{ap.plateWindow.instruction}</p>
              </M3Card>
              <M3Card variant="module">
                <Overline className={MUTED}>
                  <ArrowRightLeft size={14} aria-hidden /> Bot → Mid swap
                </Overline>
                <p className="m3-title-s mt-1">{ap.midSwap.trigger}</p>
                <p className="m3-body-s mt-1.5">{ap.midSwap.instruction}</p>
              </M3Card>
            </div>

            {/* 4 ordered macro phases */}
            <M3Card variant="hero" as="section" className="!p-5" aria-label="Macro phases">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="m3-title-m">Macro phases</h3>
                <M3SegmentedButton<string>
                  ariaLabel="Macro phase"
                  size="sm"
                  options={phases.map((p) => ({
                    value: p.id,
                    label: `${p.order}. ${p.label}`,
                    title: p.timeWindow,
                  }))}
                  value={activePhase?.id ?? ''}
                  onChange={setSelectedPhaseId}
                />
              </div>
              {activePhase && (
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div>
                    <M3Chip size="sm" tone="primary" className="num" icon={<Timer aria-hidden />}>
                      {activePhase.timeWindow}
                    </M3Chip>
                    <p className="m3-body-m mt-2">{activePhase.focus}</p>
                  </div>
                  <ol className="space-y-1.5">
                    {activePhase.actions.map((action, idx) => (
                      <li key={action} className="flex gap-2.5">
                        <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--md-sys-color-surface-container-highest)] text-[12px] font-extrabold text-[var(--md-sys-color-on-surface)]">
                          {idx + 1}
                        </span>
                        <span className="m3-body-m">{action}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-4 border-t border-[var(--md-sys-color-outline-variant)] pt-4">
                <Overline className={cx('mb-2', MUTED)}>
                  <Zap size={14} aria-hidden /> Power spikes
                </Overline>
                <div className="grid gap-2 md:grid-cols-3">
                  {ap.powerSpikes.map((spike) => (
                    <M3Card key={spike.label} variant="module" className="!p-3">
                      <div className="flex items-center gap-2">
                        <span className="m3-title-s">{spike.label}</span>
                        <span className="ml-auto flex gap-1">
                          {spike.itemIds.map((itemId) => (
                            <img
                              key={itemId}
                              src={getItemIconUrl(itemId, patchVersion)}
                              alt={`Item ${itemId}`}
                              className="h-7 w-7 rounded-[8px] bg-[var(--md-sys-color-surface-container-highest)]"
                              onError={hideOnError}
                            />
                          ))}
                        </span>
                      </div>
                      <p className="m3-body-s mt-1">{spike.note}</p>
                    </M3Card>
                  ))}
                </div>
              </div>
            </M3Card>

            {/* Bot lane vision map */}
            <M3Card variant="hero" as="section" className="!p-5" aria-label="Bot lane vision map">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="m3-title-m flex items-center gap-2">
                  <Eye size={18} aria-hidden /> Bot lane vision map
                </h3>
                <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
                  {ap.wardSpots.length} Season 2026 ward targets
                </M3Chip>
              </div>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <SummonersRiftMap
                  mapSide={mapSide}
                  patchVersion={patchVersion}
                  route={null}
                  wardSpots={ap.wardSpots}
                />
                <div className="space-y-1">
                  {ap.wardSpots.map((w) => (
                    <M3ListItem
                      key={w.id}
                      title={w.label}
                      description={w.reason}
                      meta={w.timing}
                      leading={
                        <span
                          aria-hidden
                          className="block h-3 w-3 rotate-45 rounded-[3px]"
                          style={{
                            background:
                              w.kind === 'control' ? 'var(--md-sys-color-error)' : 'var(--md-ext-warning)',
                          }}
                        />
                      }
                    />
                  ))}
                </div>
              </div>
            </M3Card>
          </div>

          <aside className="min-w-0 space-y-4" aria-label="Threats and coaching">
            {/* Enemy jungler gank timing */}
            <M3Card variant="hero" as="article" className="!p-4" aria-label="Enemy jungler gank timing and threats">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Overline className={MUTED}>
                    <ShieldAlert size={14} aria-hidden /> Enemy jungler gank timing
                  </Overline>
                  <h3 className="m3-title-m mt-0.5">vs {formatChampionName(threat.enemyJunglerName)}</h3>
                </div>
                <M3Chip size="sm" tone={RISK_TONE[threat.threatLevel]} className="capitalize">
                  {threat.threatLevel} threat
                </M3Chip>
              </div>

              <div className="flex items-start gap-3 rounded-[16px] bg-[var(--md-sys-color-error-container)] p-3 text-[var(--md-sys-color-on-error-container)]">
                <TriangleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="m3-title-s num">
                    Danger window {fmtClock(threat.dangerWindow.startSec)}–{fmtClock(threat.dangerWindow.endSec)}
                  </div>
                  <div className="m3-body-s">{threat.dangerWindow.label}</div>
                </div>
              </div>

              <div className="relative mt-4 h-6 rounded-full bg-[var(--md-sys-color-surface-container-low)]" aria-hidden>
                <span
                  className="absolute inset-y-0 rounded-full bg-[var(--md-ext-success-container)]"
                  style={{ left: 0, width: axisPct(Math.min(threat.safeUntilSec, threat.dangerWindow.startSec)) }}
                />
                <span
                  className="absolute inset-y-0 rounded-full bg-[var(--md-sys-color-error-container)]"
                  style={{
                    left: axisPct(threat.dangerWindow.startSec),
                    width: `max(16px, ${axisPct(threat.dangerWindow.endSec - threat.dangerWindow.startSec)})`,
                  }}
                />
                <span
                  className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-[var(--md-sys-color-on-surface)]"
                  style={{ left: axisPct(threat.safeUntilSec) }}
                />
              </div>
              <div className="num m3-label-m mt-1 flex justify-between text-[var(--md-sys-color-outline)]">
                <span>0:00</span>
                <span>{fmtClock(threatAxisMax / 2)}</span>
                <span>{fmtClock(threatAxisMax)}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <M3Chip size="sm" tone="success" className="num" icon={<Timer aria-hidden />}>
                  Safe until {fmtClock(threat.safeUntilSec)}
                </M3Chip>
                <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
                  Likely first side: {threat.likelyFirstSide === 'bot' ? 'Bot' : 'Top'}
                </M3Chip>
              </div>
              <p className="m3-body-s mt-2">{threat.instruction}</p>
            </M3Card>

            <M3Card variant="tonal" as="article" className="!p-4" aria-label="Win condition">
              <Overline className="text-[var(--md-sys-color-primary)]">
                <Flag size={14} aria-hidden /> How we win
              </Overline>
              <p className="m3-body-m mt-1.5">{ap.primaryWinCondition}</p>
              <p className="m3-body-s mt-2">
                <b>Deny:</b> {ap.enemyWinConditionToDeny}
              </p>
              <p className="m3-body-s mt-2">
                <b>Lane:</b> {ap.laneGamePlan}
              </p>
              <p className="m3-body-s mt-1">
                <b>Teamfights:</b> {ap.teamfightRole}
              </p>
            </M3Card>

            {ap.keyRules.length > 0 && (
              <M3Card variant="hero" as="article" className="!p-4" aria-label="Key rules">
                <h3 className="m3-title-m mb-2">Key rules</h3>
                <ul className="space-y-1.5">
                  {ap.keyRules.map((rule) => (
                    <li key={rule} className="m3-body-s flex gap-2">
                      <BadgeCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--md-sys-color-primary)]" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </M3Card>
            )}

            {aiCard}
          </aside>
        </div>
      </div>
    );
  }

  // =========================================================================
  // Jungle mode
  // =========================================================================
  const jp = plan!;
  const scuttleSec = objectiveTimings.scuttleInitialSec;
  const selectedRouteId =
    routeSelection.recommendedId === jp.recommendedRouteId
      ? routeSelection.selectedId
      : jp.recommendedRouteId;
  const setSelectedRouteId = (routeId: string) =>
    setRouteSelection({ recommendedId: jp.recommendedRouteId, selectedId: routeId });

  const activeRoute =
    jp.routes.find((r) => r.id === selectedRouteId) ??
    jp.routes.find((r) => r.id === jp.recommendedRouteId) ??
    jp.routes[0]!;

  const invadeRisk = jp.enemyJunglePlaybook.invadeRisk;

  return (
    <div className="space-y-4">
      {header}
      <ObjectiveTrack marks={baseMarks} highlight={[CAMP_SPAWN_SEC, scuttleSec]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Map board */}
        <M3Card variant="hero" as="section" className="min-w-0 !p-5" aria-label="Tactical map">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="m3-title-m truncate">
                {activeRoute.stageLabel} · {activeRoute.label}
              </h3>
              <p className={cx('m3-body-s num', MUTED)}>
                Clear 1 from {fmtClock(CAMP_SPAWN_SEC)} · Scuttle {fmtClock(scuttleSec)} ·{' '}
                {activeRoute.timeWindow}
              </p>
            </div>
            <M3SegmentedButton<string>
              ariaLabel="Clear sequence"
              size="sm"
              options={jp.routes.map((r) => ({
                value: r.id,
                label: r.shortLabel,
                title: r.label,
                badge: r.id === jp.recommendedRouteId ? '★' : undefined,
              }))}
              value={activeRoute.id}
              onChange={setSelectedRouteId}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_232px]">
            <SummonersRiftMap
              mapSide={mapSide}
              patchVersion={patchVersion}
              route={activeRoute}
              wardSpots={jp.wardSpots}
            />
            <div className="min-w-0">
              <div className={cx('m3-label-m mb-1 flex justify-between px-2', MUTED)}>
                <span>Camp order</span>
                <span className="num">{activeRoute.steps.length} steps</span>
              </div>
              <ol className="space-y-0.5">
                {activeRoute.steps.map((step) => (
                  <li
                    key={`${step.order}-${step.campId}`}
                    className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5 rounded-[12px] px-2 py-1.5"
                  >
                    <span className="num grid h-7 w-7 place-items-center rounded-full bg-[var(--md-sys-color-surface-container-highest)] text-[12px] font-extrabold text-[var(--md-sys-color-on-surface)]">
                      {step.order}
                    </span>
                    <span className="min-w-0">
                      <span className="num m3-label-m block font-bold text-[var(--md-sys-color-on-surface)]">
                        {step.targetTime}
                      </span>
                      <span className="m3-title-s block truncate">{step.campName}</span>
                      {step.note && <span className={cx('m3-body-s block', MUTED)}>{step.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <M3Card variant="module" className="mt-3 !px-4 !py-2.5">
            <p className="m3-body-s">
              <b>{activeRoute.descriptor}</b>{' '}
              <span className={MUTED}>— {season2026Text(activeRoute.whyThisClear, scuttleSec)}</span>
            </p>
          </M3Card>
        </M3Card>

        {/* Right column */}
        <aside className="min-w-0 space-y-4" aria-label="Win conditions and coaching">
          <M3Card variant="tonal" as="article" className="relative overflow-hidden !p-5" aria-label="Strong side">
            <div className="flex justify-between gap-3">
              <div>
                <Overline>Strong side</Overline>
                <div className="text-[56px] font-black leading-[56px] tracking-[-1.5px]">
                  {jp.strongSide.toUpperCase()}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <M3Chip size="sm" className="text-[var(--md-sys-color-on-primary-container)] shadow-[inset_0_0_0_1px_rgba(214,227,255,0.38)]">
                  Weak · {jp.weakSide.toUpperCase()}
                </M3Chip>
                <M3Chip size="sm" className="text-[var(--md-sys-color-on-primary-container)] shadow-[inset_0_0_0_1px_rgba(214,227,255,0.38)]">
                  {displayChampion} · {mapSide === 'blue' ? 'Blue' : 'Red'}
                </M3Chip>
              </div>
            </div>
            <p className="m3-body-m mt-2">
              <b>How we win:</b> {jp.primaryWinCondition}
            </p>
            <p className="m3-body-s mt-1.5 opacity-90">{jp.strongSideReason}</p>
            <p className="m3-body-s mt-1.5 opacity-90">
              <b>Deny:</b> {jp.enemyWinConditionToDeny}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {jp.laneGankability.map((row) => (
                <div
                  key={row.lane}
                  className="rounded-[12px] bg-[rgba(12,14,19,0.32)] px-2.5 py-1.5"
                  title={`${row.allyLabel} vs ${row.enemyLabel} — ${row.tip}`}
                >
                  <div className="m3-label-m text-[11px] font-bold uppercase opacity-90">
                    {row.lane === 'middle' ? 'Mid' : row.lane === 'bottom' ? 'Bot' : 'Top'} · {row.verdict}
                  </div>
                  <b className="num text-[18px] font-extrabold">{row.priorityScore}</b>
                  <span className="m3-body-s">/10</span>
                </div>
              ))}
            </div>
          </M3Card>

          <M3Card variant="hero" as="article" className="!p-4" aria-label="Enemy jungle opening">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className={cx('m3-label-m', MUTED)}>Enemy jungle opening · {jp.enemyAnalysis.archetype}</div>
                <h3 className="m3-title-m">vs {formatChampionName(jp.enemyJunglePlaybook.enemyChampionName)}</h3>
              </div>
              <M3Chip size="sm" tone={RISK_TONE[invadeRisk]} className="capitalize">
                Invade · {invadeRisk}
              </M3Chip>
            </div>
            <div className="space-y-2.5">
              <div>
                <div className={cx('m3-label-m', MUTED)}>Expected first clear (from {fmtClock(CAMP_SPAWN_SEC)})</div>
                <p className="m3-body-s mt-0.5">{season2026Text(jp.enemyJunglePlaybook.expectedStart, scuttleSec)}</p>
              </div>
              <div>
                <div className={cx('m3-label-m', MUTED)}>
                  Clear 1 vision target · before {fmtClock(scuttleSec)} Scuttle
                </div>
                <p className="m3-body-s mt-0.5">{jp.enemyJunglePlaybook.wardTarget115}</p>
              </div>
              <div>
                <div className={cx('m3-label-m', MUTED)}>Counter plan</div>
                <p className="m3-body-s mt-0.5">{season2026Text(jp.enemyJunglePlaybook.counterPlan, scuttleSec)}</p>
              </div>
            </div>
          </M3Card>

          {aiCard}

          <CompBreakdown ally={jp.allyAnalysis} enemy={jp.enemyAnalysis} />
        </aside>
      </div>

      {/* 3-phase gameplan */}
      <M3Card variant="hero" as="section" className="!p-5" aria-label="Phase playbook">
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              ['Early game', `${fmtClock(CAMP_SPAWN_SEC)}–${fmtClock(PLATES_FALL_SEC)}`, jp.phasePlaybook.early, <Flag key="e" size={14} aria-hidden />],
              ['Mid game', `${fmtClock(PLATES_FALL_SEC)}–25:00`, jp.phasePlaybook.mid, <Flame key="m" size={14} aria-hidden />],
              ['Late game', `${fmtClock(objectiveTimings.baronSpawnSec)}+ Baron`, jp.phasePlaybook.late, <Castle key="l" size={14} aria-hidden />],
            ] as const
          ).map(([title, timeWindow, text, icon]) => (
            <div key={title}>
              <div className="flex items-center gap-2">
                <span className="m3-title-s flex items-center gap-1.5">
                  {icon}
                  {title}
                </span>
                <M3Chip size="sm" tone="plain" className={cx('num', ON_SURFACE)}>
                  {timeWindow}
                </M3Chip>
              </div>
              <p className={cx('m3-body-s mt-1.5 leading-relaxed', MUTED)}>
                {season2026Text(text, scuttleSec)}
              </p>
            </div>
          ))}
        </div>
      </M3Card>
    </div>
  );
}
