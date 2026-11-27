import { ArrowLeft, ChevronLeft, ChevronRight, History, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import pkg from '../../package.json';
import { analyzeAdcPostGameMatch } from '../domain/adc/adcPostGameEngine';
import { isAdcMatch } from '../domain/adc/adcKpis';
import type { AdcBenchmarkOverrides, AdcPostGameReviewReport } from '../domain/adc/adcReviewTypes';
import {
  synthesizeDemoAdcPostGameDebrief,
  synthesizeDemoPostGameDebrief,
} from '../domain/aiCoachFallback';
import { validateGroundedAiResponse } from '../domain/aiFactValidator';
import { getCachedAiResponse, hashAiContext, setCachedAiResponse } from '../domain/aiResponseCache';
import { formatChampionName } from '../domain/championNames';
import { evaluateFocusGoalAgainstMatch } from '../domain/climbLadderEngine';
import { formatClock } from '../domain/liveCoachEngine';
import { computePersonalLearningSnapshot } from '../domain/personalLearningEngine';
import {
  analyzePostGameMatch,
  formatRoleLabel,
  isJungleMatch,
} from '../domain/postGameReviewEngine';
import type { EmptyReason } from '../domain/sessionContext';
import { getChampionIconUrl } from '../services/ddragonService';
import { generateAiDebrief } from '../services/tauriBridge';
import type {
  AiCoachConfig,
  ClimbGoal,
  PostGameReviewReport,
  ReviewFinding,
  TimelineMapMarker,
} from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GoldXpDiffChart } from './GoldXpDiffChart';
import { M3Button, M3Card, M3Chip, M3SegmentedButton, cx } from './m3';
import { RecordingPlayerCard } from './RecordingPlayerCard';
import { RiftMap } from './RiftMap';

type MatchRoleKind = 'jungle' | 'adc' | 'off_role';
type MatchFilter = 'all' | 'jungle' | 'adc';
type Grade = PostGameReviewReport['grade'];

interface PostGameReviewViewProps {
  matches: MatchV5Detail[];
  targetDivision: string;
  patchVersion: string;
  appVersion?: string;
  aiConfig: AiCoachConfig;
  canSyncLive: boolean;
  isTauri?: boolean;
  focusGoal?: ClimbGoal | null;
  lastAutoSyncedMatchId?: string | null;
  autoSyncNotice?: string | null;
  emptyReason?: EmptyReason;
  roleBenchmarks?: AdcBenchmarkOverrides;
  onSyncMatches: () => Promise<void>;
  onOpenSettings?: (section?: 'account' | 'recording') => void;
}

interface FocusVerdict {
  status: 'met' | 'missed' | 'na';
  label: string;
  deltaLabel?: string;
}

interface MatchSummary {
  match: MatchV5Detail;
  kind: MatchRoleKind;
  roleLabel: string;
  championName: string;
  opponentName: string | null;
  grade: Grade;
  csPerMin: number;
  csAt10: number | null;
  killParticipationPct: number;
  takeaway: string;
  focus: FocusVerdict | null;
}

const MUTED = 'm3-muted';
const ON_SURFACE = 'text-[color:var(--md-sys-color-on-surface)]';

function matchRoleKind(match: MatchV5Detail): MatchRoleKind {
  if (isJungleMatch(match)) return 'jungle';
  if (isAdcMatch(match)) return 'adc';
  return 'off_role';
}

function gradeClasses(grade: Grade): string {
  switch (grade) {
    case 'S':
      return 'bg-[color:var(--md-ext-warning-container)] text-[color:var(--md-ext-on-warning-container)]';
    case 'A':
      return 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]';
    case 'B':
      return 'bg-[color:var(--md-sys-color-secondary-container)] text-[color:var(--md-sys-color-on-secondary-container)]';
    case 'N/A':
      return 'bg-[color:var(--md-sys-color-surface-container-highest)] text-[color:var(--md-sys-color-on-surface)]';
    default:
      return 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]';
  }
}

function formatPlayedAt(playedAt: string): string {
  const ms = Date.parse(playedAt);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function signed(value: number, unit = ''): string {
  return `${value >= 0 ? '+' : ''}${value}${unit}`;
}

function firstTakeaway(report: {
  mistakes: ReviewFinding[];
  improvements: ReviewFinding[];
  highlights: ReviewFinding[];
}): string | null {
  return (
    report.mistakes[0]?.detail ??
    report.improvements[0]?.detail ??
    report.highlights[0]?.detail ??
    null
  );
}

function adcFocusKpis(report: AdcPostGameReviewReport) {
  const k = report.kpis;
  return {
    csPerMin: k.csPerMin,
    csAt10: k.csAt10 ?? undefined,
    goldDiffAt15: k.goldDiffAt15 ?? Number.NaN,
    damageSharePct: k.damageSharePct ?? undefined,
    deathsPre14: k.deathsPre14,
    turretPlates: k.turretPlates,
    killParticipationPct: k.killParticipationPct,
  };
}

function toFocusVerdict(
  goal: ClimbGoal,
  kind: MatchRoleKind,
  jungleReport: PostGameReviewReport | null,
  adcReport: AdcPostGameReviewReport | null
): FocusVerdict {
  const goalRole: MatchRoleKind = goal.role === 'bottom' ? 'adc' : 'jungle';
  if (kind === 'off_role') return { status: 'na', label: 'Focus n/a · off-role' };
  if (goalRole !== kind) {
    return { status: 'na', label: `Focus n/a · ${goalRole === 'adc' ? 'ADC' : 'Jungle'} goal` };
  }
  const result =
    kind === 'jungle' && jungleReport
      ? evaluateFocusGoalAgainstMatch(goal, jungleReport.kpis)
      : adcReport
        ? evaluateFocusGoalAgainstMatch(goal, adcFocusKpis(adcReport))
        : null;
  if (!result || result.deltaLabel === 'Metric unavailable') {
    return { status: 'na', label: 'Focus n/a · metric unavailable' };
  }
  return {
    status: result.passed ? 'met' : 'missed',
    label: result.passed ? 'Focus PASS' : 'Focus MISS',
    deltaLabel: result.deltaLabel,
  };
}

function toReplayMarkers(report: AdcPostGameReviewReport): TimelineMapMarker[] {
  return report.markers.map((marker): TimelineMapMarker => ({
    ...marker,
    kind:
      marker.kind === 'plate'
        ? 'objective'
        : marker.kind === 'isolated_death'
          ? 'pre_obj_death'
          : marker.kind,
  }));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function PostGameReviewView({
  matches,
  targetDivision,
  patchVersion,
  appVersion = pkg.version,
  aiConfig,
  canSyncLive,
  isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__),
  focusGoal,
  lastAutoSyncedMatchId,
  autoSyncNotice,
  emptyReason,
  roleBenchmarks,
  onSyncMatches,
  onOpenSettings,
}: PostGameReviewViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatchFilter>('all');
  const [openedIds, setOpenedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [baselineIds, setBaselineIds] = useState<ReadonlySet<string> | null>(() =>
    matches.length > 0 ? new Set(matches.map((m) => m.matchId)) : null
  );
  if (baselineIds === null && matches.length > 0) {
    setBaselineIds(new Set(matches.map((m) => m.matchId)));
  }
  const [activeSecondState, setActiveSecondState] = useState<{
    matchId: string;
    second: number | null;
  }>({ matchId: '', second: null });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [aiLoadingMatchId, setAiLoadingMatchId] = useState<string | null>(null);
  const [aiDebriefState, setAiDebriefState] = useState<{
    matchId: string;
    text: string | null;
    verified?: boolean;
  }>({ matchId: '', text: null, verified: false });
  const [aiErrorState, setAiErrorState] = useState<{
    matchId: string;
    message: string | null;
  }>({ matchId: '', message: null });
  const [exportFeedbackState, setExportFeedbackState] = useState<{
    matchId: string;
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const pendingRevokesRef = useRef<Array<{ timerId: number; url: string }>>([]);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastOpenedIdRef = useRef<string | null>(null);
  const timelineCardRef = useRef<HTMLDivElement | null>(null);
  const detailTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const revokes = pendingRevokesRef;
    return () => {
      mountedRef.current = false;
      for (const entry of revokes.current) {
        window.clearTimeout(entry.timerId);
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(entry.url);
        }
      }
      revokes.current = [];
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Summaries for the stacked match list
  // ---------------------------------------------------------------------------
  const summaries = useMemo<MatchSummary[]>(
    () =>
      matches.map((match): MatchSummary => {
        const kind = matchRoleKind(match);
        const jungleReport = kind === 'adc' ? null : analyzePostGameMatch(match, targetDivision);
        const adcReport =
          kind === 'adc' ? analyzeAdcPostGameMatch(match, targetDivision, roleBenchmarks) : null;
        const championName = formatChampionName(match.championName, match.championId);
        const opponentName =
          kind === 'jungle'
            ? formatChampionName(match.enemyJunglerName, match.enemyJunglerChampionId)
            : kind === 'adc'
              ? (adcReport?.laneOpponentName ?? null)
              : match.laneOpponentName && match.laneOpponentName !== 'Unknown'
                ? formatChampionName(match.laneOpponentName, match.laneOpponentChampionId)
                : null;
        const roleLabel = formatRoleLabel(match.role);
        const takeaway =
          kind === 'off_role'
            ? `Off-role ${roleLabel} game — scoreboard stats only, excluded from Jungle/ADC climb baselines.`
            : (firstTakeaway((adcReport ?? jungleReport)!) ??
              (kind === 'adc'
                ? 'Clean bot lane fundamentals across the laning phase.'
                : 'Solid jungle fundamentals across objective setups.'));
        return {
          match,
          kind,
          roleLabel,
          championName,
          opponentName,
          grade: kind === 'off_role' ? 'N/A' : (adcReport?.grade ?? jungleReport!.grade),
          csPerMin: adcReport?.kpis.csPerMin ?? jungleReport!.kpis.csPerMin,
          csAt10: adcReport ? adcReport.kpis.csAt10 : (jungleReport!.kpis.csAt10 ?? null),
          killParticipationPct:
            adcReport?.kpis.killParticipationPct ?? jungleReport!.kpis.killParticipationPct,
          takeaway,
          focus: focusGoal ? toFocusVerdict(focusGoal, kind, jungleReport, adcReport) : null,
        };
      }),
    [matches, targetDivision, roleBenchmarks, focusGoal]
  );

  const counts = useMemo(
    () => ({
      all: summaries.length,
      jungle: summaries.filter((s) => s.kind === 'jungle').length,
      adc: summaries.filter((s) => s.kind === 'adc').length,
    }),
    [summaries]
  );
  const filteredSummaries = useMemo(
    () => (filter === 'all' ? summaries : summaries.filter((s) => s.kind === filter)),
    [summaries, filter]
  );

  const newIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of matches) {
      const isFresh =
        (baselineIds !== null && !baselineIds.has(m.matchId)) ||
        m.matchId === lastAutoSyncedMatchId;
      if (isFresh && !openedIds.has(m.matchId)) ids.add(m.matchId);
    }
    return ids;
  }, [matches, baselineIds, lastAutoSyncedMatchId, openedIds]);

  // ---------------------------------------------------------------------------
  // Selected match (detail subpage). Auto-sync never changes this selection.
  // ---------------------------------------------------------------------------
  const selectedMatch = selectedMatchId
    ? (matches.find((m) => m.matchId === selectedMatchId) ?? null)
    : null;
  const selectedKind: MatchRoleKind | null = selectedMatch ? matchRoleKind(selectedMatch) : null;

  const report = useMemo(
    () =>
      selectedMatch && selectedKind !== 'adc'
        ? analyzePostGameMatch(selectedMatch, targetDivision)
        : null,
    [selectedMatch, selectedKind, targetDivision]
  );
  const adcReport = useMemo(
    () =>
      selectedMatch && selectedKind === 'adc'
        ? analyzeAdcPostGameMatch(selectedMatch, targetDivision, roleBenchmarks)
        : null,
    [selectedMatch, selectedKind, targetDivision, roleBenchmarks]
  );

  const aiContextJson = useMemo(() => {
    if (selectedKind === 'jungle' && report && report.isJungle) {
      return JSON.stringify({
        champion: report.championName,
        enemyJungler: report.enemyJunglerName,
        duration: formatClock(report.durationSeconds),
        win: report.win,
        grade: report.grade,
        targetDivision,
        kpis: report.kpis,
        highlights: report.highlights.map((h) => h.title),
        mistakes: report.mistakes.map((m) => m.title),
        improvements: report.improvements.map((imp) => imp.title),
      });
    }
    if (selectedKind === 'adc' && adcReport && adcReport.isAdc) {
      return JSON.stringify({
        role: 'bottom',
        champion: adcReport.championName,
        laneOpponent: adcReport.laneOpponentName,
        duration: formatClock(adcReport.durationSeconds),
        win: adcReport.win,
        grade: adcReport.grade,
        targetDivision,
        isProvisionalBenchmark: adcReport.isProvisional,
        kpis: adcReport.kpis,
        highlights: adcReport.highlights.map((h) => h.title),
        mistakes: adcReport.mistakes.map((m) => m.title),
        improvements: adcReport.improvements.map((imp) => imp.title),
      });
    }
    return '';
  }, [selectedKind, report, adcReport, targetDivision]);

  const aiCacheKey =
    selectedMatch && aiContextJson
      ? `${selectedMatch.matchId}:${hashAiContext(aiContextJson)}`
      : '';

  const cachedDebrief = useMemo(() => {
    if (!aiCacheKey || !aiContextJson || aiConfig.provider === 'off') return null;
    const entry = getCachedAiResponse('post_game', aiCacheKey, aiConfig.provider, aiConfig.model);
    if (!entry) return null;
    return validateGroundedAiResponse(aiContextJson, entry.text).valid ? entry : null;
  }, [aiCacheKey, aiContextJson, aiConfig.provider, aiConfig.model]);
  const aiError =
    aiCacheKey && aiErrorState.matchId === aiCacheKey ? aiErrorState.message : null;
  const hasLiveMatchDebrief = Boolean(
    aiCacheKey && aiDebriefState.matchId === aiCacheKey && aiDebriefState.text !== null
  );
  const aiDebrief = hasLiveMatchDebrief
    ? aiDebriefState.text
    : !aiError && cachedDebrief
      ? cachedDebrief.text
      : null;
  const aiDebriefVerified = hasLiveMatchDebrief
    ? Boolean(aiDebriefState.verified)
    : !aiError && Boolean(cachedDebrief?.verified);
  const aiDebriefFromCache = !hasLiveMatchDebrief && !aiError && Boolean(cachedDebrief);
  const isAiLoading = Boolean(aiCacheKey && aiLoadingMatchId === aiCacheKey);
  const exportFeedback =
    selectedMatch && exportFeedbackState?.matchId === selectedMatch.matchId
      ? exportFeedbackState
      : null;

  const personalLearning = useMemo(() => {
    if (selectedKind !== 'jungle') return null;
    const jgMatches = matches.filter(
      (m) => isJungleMatch(m) && m.matchId !== selectedMatch?.matchId
    );
    return computePersonalLearningSnapshot(jgMatches, matches, targetDivision);
  }, [matches, selectedKind, selectedMatch?.matchId, targetDivision]);

  const selectedSummary = selectedMatch
    ? (summaries.find((s) => s.match.matchId === selectedMatch.matchId) ?? null)
    : null;

  // Newer / Older stepping within the active filter (falls back to all matches).
  const stepList =
    selectedMatch && filteredSummaries.some((s) => s.match.matchId === selectedMatch.matchId)
      ? filteredSummaries
      : summaries;
  const stepIndex = selectedMatch
    ? stepList.findIndex((s) => s.match.matchId === selectedMatch.matchId)
    : -1;
  const newerSummary = stepIndex > 0 ? stepList[stepIndex - 1] : undefined;
  const olderSummary =
    stepIndex >= 0 && stepIndex < stepList.length - 1 ? stepList[stepIndex + 1] : undefined;

  function openMatch(matchId: string) {
    lastOpenedIdRef.current = matchId;
    setSelectedMatchId(matchId);
    setOpenedIds((prev) => {
      if (prev.has(matchId)) return prev;
      const next = new Set(prev);
      next.add(matchId);
      return next;
    });
  }

  function backToList() {
    setSelectedMatchId(null);
  }

  // Esc returns to the list (ignored while typing in a field).
  useEffect(() => {
    if (selectedMatchId === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      setSelectedMatchId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedMatchId]);

  // Restore keyboard focus to the card that was opened; move focus to the detail header on open.
  useEffect(() => {
    if (selectedMatchId === null) {
      const id = lastOpenedIdRef.current;
      if (id) cardRefs.current.get(id)?.focus();
    } else {
      detailTopRef.current?.focus();
    }
  }, [selectedMatchId]);

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const ids = filteredSummaries.map((s) => s.match.matchId);
    if (ids.length === 0) return;
    const active = document.activeElement;
    const currentIdx = ids.findIndex((id) => cardRefs.current.get(id) === active);
    const nextIdx =
      currentIdx === -1
        ? 0
        : event.key === 'ArrowDown'
          ? Math.min(ids.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx - 1);
    event.preventDefault();
    cardRefs.current.get(ids[nextIdx]!)?.focus();
  }

  function handleExportReview() {
    if (!selectedMatch) return;
    const base = {
      schemaVersion: 1,
      appVersion,
      exportedAt: new Date().toISOString(),
      targetDivision,
    };
    const payload = adcReport
      ? {
          ...base,
          matchId: adcReport.matchId,
          role: adcReport.role,
          isAdc: adcReport.isAdc,
          championName: adcReport.championName,
          laneOpponentName: adcReport.laneOpponentName,
          win: adcReport.win,
          durationSeconds: adcReport.durationSeconds,
          grade: adcReport.grade,
          isProvisionalBenchmark: adcReport.isProvisional,
          kpis: adcReport.kpis,
          highlights: adcReport.highlights,
          mistakes: adcReport.mistakes,
          improvements: adcReport.improvements,
        }
      : report
        ? {
            ...base,
            matchId: report.matchId,
            role: report.role,
            isJungle: report.isJungle,
            championName: report.championName,
            enemyJunglerName: report.enemyJunglerName,
            win: report.win,
            durationSeconds: report.durationSeconds,
            grade: report.grade,
            kpis: report.kpis,
            highlights: report.highlights,
            mistakes: report.mistakes,
            improvements: report.improvements,
          }
        : null;
    if (!payload) return;

    const filename = `betterjungler-review-${selectedMatch.matchId}.json`;
    try {
      const json = JSON.stringify(payload, null, 2);
      const anchor = document.createElement('a');
      anchor.download = filename;

      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        try {
          anchor.href = url;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
          const timerId = window.setTimeout(() => {
            pendingRevokesRef.current = pendingRevokesRef.current.filter(
              (entry) => entry.url !== url
            );
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(url);
            }
          }, 1000);
          pendingRevokesRef.current.push({ timerId, url });
        }
      } else {
        try {
          anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
          document.body.appendChild(anchor);
          anchor.click();
        } finally {
          anchor.remove();
        }
      }
      setExportFeedbackState({
        matchId: selectedMatch.matchId,
        kind: 'success',
        message: `Exported ${filename}`,
      });
    } catch (err) {
      setExportFeedbackState({
        matchId: selectedMatch.matchId,
        kind: 'error',
        message: err instanceof Error ? err.message : 'Unable to export review JSON',
      });
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await onSyncMatches();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Failed to sync Riot matches.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleGenerateAiDebrief() {
    if (!aiContextJson || !aiCacheKey) return;
    if (!(report?.isJungle && selectedKind === 'jungle') && !(adcReport?.isAdc && selectedKind === 'adc')) {
      return;
    }
    const requestCacheKey = aiCacheKey;
    const context = aiContextJson;
    const fallbackSource =
      selectedKind === 'adc' && adcReport
        ? () => synthesizeDemoAdcPostGameDebrief(adcReport)
        : () => synthesizeDemoPostGameDebrief(report!);
    setAiLoadingMatchId(requestCacheKey);
    setAiDebriefState({ matchId: requestCacheKey, text: null, verified: false });
    setAiErrorState({ matchId: requestCacheKey, message: null });

    try {
      const response = await generateAiDebrief(context);
      if (!mountedRef.current) return;
      const check = validateGroundedAiResponse(context, response);
      if (!check.valid) {
        setAiErrorState({
          matchId: requestCacheKey,
          message: `AI debrief rejected by numeric fact validator — ungrounded figures: ${check.ungroundedTokens.join(', ')}`,
        });
        return;
      }
      if (aiConfig.provider !== 'off') {
        setCachedAiResponse('post_game', requestCacheKey, aiConfig.provider, aiConfig.model, {
          text: response,
          verified: true,
        });
      }
      setAiDebriefState({ matchId: requestCacheKey, text: response, verified: true });
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof Error && err.message === 'DEMO_FALLBACK') {
        const fallback = fallbackSource();
        const check = validateGroundedAiResponse(context, fallback);
        setAiDebriefState({ matchId: requestCacheKey, text: fallback, verified: check.valid });
      } else {
        setAiErrorState({
          matchId: requestCacheKey,
          message: err instanceof Error ? err.message : 'AI Debrief failed.',
        });
      }
    } finally {
      if (mountedRef.current) {
        setAiLoadingMatchId((prev) => (prev === requestCacheKey ? null : prev));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (matches.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={History}
          title="No ranked matches loaded yet"
          description={
            emptyReason === 'no_account' || !canSyncLive
              ? 'Save your Riot ID & Personal Riot API Key in Settings to download Match-V5 timelines and review pathing, objectives, and mistakes.'
              : 'Sync your recent ranked games to review minute-by-minute gold swings, pathing replay, and objective mistakes.'
          }
          action={
            canSyncLive
              ? {
                  label: syncing ? 'Syncing...' : 'Sync Recent Games',
                  onClick: () => void handleSync(),
                  disabled: syncing,
                }
              : onOpenSettings
                ? { label: 'Open Settings', onClick: () => onOpenSettings('account') }
                : undefined
          }
        >
          {syncError && (
            <p className="m3-body-s mt-3 rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-sys-color-error-container)] px-3 py-2 text-[color:var(--md-sys-color-on-error-container)]">
              {syncError}
            </p>
          )}
        </EmptyState>
      </div>
    );
  }

  const syncDisabled =
    syncing ||
    (!canSyncLive && typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__));
  const syncLabel = syncing
    ? 'Syncing...'
    : canSyncLive
      ? 'Sync Recent Games'
      : 'Refresh Sample Games';

  // ===========================================================================
  // VIEW B — Match Detail subpage
  // ===========================================================================
  if (selectedMatch && selectedSummary) {
    const activeSecond =
      activeSecondState.matchId === selectedMatch.matchId ? activeSecondState.second : null;
    const cursorSecond = activeSecond ?? selectedMatch.durationSeconds;
    const setCursor = (second: number) =>
      setActiveSecondState({ matchId: selectedMatch.matchId, second: Math.round(second) });
    const jumpToSecond = (second: number) => {
      setCursor(second);
      const node = timelineCardRef.current;
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const title =
      selectedKind === 'jungle' && report
        ? `${report.championName} vs ${report.enemyJunglerName}`
        : selectedKind === 'adc' && adcReport
          ? `${adcReport.championName} vs ${adcReport.laneOpponentName}`
          : `${selectedSummary.championName} (${selectedSummary.roleLabel})`;

    const focusVerdict = selectedSummary.focus;

    return (
      <div className="m3-view-enter space-y-4">
        {/* Sticky sub-header flush to scroll top */}
        <div
          ref={detailTopRef}
          tabIndex={-1}
          className="sticky top-0 z-30 -mx-2 -mt-2 flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--md-sys-color-outline-variant)] bg-[color:var(--md-sys-color-surface)] px-2 pb-2.5 pt-3 outline-none"
        >
          <M3Button
            variant="tonal"
            size="sm"
            icon={<ArrowLeft aria-hidden />}
            onClick={backToList}
            aria-label="Back to all matches"
            title="Back to all matches (Esc)"
          >
            All Matches
          </M3Button>
          <div className="flex items-center gap-1">
            <M3Button
              variant="text"
              size="sm"
              icon={<ChevronLeft aria-hidden />}
              disabled={!newerSummary}
              onClick={() => newerSummary && openMatch(newerSummary.match.matchId)}
            >
              Newer
            </M3Button>
            <span className={cx('m3-label-m num', MUTED)}>
              {stepIndex + 1} of {stepList.length}
            </span>
            <M3Button
              variant="text"
              size="sm"
              trailingIcon={<ChevronRight aria-hidden />}
              disabled={!olderSummary}
              onClick={() => olderSummary && openMatch(olderSummary.match.matchId)}
            >
              Older
            </M3Button>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <img
              src={getChampionIconUrl(selectedMatch.championName, patchVersion)}
              alt=""
              className="h-8 w-8 rounded-[var(--md-sys-shape-corner-small)]"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <h2 className="m3-title-l truncate">{title}</h2>
            <RoleChips summary={selectedSummary} />
            <span
              className={cx(
                'm3-label-m rounded-full px-2.5 py-0.5 font-bold',
                selectedMatch.win
                  ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
                  : 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
              )}
            >
              {selectedMatch.win ? 'Victory' : 'Defeat'} · {formatClock(selectedMatch.durationSeconds)}
            </span>
            <GradeBadge grade={selectedSummary.grade} kind={selectedSummary.kind} />
          </div>
          {selectedKind !== 'off_role' && (
            <M3Button variant="outlined" size="sm" onClick={handleExportReview}>
              Export Review JSON
            </M3Button>
          )}
        </div>

        {exportFeedback && (
          <p
            role={exportFeedback.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'm3-body-s rounded-[var(--md-sys-shape-corner-medium)] px-3 py-2',
              exportFeedback.kind === 'error'
                ? 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
                : 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
            )}
          >
            {exportFeedback.message}
          </p>
        )}

        {/* ---------------- Jungle detail ---------------- */}
        {selectedKind === 'jungle' && report && (
          <>
            <M3Card variant="hero" as="section" aria-label="Match summary">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className={cx('m3-label-m', MUTED)}>
                    Jungle evaluation benchmarked against {targetDivision}
                  </div>
                  <TakeawayCallout
                    text={
                      firstTakeaway(report) ?? 'Solid jungle fundamentals across objective setups.'
                    }
                  />
                  {personalLearning &&
                    personalLearning.jungleMatchCount >= 3 &&
                    personalLearning.baselines?.csPerMin && (
                      <p className={cx('m3-body-s num mt-2', MUTED)}>
                        vs Personal EWM Baseline:{' '}
                        {personalLearning.baselines.csPerMin.shrunkBaseline} CS/min ·{' '}
                        {personalLearning.baselines.visionPerMin.shrunkBaseline} vis/min ·{' '}
                        {personalLearning.baselines.preObjectiveDeaths.shrunkBaseline} pre-obj
                        deaths/g
                      </p>
                    )}
                </div>
                {focusGoal && focusVerdict && (
                  <FocusVerdictCard goalTitle={focusGoal.title} verdict={focusVerdict} />
                )}
              </div>
              <KpiGrid
                items={[
                  { label: 'CS / min', value: String(report.kpis.csPerMin) },
                  {
                    label: report.kpis.csAt10Minute === 11 ? 'CS @5 / @11' : 'CS @5 / @10',
                    value: `${report.kpis.csAt5 ?? 'n/a'} / ${report.kpis.csAt10 ?? 'n/a'}`,
                  },
                  { label: 'Gold diff @15', value: signed(report.kpis.goldDiffAt15, 'g') },
                  { label: 'Obj share', value: `${report.kpis.objectiveSharePct}%` },
                  { label: 'Vision / min', value: String(report.kpis.visionPerMin) },
                  { label: 'Pre-obj deaths', value: String(report.kpis.preObjectiveDeaths) },
                  { label: 'Control wards', value: String(report.kpis.controlWardsBought) },
                  { label: 'KP', value: `${report.kpis.killParticipationPct}%` },
                ]}
              />
            </M3Card>

            <FindingsCard
              highlights={report.highlights}
              mistakes={report.mistakes}
              improvements={report.improvements}
              emptyMistakes="No major macro mistakes flagged in this match."
              onJump={jumpToSecond}
            />

            <div ref={timelineCardRef}>
              <M3Card variant="hero" as="section" aria-label="Map & Timeline" className="space-y-4">
                <h3 className="m3-title-m">Map &amp; Timeline</h3>
                <GoldXpDiffChart
                  key={`chart-${selectedMatch.matchId}`}
                  match={selectedMatch}
                  activeSecond={cursorSecond}
                  onSelectSecond={setCursor}
                />
                <RiftMap
                  key={`map-${selectedMatch.matchId}`}
                  mode="replay"
                  roleLabel="jungle"
                  durationSeconds={selectedMatch.durationSeconds}
                  patchVersion={patchVersion}
                  pathPoints={report.pathPoints}
                  enemyPathPoints={report.enemyPathPoints}
                  markers={report.markers}
                  activeSecond={cursorSecond}
                  onChangeSecond={setCursor}
                />
              </M3Card>
            </div>
          </>
        )}

        {/* ---------------- ADC detail ---------------- */}
        {selectedKind === 'adc' && adcReport && (
          <>
            <M3Card variant="hero" as="section" aria-label="Match summary">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m3-title-m text-[color:var(--md-sys-color-on-surface)]">
                      ADC Performance Benchmarks
                    </h3>
                    <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
                      Target: {targetDivision}
                    </M3Chip>
                    {adcReport.isProvisional && (
                      <M3Chip size="sm" tone="warning">
                        Provisional Benchmark
                      </M3Chip>
                    )}
                  </div>
                  <TakeawayCallout
                    text={
                      firstTakeaway(adcReport) ??
                      'Clean bot lane fundamentals across the laning phase.'
                    }
                  />
                </div>
                {focusGoal && focusVerdict && (
                  <FocusVerdictCard goalTitle={focusGoal.title} verdict={focusVerdict} />
                )}
              </div>
              <KpiGrid
                items={[
                  {
                    label: 'CS @10',
                    value: adcReport.kpis.csAt10 !== null ? String(adcReport.kpis.csAt10) : 'n/a',
                  },
                  { label: 'CS / min', value: String(adcReport.kpis.csPerMin) },
                  {
                    label: 'Lane Gold Diff @15',
                    value:
                      adcReport.kpis.goldDiffAt15 !== null
                        ? signed(adcReport.kpis.goldDiffAt15, 'g')
                        : 'n/a',
                    badge:
                      adcReport.kpis.goldDiffSource === 'lane_opponent'
                        ? 'vs lane opponent'
                        : adcReport.kpis.goldDiffSource === 'enemy_jungler_fallback'
                          ? 'fallback · enemy jungler'
                          : 'unavailable',
                  },
                  {
                    label: 'Damage Share',
                    value:
                      adcReport.kpis.damageSharePct !== null
                        ? `${adcReport.kpis.damageSharePct}%`
                        : 'n/a',
                  },
                  { label: 'Pre-14 Deaths', value: String(adcReport.kpis.deathsPre14) },
                  { label: 'Turret Plates', value: String(adcReport.kpis.turretPlates) },
                  { label: 'KP', value: `${adcReport.kpis.killParticipationPct}%` },
                ]}
              />
            </M3Card>

            <FindingsCard
              highlights={adcReport.highlights}
              mistakes={adcReport.mistakes}
              improvements={adcReport.improvements}
              emptyMistakes="No major laning or positioning mistakes flagged in this match."
              onJump={jumpToSecond}
            />

            <div ref={timelineCardRef}>
              <M3Card variant="hero" as="section" aria-label="Map & Timeline" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m3-title-m">Map &amp; Timeline</h3>
                  <span className={cx('m3-body-s', MUTED)}>
                    Plates shown as objective pins · isolated deaths highlighted
                  </span>
                </div>
                <RiftMap
                  key={`map-${selectedMatch.matchId}`}
                  mode="replay"
                  roleLabel="bottom"
                  durationSeconds={selectedMatch.durationSeconds}
                  patchVersion={patchVersion}
                  pathPoints={adcReport.pathPoints}
                  enemyPathPoints={adcReport.laneOpponentPathPoints}
                  markers={toReplayMarkers(adcReport)}
                  activeSecond={cursorSecond}
                  onChangeSecond={setCursor}
                />
              </M3Card>
            </div>
          </>
        )}

        {/* ---------------- Off-role detail ---------------- */}
        {selectedKind === 'off_role' && (
          <M3Card variant="hero" as="section" aria-label="Off-role match">
            <div
              role="status"
              className="m3-body-m rounded-[var(--md-sys-shape-corner-large)] bg-[color:var(--md-sys-color-tertiary-container)] px-4 py-3 text-[color:var(--md-sys-color-on-tertiary-container)]"
            >
              <strong className="font-semibold">
                Off-role game ({selectedSummary.roleLabel})
              </strong>{' '}
              — No deep Jungle or ADC grading is generated here, and this match is excluded from
              your Jungle/ADC Climb baselines and mistake trends.
            </div>
            <KpiGrid
              items={[
                {
                  label: 'K / D / A',
                  value: `${selectedMatch.kills}/${selectedMatch.deaths}/${selectedMatch.assists}`,
                },
                { label: 'CS', value: String(selectedMatch.cs) },
                { label: 'CS / min', value: String(selectedSummary.csPerMin) },
                { label: 'Duration', value: formatClock(selectedMatch.durationSeconds) },
                { label: 'Vision score', value: String(selectedMatch.visionScore) },
                { label: 'Kill participation', value: `${selectedSummary.killParticipationPct}%` },
              ]}
            />
          </M3Card>
        )}

        {/* Video & Replay (all roles) */}
        <section aria-label="Video & Replay">
          <RecordingPlayerCard
            key={`rec-${selectedMatch.matchId}`}
            matchId={selectedMatch.matchId}
            durationSeconds={selectedMatch.durationSeconds}
            activeSecond={cursorSecond}
            isTauri={isTauri}
            onSelectSecond={setCursor}
            onOpenSettings={onOpenSettings ? () => onOpenSettings('recording') : undefined}
          />
        </section>

        {/* AI Debrief (Jungle & ADC only) */}
        {selectedKind !== 'off_role' && aiContextJson && (
          <M3Card variant="hero" as="section" aria-label="AI Debrief">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="m3-title-m flex items-center gap-2">
                  <Sparkles className="h-4 w-4" aria-hidden /> AI Debrief
                </h3>
                <span className={cx('m3-body-s', MUTED)}>
                  Optional AI Coach Debrief (
                  {aiConfig.provider === 'off'
                    ? 'Built-in Coaching Preview / Configure AI in Settings'
                    : `${aiConfig.provider.toUpperCase()} · ${aiConfig.model}`}
                  )
                </span>
              </div>
              <M3Button
                variant="filled"
                size="sm"
                disabled={isAiLoading}
                onClick={() => void handleGenerateAiDebrief()}
              >
                {isAiLoading
                  ? 'Generating...'
                  : aiDebrief
                    ? 'Regenerate AI Debrief'
                    : 'Generate AI Coach Debrief'}
              </M3Button>
            </div>

            {aiDebrief && (
              <div className="mt-3 space-y-2">
                {(aiDebriefVerified || aiDebriefFromCache) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {aiDebriefVerified && (
                      <M3Chip
                        size="sm"
                        tone="success"
                        title="Cited metrics and timestamps matched against provided match telemetry."
                      >
                        Telemetry Numbers Checked
                      </M3Chip>
                    )}
                    {aiDebriefFromCache && (
                      <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
                        Cached
                      </M3Chip>
                    )}
                  </div>
                )}
                <pre className="m3-body-m whitespace-pre-wrap rounded-[var(--md-sys-shape-corner-large)] bg-[color:var(--md-sys-color-surface-container-lowest)] p-4 font-sans leading-relaxed">
                  {aiDebrief}
                </pre>
              </div>
            )}
            {!aiDebrief && !aiError && (
              <p className={cx('m3-body-s mt-3', MUTED)}>
                Click &quot;Generate AI Coach Debrief&quot; for a narrative summary grounded in your{' '}
                {title} match telemetry.
              </p>
            )}
            {aiError && (
              <p role="alert" className="m3-body-s mt-2 text-[color:var(--md-sys-color-error)]">
                {aiError}
              </p>
            )}
          </M3Card>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW A — Match History List
  // ===========================================================================
  const latestCoached = summaries.find((s) => s.kind !== 'off_role');

  return (
    <div className="m3-view-enter space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <M3SegmentedButton<MatchFilter>
          ariaLabel="Filter matches by role"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', badge: String(counts.all) },
            { value: 'jungle', label: 'Jungle', badge: String(counts.jungle) },
            { value: 'adc', label: 'ADC', badge: String(counts.adc) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          {newIds.size > 0 && (
            <M3Chip size="sm" tone="tertiary">
              {newIds.size} new
            </M3Chip>
          )}
          <M3Button
            variant="tonal"
            size="sm"
            icon={<RefreshCw aria-hidden className={syncing ? 'animate-spin' : undefined} />}
            disabled={syncDisabled}
            onClick={() => void handleSync()}
          >
            {syncLabel}
          </M3Button>
        </div>
      </div>

      {syncError && (
        <p
          role="alert"
          className="m3-body-s rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-sys-color-error-container)] px-3 py-2 text-[color:var(--md-sys-color-on-error-container)]"
        >
          {syncError}
        </p>
      )}

      {autoSyncNotice && !syncError && (
        <p
          role="status"
          className="m3-body-s rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-ext-warning-container)] px-3 py-2 text-[color:var(--md-ext-on-warning-container)]"
        >
          {autoSyncNotice}
        </p>
      )}

      {latestCoached && (
        <div className="flex items-start gap-3 rounded-[var(--md-sys-shape-corner-large)] bg-[color:var(--md-sys-color-primary-container)] px-4 py-3 text-[color:var(--md-sys-color-on-primary-container)]">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="m3-label-m font-semibold">
              Last game takeaway · {latestCoached.championName}
            </div>
            <p className="m3-body-m mt-0.5">{latestCoached.takeaway}</p>
          </div>
        </div>
      )}

      <div
        role="list"
        aria-label="Match history"
        className="flex flex-col gap-2"
        onKeyDown={handleListKeyDown}
      >
        {filteredSummaries.length === 0 ? (
          <M3Card variant="lowest" className="py-10 text-center">
            <p className="m3-title-s">
              No {filter === 'adc' ? 'ADC' : 'Jungle'} games in your synced history yet.
            </p>
            <p className={cx('m3-body-s mt-1', MUTED)}>
              Switch the filter to All or sync more ranked games.
            </p>
          </M3Card>
        ) : (
          filteredSummaries.map((summary) => (
            <div role="listitem" key={summary.match.matchId}>
              <MatchSummaryCard
                summary={summary}
                patchVersion={patchVersion}
                isNew={newIds.has(summary.match.matchId)}
                onOpen={() => openMatch(summary.match.matchId)}
                buttonRef={(node) => {
                  if (node) cardRefs.current.set(summary.match.matchId, node);
                  else cardRefs.current.delete(summary.match.matchId);
                }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function RoleChips({ summary }: { summary: MatchSummary }) {
  if (summary.kind === 'jungle') {
    return (
      <M3Chip size="sm" tone="primary">
        Jungle
      </M3Chip>
    );
  }
  if (summary.kind === 'adc') {
    return (
      <M3Chip size="sm" tone="primary">
        ADC
      </M3Chip>
    );
  }
  return (
    <>
      <M3Chip size="sm" tone="plain">
        {summary.roleLabel}
      </M3Chip>
      <M3Chip size="sm">Off-Role</M3Chip>
    </>
  );
}

function GradeBadge({ grade, kind }: { grade: Grade; kind: MatchRoleKind }) {
  return (
    <span
      title={kind === 'off_role' ? 'Scoreboard only · no grade for off-role games' : 'Match grade'}
      aria-label={kind === 'off_role' ? 'Grade N/A (scoreboard only)' : `Grade ${grade}`}
      className={cx(
        'm3-title-s grid h-9 min-w-9 shrink-0 place-items-center rounded-[var(--md-sys-shape-corner-medium)] px-1.5 font-extrabold',
        gradeClasses(grade)
      )}
    >
      {grade}
    </span>
  );
}

function FocusChip({ verdict }: { verdict: FocusVerdict }) {
  const tone = verdict.status === 'met' ? 'success' : verdict.status === 'missed' ? 'error' : undefined;
  return (
    <M3Chip size="sm" tone={tone} title={verdict.deltaLabel}>
      {verdict.status === 'met'
        ? 'Focus met'
        : verdict.status === 'missed'
          ? 'Focus missed'
          : 'Focus n/a'}
    </M3Chip>
  );
}

function MatchSummaryCard({
  summary,
  patchVersion,
  isNew,
  onOpen,
  buttonRef,
}: {
  summary: MatchSummary;
  patchVersion: string;
  isNew: boolean;
  onOpen: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}) {
  const { match } = summary;
  const dateLabel = formatPlayedAt(match.playedAt);
  const secondaryStat =
    summary.csAt10 !== null
      ? { label: 'CS@10', value: String(summary.csAt10) }
      : { label: 'KP', value: `${summary.killParticipationPct}%` };
  const ariaLabel = [
    `Open ${summary.championName}`,
    summary.opponentName ? `vs ${summary.opponentName}` : null,
    summary.kind === 'off_role' ? `${summary.roleLabel} off-role` : summary.roleLabel,
    match.win ? 'victory' : 'defeat',
    `${match.kills}/${match.deaths}/${match.assists}`,
    isNew ? 'new' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className={cx(
        'm3-card m3-card--interactive m3-state group relative grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 overflow-hidden rounded-[var(--md-sys-shape-corner-large-increased)] bg-[color:var(--md-sys-color-surface-container)] py-3 pl-5 pr-4 text-left hover:rounded-[var(--md-sys-shape-corner-extra-large)] hover:bg-[color:var(--md-sys-color-surface-container-high)]',
        isNew && 'shadow-[inset_0_0_0_1px_var(--md-sys-color-tertiary)]'
      )}
    >
      <span
        aria-hidden
        className={cx(
          'absolute inset-y-0 left-0 w-1.5',
          match.win ? 'bg-[color:var(--md-ext-success)]' : 'bg-[color:var(--md-sys-color-error)]'
        )}
      />
      <img
        src={getChampionIconUrl(match.championName, patchVersion)}
        alt=""
        className="h-12 w-12 rounded-[var(--md-sys-shape-corner-large)] bg-[color:var(--md-sys-color-surface-container-lowest)]"
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden';
        }}
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="m3-title-m">{summary.championName}</span>
          {summary.opponentName && (
            <span className={cx('m3-body-m', MUTED)}>vs {summary.opponentName}</span>
          )}
          <RoleChips summary={summary} />
          <span
            className={cx(
              'm3-label-m rounded-full px-2 py-0.5 font-bold',
              match.win
                ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
                : 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
            )}
          >
            {match.win ? 'W' : 'L'}
          </span>
          {isNew && (
            <M3Chip size="sm" tone="tertiary">
              New
            </M3Chip>
          )}
          {summary.focus && <FocusChip verdict={summary.focus} />}
        </span>
        <span className={cx('m3-body-s mt-1 block truncate', MUTED)}>{summary.takeaway}</span>
        <span className={cx('m3-body-s num mt-1 flex flex-wrap gap-x-4 gap-y-0.5', MUTED)}>
          <span>
            <strong className={ON_SURFACE}>
              {match.kills}/{match.deaths}/{match.assists}
            </strong>{' '}
            KDA
          </span>
          <span>
            <strong className={ON_SURFACE}>{summary.csPerMin}</strong> CS/min
          </span>
          <span>
            <strong className={ON_SURFACE}>{secondaryStat.value}</strong> {secondaryStat.label}
          </span>
          <span>{formatClock(match.durationSeconds)}</span>
          {(dateLabel || match.patch) && (
            <span>
              {dateLabel}
              {dateLabel && match.patch ? ' · ' : ''}
              {match.patch ? `Patch ${match.patch}` : ''}
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <GradeBadge grade={summary.grade} kind={summary.kind} />
        <ChevronRight
          aria-hidden
          className={cx('h-5 w-5 transition-transform group-hover:translate-x-1', MUTED)}
        />
      </span>
    </button>
  );
}

function TakeawayCallout({ text }: { text: string }) {
  return (
    <div className="mt-2 flex items-start gap-2.5 rounded-[var(--md-sys-shape-corner-large)] bg-[color:var(--md-sys-color-primary-container)] px-4 py-3 text-[color:var(--md-sys-color-on-primary-container)]">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <div className="m3-label-m font-semibold">Last Game Takeaway</div>
        <p className="m3-body-m mt-0.5">{text}</p>
      </div>
    </div>
  );
}

function FocusVerdictCard({ goalTitle, verdict }: { goalTitle: string; verdict: FocusVerdict }) {
  const tone =
    verdict.status === 'met'
      ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
      : verdict.status === 'missed'
        ? 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
        : 'bg-[color:var(--md-sys-color-surface-container-high)] text-[color:var(--md-sys-color-on-surface)]';
  return (
    <div className={cx('rounded-[var(--md-sys-shape-corner-large)] px-4 py-3', tone)}>
      <div className="m3-label-l font-bold">{verdict.label}</div>
      <div className="m3-body-s mt-0.5 font-medium">{goalTitle}</div>
      {verdict.deltaLabel && <div className="m3-body-s num opacity-90">{verdict.deltaLabel}</div>}
    </div>
  );
}

function KpiGrid({
  items,
}: {
  items: Array<{ label: string; value: string; badge?: string }>;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
      {items.map((kpi) => (
        <M3Card key={kpi.label} variant="module" className="px-3 py-2.5">
          <div className={cx('m3-label-m', MUTED)}>{kpi.label}</div>
          <div className="m3-title-l num mt-0.5">{kpi.value}</div>
          {kpi.badge && <div className={cx('m3-body-s mt-0.5', MUTED)}>{kpi.badge}</div>}
        </M3Card>
      ))}
    </div>
  );
}

function FindingColumn({
  title,
  titleClass,
  items,
  empty,
  jumpTone,
  onJump,
}: {
  title: string;
  titleClass: string;
  items: ReviewFinding[];
  empty?: string;
  jumpTone: 'good' | 'bad' | 'neutral';
  onJump: (second: number) => void;
}) {
  const jumpClass =
    jumpTone === 'good'
      ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
      : jumpTone === 'bad'
        ? 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
        : 'bg-[color:var(--md-sys-color-surface-container-highest)] text-[color:var(--md-sys-color-on-surface)]';
  return (
    <div>
      <div className={cx('m3-title-s mb-2.5', titleClass)}>{title}</div>
      {items.length === 0 ? (
        <p className={cx('m3-body-s', MUTED)}>{empty}</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="m3-label-l font-semibold">{item.title}</span>
                {item.timestampSec !== undefined && (
                  <button
                    type="button"
                    onClick={() => onJump(item.timestampSec!)}
                    className={cx(
                      'm3-state m3-label-m num shrink-0 rounded-full px-2.5 py-0.5 font-bold',
                      jumpClass
                    )}
                  >
                    Jump @ {formatClock(item.timestampSec)}
                  </button>
                )}
              </div>
              <p className={cx('m3-body-s mt-0.5', MUTED)}>{item.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FindingsCard({
  highlights,
  mistakes,
  improvements,
  emptyMistakes,
  onJump,
}: {
  highlights: ReviewFinding[];
  mistakes: ReviewFinding[];
  improvements: ReviewFinding[];
  emptyMistakes: string;
  onJump: (second: number) => void;
}) {
  return (
    <M3Card variant="hero" as="section" aria-label="Mistakes & Highlights">
      <div className="grid gap-6 md:grid-cols-3">
        <FindingColumn
          title="What You Did Good"
          titleClass="text-[color:var(--md-ext-success)]"
          items={highlights}
          empty="No standout highlights flagged in this match."
          jumpTone="good"
          onJump={onJump}
        />
        <FindingColumn
          title="Mistakes to Cut Out"
          titleClass="text-[color:var(--md-sys-color-error)]"
          items={mistakes}
          empty={emptyMistakes}
          jumpTone="bad"
          onJump={onJump}
        />
        <FindingColumn
          title="Where & How to Improve"
          titleClass=""
          items={improvements}
          empty="Keep stacking these fundamentals."
          jumpTone="neutral"
          onJump={onJump}
        />
      </div>
    </M3Card>
  );
}
