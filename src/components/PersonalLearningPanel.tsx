import { AlertTriangle, Activity, Target } from 'lucide-react';
import { useState } from 'react';
import { ADC_KPI_KEYS, ADC_KPI_META } from '../domain/adc/adcBenchmarks';
import type { AdcPersonalLearningSnapshot } from '../domain/adc/adcReviewTypes';
import { KPI_META } from '../domain/climbLadderEngine';
import { formatClock } from '../domain/liveCoachEngine';
import type { CoachedRole } from '../domain/roles/types';
import type {
  ClimbGoal,
  InsightConfidenceStatus,
  JungleKpiKey,
  PersonalLearningSnapshot,
} from '../types/coaching';
import { M3Button, M3Card, M3Chip } from './m3';
import type { M3ChipTone } from './m3';

interface PersonalLearningPanelProps {
  snapshot?: PersonalLearningSnapshot | null;
  currentFocusGoalId?: string | null;
  onAdoptFocusGoal?: (goal: ClimbGoal) => Promise<void>;
  /** Which role's detectors and baselines to surface (defaults to Jungle). */
  activeRole?: CoachedRole;
  /** Role-isolated ADC snapshot (`computeAdcPersonalLearningSnapshot`). */
  adcSnapshot?: AdcPersonalLearningSnapshot | null;
}

const CONFIDENCE_CHIPS: Record<
  InsightConfidenceStatus,
  { label: string; tone: M3ChipTone; className?: string }
> = {
  confirmed: { label: 'Confirmed Leak', tone: 'error' },
  emerging: { label: 'Emerging Pattern', tone: 'warning' },
  // Highest-elevation chip → on-surface text (never muted on-surface-variant).
  monitoring: {
    label: 'Monitoring',
    tone: 'plain',
    className:
      'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)]',
  },
};

const GATE_BAR_COLOR: Record<InsightConfidenceStatus, string> = {
  confirmed: 'var(--md-sys-color-error)',
  emerging: 'var(--md-ext-warning)',
  monitoring: 'var(--md-sys-color-outline)',
};

const JUNGLE_BASELINE_KEYS: JungleKpiKey[] = [
  'csPerMin',
  'goldDiffAt15',
  'objectiveSharePct',
  'preObjectiveDeaths',
  'earlyDeaths',
  'visionPerMin',
  'killParticipationPct',
];

/** Fields shared by Jungle and ADC mistake signature insights. */
interface SignatureLike {
  detectorId: string;
  label: string;
  status: InsightConfidenceStatus;
  hitMatches: number;
  totalMatches: number;
  hitRatePct: number;
  wilsonLowerBoundPct: number;
  drill: string;
  recentTimestamps: number[];
}

interface BaselineRow {
  key: string;
  label: string;
  unit: string;
  shrunkBaseline: number;
  p25: number;
  p75: number;
  priorTarget: number;
  lowerIsBetter: boolean;
  trendDelta: number;
}

function SignatureRow({ sig }: { sig: SignatureLike }) {
  const chip = CONFIDENCE_CHIPS[sig.status];
  return (
    <M3Card as="li" variant="module" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="m3-title-s min-w-0 text-[var(--md-sys-color-on-surface)]">{sig.label}</span>
        <M3Chip size="sm" tone={chip.tone} className={chip.className}>
          {chip.label}
        </M3Chip>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="relative h-1.5 max-w-[160px] flex-1 rounded-full bg-[var(--md-sys-color-secondary-container)]"
          role="img"
          aria-label={`Hit rate ${sig.hitRatePct}%, 95% Wilson floor ${sig.wilsonLowerBoundPct}%`}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.max(4, Math.min(100, sig.hitRatePct))}%`,
              background: GATE_BAR_COLOR[sig.status],
            }}
          />
          <span
            className="absolute -top-1 h-3.5 w-0.5 bg-[var(--md-sys-color-on-surface)]"
            style={{ left: `${Math.max(0, Math.min(100, sig.wilsonLowerBoundPct))}%` }}
          />
        </div>
        <span className="m3-label-m num text-[var(--md-sys-color-on-surface-variant)]">
          {sig.hitMatches}/{sig.totalMatches} ({sig.hitRatePct}% · CI floor {sig.wilsonLowerBoundPct}%)
        </span>
      </div>
      <p className="m3-body-s text-[var(--md-sys-color-on-surface-variant)]">{sig.drill}</p>
      {sig.recentTimestamps.length > 0 && (
        <div className="m3-label-m m3-faint num">
          Recent triggers: {sig.recentTimestamps.map(formatClock).join(', ')}
        </div>
      )}
    </M3Card>
  );
}

function BaselineGrid({ rows, title }: { rows: BaselineRow[]; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="m3-label-l text-[var(--md-sys-color-on-surface-variant)]">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const meets = row.lowerIsBetter
            ? row.shrunkBaseline <= row.priorTarget
            : row.shrunkBaseline >= row.priorTarget;
          return (
            <M3Card key={row.key} variant="lowest" className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="m3-label-l truncate text-[var(--md-sys-color-on-surface)]">
                  {row.label}
                </span>
                <span
                  className={`m3-title-s num shrink-0 ${
                    meets ? 'text-[var(--md-ext-success)]' : 'text-[var(--md-sys-color-on-surface)]'
                  }`}
                >
                  {row.shrunkBaseline}
                  <span className="m3-label-m m3-faint ml-0.5">{row.unit}</span>
                </span>
              </div>
              <div className="m3-label-m m3-faint num mt-0.5">
                EWM · IQR {row.p25}–{row.p75} · Target {row.lowerIsBetter ? '≤' : '≥'}{' '}
                {row.priorTarget}
                {row.trendDelta !== 0 && (
                  <span>
                    {' '}
                    · {row.trendDelta > 0 ? '▲' : '▼'} {Math.abs(row.trendDelta)}
                  </span>
                )}
              </div>
            </M3Card>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Role-aware personal learning: deterministic mistake detectors with statistical surfacing gates
 * (`Confirmed` / `Emerging` / `Monitoring`), EWM baselines, an auto-proposed Match Focus goal,
 * and multi-session stamina & tilt analytics. Jungle and ADC data are never mixed.
 */
export function PersonalLearningPanel({
  snapshot,
  currentFocusGoalId = null,
  onAdoptFocusGoal,
  activeRole = 'jungle',
  adcSnapshot = null,
}: PersonalLearningPanelProps) {
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);

  const isAdc = activeRole === 'bottom';

  if (!isAdc && !snapshot) {
    return (
      <M3Card variant="hero">
        <p className="m3-body-m text-[var(--md-sys-color-on-surface-variant)]">
          Sync jungle matches to unlock personal EWM baselines, statistical mistake detectors, and
          multi-session stamina analytics.
        </p>
      </M3Card>
    );
  }

  async function handleAdopt(goal: ClimbGoal) {
    if (!onAdoptFocusGoal || adopting) return;
    setAdopting(true);
    setAdoptError(null);
    try {
      await onAdoptFocusGoal(goal);
    } catch (err) {
      setAdoptError(err instanceof Error ? err.message : 'Failed to adopt focus goal.');
    } finally {
      setAdopting(false);
    }
  }

  // ---- Role-scoped detector data ------------------------------------------------------------
  const signatures: SignatureLike[] = isAdc
    ? (adcSnapshot?.signatures ?? [])
    : (snapshot?.signatures ?? []);
  const proposedFocus = isAdc ? (adcSnapshot?.proposedFocus ?? null) : (snapshot?.proposedFocus ?? null);
  const roleMatchCount = isAdc ? (adcSnapshot?.adcMatchCount ?? 0) : (snapshot?.jungleMatchCount ?? 0);
  const roleNoun = isAdc ? 'ADC' : 'jungle';
  const isProvisional = isAdc && Boolean(adcSnapshot?.isProvisional);
  const alreadyFocused = Boolean(proposedFocus) && currentFocusGoalId === proposedFocus?.goal.id;

  const baselineRows: BaselineRow[] = isAdc
    ? adcSnapshot && adcSnapshot.adcMatchCount >= 2
      ? ADC_KPI_KEYS.map((key) => {
          const b = adcSnapshot.baselines[key];
          const meta = ADC_KPI_META[key];
          return {
            key,
            label: meta.label,
            unit: meta.unit,
            shrunkBaseline: b.shrunkBaseline,
            p25: b.p25,
            p75: b.p75,
            priorTarget: b.priorTarget,
            lowerIsBetter: meta.lowerIsBetter,
            trendDelta: b.trendDelta,
          };
        })
      : []
    : snapshot && snapshot.jungleMatchCount >= 2
      ? JUNGLE_BASELINE_KEYS.filter((key) => Boolean(snapshot.baselines?.[key])).map((key) => {
          const b = snapshot.baselines[key];
          const meta = KPI_META[key];
          return {
            key,
            label: meta.label,
            unit: meta.unit,
            shrunkBaseline: b.shrunkBaseline,
            p25: b.p25,
            p75: b.p75,
            priorTarget: b.priorTarget,
            lowerIsBetter: meta.lowerIsBetter,
            trendDelta: b.trendDelta,
          };
        })
      : [];

  const tiltAnalytics = snapshot?.tiltAnalytics ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[1.25fr_0.95fr]">
      <M3Card variant="hero" as="section" className="space-y-4" aria-label="Personal mistake signatures">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="m3-title-m text-[var(--md-sys-color-on-surface)]">
              Personal Mistake Signatures &amp; Surfacing Gate
            </h3>
            <p className="m3-body-s mt-0.5 text-[var(--md-sys-color-on-surface-variant)]">
              {roleMatchCount} {roleNoun} {roleMatchCount === 1 ? 'game' : 'games'} · 95% Wilson gate
              {isAdc && adcSnapshot?.usedSqlDepth && ' · SQLite history depth'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <M3Chip size="sm" tone="primary">
              {isAdc ? 'ADC' : 'Jungle'}
            </M3Chip>
            {isProvisional && (
              <M3Chip
                size="sm"
                tone="warning"
                icon={<AlertTriangle className="h-3.5 w-3.5" />}
                title="ADC benchmarks are provisional until calibrated by a signed patch pack."
              >
                Provisional
              </M3Chip>
            )}
          </div>
        </div>

        {isAdc && !adcSnapshot ? (
          <p className="m3-body-m text-[var(--md-sys-color-on-surface-variant)]">
            Sync ranked ADC (Bottom) matches to unlock ADC EWM baselines and the 5 lane detectors:
            CS@10 deficit, lane deaths before 14:00, low damage share, pre-objective deaths and
            isolated deaths.
          </p>
        ) : (
          <>
            {proposedFocus && (
              <M3Card variant="tonal" className="space-y-2 bg-[var(--md-sys-color-tertiary-container)] p-4 text-[var(--md-sys-color-on-tertiary-container)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="m3-title-s flex items-center gap-1.5">
                      <Target className="h-4 w-4 shrink-0" />
                      <span>Recommended Match Focus: {proposedFocus.goal.title}</span>
                    </div>
                    <p className="m3-body-s">{proposedFocus.reason}</p>
                  </div>
                  {onAdoptFocusGoal && (
                    <M3Button
                      size="sm"
                      variant="filled"
                      disabled={alreadyFocused || adopting}
                      onClick={() => void handleAdopt(proposedFocus.goal)}
                      className="shrink-0 bg-[var(--md-sys-color-tertiary)] text-[var(--md-sys-color-on-tertiary)] disabled:opacity-60"
                    >
                      {alreadyFocused ? 'Active Focus' : adopting ? 'Saving…' : 'Set as Match Focus'}
                    </M3Button>
                  )}
                </div>
                {adoptError && (
                  <p role="alert" className="m3-body-s text-[var(--md-sys-color-error)]">
                    {adoptError}
                  </p>
                )}
              </M3Card>
            )}

            {signatures.length === 0 ? (
              <p className="m3-body-m text-[var(--md-sys-color-on-surface-variant)]">
                No recurring {roleNoun} mistake signatures detected across your synced {roleNoun}{' '}
                games.
              </p>
            ) : (
              <ul className="space-y-2">
                {signatures.map((sig) => (
                  <SignatureRow key={sig.detectorId} sig={sig} />
                ))}
              </ul>
            )}

            <BaselineGrid
              rows={baselineRows}
              title={`${isAdc ? 'ADC' : 'Jungle'} EWM baselines (shrunk toward target)`}
            />
          </>
        )}
      </M3Card>

      <M3Card variant="hero" as="section" className="space-y-3" aria-label="Multi-session stamina and tilt">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m3-title-m flex items-center gap-2 text-[var(--md-sys-color-on-surface)]">
            <Activity className="h-4 w-4 text-[var(--md-sys-color-tertiary)]" />
            Multi-Session Stamina &amp; Tilt
          </h3>
          {tiltAnalytics && (
            <span className="m3-label-m num text-[var(--md-sys-color-on-surface-variant)]">
              {tiltAnalytics.sessionCount} {tiltAnalytics.sessionCount === 1 ? 'session' : 'sessions'}{' '}
              · {tiltAnalytics.avgGamesPerSession}g avg
            </span>
          )}
        </div>

        {tiltAnalytics ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <TiltTile
                label="Fresh Block (Games 1–2)"
                value={tiltAnalytics.freshGames > 0 ? `${tiltAnalytics.freshWrPct}% WR` : 'n/a'}
                caption={`${tiltAnalytics.freshGames} ${tiltAnalytics.freshGames === 1 ? 'game' : 'games'}`}
              />
              <TiltTile
                label="Extended (Game 3+)"
                value={
                  tiltAnalytics.extendedWrPct !== null ? `${tiltAnalytics.extendedWrPct}% WR` : 'n/a'
                }
                caption={`${tiltAnalytics.extendedGames} ${tiltAnalytics.extendedGames === 1 ? 'game' : 'games'}`}
              />
              <TiltTile
                label="After Loss Requeue"
                value={
                  tiltAnalytics.postLossWrPct !== null ? `${tiltAnalytics.postLossWrPct}% WR` : 'n/a'
                }
                tone={
                  tiltAnalytics.postLossWrPct !== null && tiltAnalytics.postLossWrPct <= 35
                    ? 'error'
                    : undefined
                }
                caption={`${tiltAnalytics.postLossGames} immediate ${tiltAnalytics.postLossGames === 1 ? 'requeue' : 'requeues'}`}
              />
              <TiltTile
                label="After Win Momentum"
                value={
                  tiltAnalytics.postWinWrPct !== null ? `${tiltAnalytics.postWinWrPct}% WR` : 'n/a'
                }
                tone="success"
                caption={`${tiltAnalytics.postWinGames} immediate ${tiltAnalytics.postWinGames === 1 ? 'requeue' : 'requeues'}`}
              />
            </div>
            <p className="m3-body-s rounded-[12px] bg-[var(--md-sys-color-surface-container-high)] px-3 py-2 text-[var(--md-sys-color-on-surface)]">
              {tiltAnalytics.advisory}
            </p>
          </>
        ) : (
          <p className="m3-body-m text-[var(--md-sys-color-on-surface-variant)]">
            Session stamina analytics appear once ranked games are synced.
          </p>
        )}
      </M3Card>
    </div>
  );
}

function TiltTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: 'error' | 'success';
}) {
  const valueColor =
    tone === 'error'
      ? 'text-[var(--md-sys-color-error)]'
      : tone === 'success'
        ? 'text-[var(--md-ext-success)]'
        : 'text-[var(--md-sys-color-on-surface)]';
  return (
    <M3Card variant="module" className="p-3">
      <div className="m3-label-m text-[var(--md-sys-color-on-surface-variant)]">{label}</div>
      <div className={`m3-title-l num mt-1 ${valueColor}`}>{value}</div>
      <div className="m3-label-m m3-faint mt-0.5">{caption}</div>
    </M3Card>
  );
}
