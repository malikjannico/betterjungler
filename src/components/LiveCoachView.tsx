import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Crosshair,
  Eye,
  Flame,
  Shield,
  Swords,
  Timer,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { buildRoutesForSide, buildWardSpotsForSide } from '../data/jungleKnowledgePack';
import {
  ADC_FORBIDDEN_ITEM_IDS,
  ADC_ITEM_IDS,
  ADC_RECALL_SPIKE_GOLD,
  resolveAdcCsTarget,
} from '../domain/adc/adcLiveEngine';
import type { AdcWinConditionPlan } from '../domain/adc/types';
import { formatChampionName } from '../domain/championNames';
import { selectLiveActiveRoute } from '../domain/jungleRoutingEngine';
import {
  DEFAULT_OBJECTIVE_TIMINGS,
  DEFAULT_SMITE_THRESHOLDS,
  computeSmiteProgression,
  formatClock,
  resolveSelfPlayer,
} from '../domain/liveCoachEngine';
import type { LivePlayedRole } from '../domain/sessionContext';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  ItemRecommendation,
  MacroCue,
  ObjectiveWindow,
  SmiteThresholdsConfig,
  WinConditionPlan,
} from '../types/coaching';
import type { GamePhase, LiveGameData, MapSide } from '../types/riot';
import { EmptyState } from './EmptyState';
import { M3Card, M3Chip, cx } from './m3';
import { SummonersRiftMap } from './SummonersRiftMap';

export type { LivePlayedRole };

interface LiveCoachViewProps {
  phase?: GamePhase;
  isJungleRole?: boolean;
  liveData: LiveGameData | null;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  winPlan: WinConditionPlan | null;
  mapSide: MapSide | null;
  patchVersion: string;
  smiteThresholds?: SmiteThresholdsConfig;
  /** Auto-detected played role. Falls back to `isJungleRole` when omitted. */
  playedRole?: LivePlayedRole;
  /** Pre-game ADC win plan (bot lane quick reference). */
  adcWinPlan?: AdcWinConditionPlan | null;
}

const OFF_ROLE_SUPPRESSION_NOTE =
  'Smite, jungle items and jungle route cues are suppressed during off-role games — global objective timers stay active.';

/** Jungle pets / bruiser items (e.g. Chempunk) that must never surface in an ADC build card. */
const NON_ADC_ITEM_IDS: ReadonlySet<number> = ADC_FORBIDDEN_ITEM_IDS;

// Text colours (contrast-safe: on-surface on elevated pills, on-surface-variant only on
// surface-container / surface-container-high).
const ON_SURFACE = 'text-[color:var(--md-sys-color-on-surface)]';
const MUTED = 'm3-muted';

const FALLBACK_OBJECTIVE_SPAWNS: Array<{ id: string; name: string; spawnSec: number }> = [
  { id: 'dragon', name: 'Dragon', spawnSec: DEFAULT_OBJECTIVE_TIMINGS.dragonFirstSpawnSec },
  { id: 'voidgrubs', name: 'Voidgrubs', spawnSec: DEFAULT_OBJECTIVE_TIMINGS.voidgrubsSpawnSec },
  { id: 'herald', name: 'Rift Herald', spawnSec: DEFAULT_OBJECTIVE_TIMINGS.heraldSpawnSec },
  { id: 'baron', name: 'Baron Nashor', spawnSec: DEFAULT_OBJECTIVE_TIMINGS.baronSpawnSec },
];

export function LiveCoachView({
  phase = 'idle',
  isJungleRole = true,
  liveData,
  objectives,
  buildPlan,
  macroCues,
  winPlan,
  mapSide,
  patchVersion,
  smiteThresholds,
  playedRole,
  adcWinPlan = null,
}: LiveCoachViewProps) {
  const effectiveRole: LivePlayedRole = playedRole ?? (isJungleRole ? 'jungle' : 'off_role');
  const effectiveSide: MapSide = mapSide ?? adcWinPlan?.mapSide ?? 'blue';

  const routes = useMemo(
    () => winPlan?.routes ?? buildRoutesForSide(effectiveSide, 'bot', 'full_clear'),
    [winPlan, effectiveSide]
  );
  const wardSpots = useMemo(
    () => winPlan?.wardSpots ?? buildWardSpotsForSide(effectiveSide),
    [winPlan, effectiveSide]
  );
  const activeRoute = useMemo(() => {
    const time = liveData?.gameData.gameTime ?? 0;
    return selectLiveActiveRoute(time, objectives, routes);
  }, [liveData, objectives, routes]);

  if (!liveData) {
    return (
      <EmptyState
        icon={Activity}
        title={phase === 'loading' ? 'Match loading · coach starts at 0:00' : 'Live In-Game Coach'}
        description={
          phase === 'loading'
            ? 'Your match is loading. Objective timers, role-aware cues, and adaptive itemization activate automatically at 0:00.'
            : 'Connects automatically via Riot Live Client Data (127.0.0.1:2999) when your match begins — zero setup needed.'
        }
      />
    );
  }

  const gameTime = liveData.gameData.gameTime;
  const gold = Math.floor(liveData.activePlayer.currentGold);
  const level = liveData.activePlayer.level;
  const self = resolveSelfPlayer(liveData);
  const thresholds = smiteThresholds ?? DEFAULT_SMITE_THRESHOLDS;
  const smiteStatus =
    effectiveRole === 'jungle' ? computeSmiteProgression(liveData, thresholds) : null;

  return (
    <div className="m3-view-enter space-y-4">
      <RoleBanner role={effectiveRole} />

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <TelemetryHero
          role={effectiveRole}
          gameTime={gameTime}
          gold={gold}
          level={level}
          creepScore={self?.scores.creepScore ?? 0}
          smiteLabel={smiteStatus ? `${smiteStatus.damage} Smite · ${smiteStatus.tierName}` : null}
        />
        <ObjectiveBoard objectives={objectives} gameTime={gameTime} />
      </div>

      {effectiveRole === 'off_role' && <OffRoleGlobalCard />}

      {effectiveRole === 'bottom' && (
        <AdcLiveSection
          buildPlan={buildPlan}
          macroCues={macroCues}
          adcWinPlan={adcWinPlan}
          patchVersion={patchVersion}
          gold={gold}
          level={level}
          gameTime={gameTime}
          creepScore={self?.scores.creepScore ?? 0}
          ownedTrinketId={self?.items.find((i) => i.slot === 6)?.itemID}
        />
      )}

      {effectiveRole === 'jungle' && (
        <>
          <SummonersRiftMap
            mapSide={effectiveSide}
            patchVersion={patchVersion}
            route={activeRoute}
            wardSpots={wardSpots}
            compact
          />

          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            {buildPlan ? (
              <BuildCard
                title="Adaptive Jungle Build & Threat Radar"
                buildPlan={buildPlan}
                patchVersion={patchVersion}
              />
            ) : (
              <M3Card variant="hero">
                <h3 className="m3-title-m">Adaptive Jungle Build &amp; Threat Radar</h3>
                <p className={cx('m3-body-s mt-1', MUTED)}>
                  Waiting for the public scoreboard to resolve your build path.
                </p>
              </M3Card>
            )}
            <div className="space-y-4">
              {smiteStatus && (
                <SmiteTrackerCard
                  tierName={smiteStatus.tierName}
                  damage={smiteStatus.damage}
                  note={smiteStatus.note}
                  remaining={smiteStatus.estimatedStacksRemaining}
                  thresholds={thresholds}
                />
              )}
              <MacroCuesCard title="Live Macro Cues" cues={macroCues} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {buildPlan && <TrinketCard buildPlan={buildPlan} />}
            <OpeningClearCard route={winPlan?.routes[0] ?? routes[0] ?? null} gameTime={gameTime} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function RoleBanner({ role }: { role: LivePlayedRole }) {
  if (role === 'off_role') {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-[var(--md-sys-shape-corner-extra-large)] bg-[color:var(--md-sys-color-tertiary-container)] px-5 py-3 text-[color:var(--md-sys-color-on-tertiary-container)]"
      >
        <Shield className="h-5 w-5 shrink-0" aria-hidden />
        <span className="m3-title-s">Off-Role · Global Objectives Only</span>
        <span className="m3-body-s">{OFF_ROLE_SUPPRESSION_NOTE}</span>
      </div>
    );
  }
  const isAdc = role === 'bottom';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--md-sys-shape-corner-extra-large)] bg-[color:var(--md-sys-color-primary-container)] px-5 py-3 text-[color:var(--md-sys-color-on-primary-container)]">
      {isAdc ? (
        <Crosshair className="h-5 w-5 shrink-0" aria-hidden />
      ) : (
        <Swords className="h-5 w-5 shrink-0" aria-hidden />
      )}
      <span className="m3-title-s">
        {isAdc ? 'ADC · Bot Lane Live Coach' : 'Jungle · Live Coach'}
      </span>
      <span className="m3-body-s">
        Riot Live Client Data only · public scoreboard &amp; event log · no hidden cooldowns or
        fog-of-war data.
      </span>
    </div>
  );
}

function TelemetryHero({
  role,
  gameTime,
  gold,
  level,
  creepScore,
  smiteLabel,
}: {
  role: LivePlayedRole;
  gameTime: number;
  gold: number;
  level: number;
  creepScore: number;
  smiteLabel: string | null;
}) {
  const minutes = Math.max(gameTime / 60, 1 / 60);
  const csPerMin = gameTime >= 60 ? Math.round((creepScore / minutes) * 10) / 10 : 0;
  const phaseLine =
    gameTime < 900
      ? 'Early skirmish & Voidgrubs window'
      : gameTime < 1200
        ? 'Mid-game Herald & Dragon control'
        : 'Late-game Baron / Elder';

  return (
    <M3Card variant="hero" className="flex flex-col justify-between gap-3">
      <div>
        <div className={cx('m3-label-m', MUTED)}>Match clock &amp; gold</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="m3-display num" aria-label="Match clock">
            {formatClock(gameTime)}
          </span>
          <span className="m3-title-m num text-[color:var(--md-ext-warning)]">{gold}g</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
          Level {level}
        </M3Chip>
        {role !== 'off_role' && (
          <M3Chip size="sm" tone="plain" className={cx('num', ON_SURFACE)}>
            {creepScore} CS · {csPerMin}/min
          </M3Chip>
        )}
        {smiteLabel && (
          <M3Chip size="sm" tone="success">
            {smiteLabel}
          </M3Chip>
        )}
      </div>
      <p className={cx('m3-body-s', MUTED)}>{phaseLine}</p>
    </M3Card>
  );
}

function ObjectiveBoard({
  objectives,
  gameTime,
}: {
  objectives: ObjectiveWindow[];
  gameTime: number;
}) {
  const rows =
    objectives.length > 0
      ? objectives.map((obj) => ({
          id: obj.id,
          name: obj.name,
          status: obj.status,
          timerLabel:
            obj.status === 'live'
              ? 'LIVE NOW'
              : obj.status === 'slain'
                ? 'Slain'
                : `in ${formatClock(obj.secondsRemaining)}`,
          actionText: obj.actionText,
        }))
      : FALLBACK_OBJECTIVE_SPAWNS.map((spawn) => {
          const remaining = spawn.spawnSec - gameTime;
          return {
            id: spawn.id,
            name: spawn.name,
            status: (remaining <= 0 ? 'live' : remaining <= 60 ? 'prep_vision' : 'upcoming') as
              | 'live'
              | 'prep_vision'
              | 'upcoming',
            timerLabel: remaining <= 0 ? 'LIVE NOW' : `Spawns ${formatClock(spawn.spawnSec)}`,
            actionText: `First spawn at ${formatClock(spawn.spawnSec)} (fixed Season 2026 rule).`,
          };
        });

  return (
    <M3Card variant="hero" as="section" aria-label="Live Objective Timers">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m3-title-m flex items-center gap-2">
          <Timer className="h-4 w-4" aria-hidden /> Live Objective Timers
        </h3>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const tone =
            row.status === 'live'
              ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
              : row.status === 'prep_vision'
                ? 'bg-[color:var(--md-ext-warning-container)] text-[color:var(--md-ext-on-warning-container)]'
                : 'bg-[color:var(--md-sys-color-surface-container-high)] text-[color:var(--md-sys-color-on-surface)]';
          const coloured = row.status === 'live' || row.status === 'prep_vision';
          return (
            <div
              key={row.id}
              className={cx('m3-spring rounded-[var(--md-sys-shape-corner-large)] p-3', tone)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="m3-title-s">{row.name}</span>
                <span className="m3-label-m num font-bold">{row.timerLabel}</span>
              </div>
              <p className={cx('m3-body-s mt-1', coloured ? 'opacity-90' : MUTED)}>
                {row.actionText}
              </p>
            </div>
          );
        })}
      </div>
    </M3Card>
  );
}

function ItemIcon({ id, name, patchVersion }: { id: number; name: string; patchVersion: string }) {
  return (
    <img
      src={getItemIconUrl(id, patchVersion)}
      alt={name}
      className="h-11 w-11 shrink-0 rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-sys-color-surface-container-lowest)]"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}

function NextItemModule({
  rec,
  patchVersion,
  label,
}: {
  rec: ItemRecommendation;
  patchVersion: string;
  label: string;
}) {
  return (
    <M3Card variant="module">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ItemIcon id={rec.item.id} name={rec.item.name} patchVersion={patchVersion} />
          <div className="min-w-0">
            <div className="m3-title-s">
              {label}: {rec.item.name}
            </div>
            <div className={cx('m3-body-s mt-0.5', MUTED)}>{rec.reason}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {rec.affordableNow ? (
            <M3Chip size="sm" tone="success">
              BUY
            </M3Chip>
          ) : (
            <M3Chip size="sm" tone="warning" className="num">
              Need {rec.goldNeeded}g
            </M3Chip>
          )}
          <div className={cx('m3-body-s num mt-1', MUTED)}>Total {rec.item.cost}g</div>
        </div>
      </div>
      {!rec.affordableNow && rec.affordableComponents.length > 0 && (
        <div className="m3-body-s mt-2.5 rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-ext-success-container)] px-3 py-2 text-[color:var(--md-ext-on-success-container)]">
          On recall, buy components now:{' '}
          <strong>
            {rec.affordableComponents.map((c) => `${c.name} (${c.cost}g)`).join(', ')}
          </strong>
        </div>
      )}
    </M3Card>
  );
}

function BuildCard({
  title,
  buildPlan,
  patchVersion,
  nextLabel = 'Next priority',
  extra,
}: {
  title: string;
  buildPlan: AdaptiveBuildPlan;
  patchVersion: string;
  nextLabel?: string;
  extra?: ReactNode;
}) {
  return (
    <M3Card variant="hero" as="section" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m3-title-m">{title}</h3>
        {buildPlan.isFullBuild && (
          <M3Chip size="sm" tone="primary">
            Full build active
          </M3Chip>
        )}
      </div>

      {buildPlan.threats.reasons.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Threats from public scoreboard">
          {buildPlan.threats.reasons.map((reason) => (
            <M3Chip key={reason} size="sm" tone="error" className="whitespace-normal py-1 h-auto">
              <AlertTriangle aria-hidden />
              {reason}
            </M3Chip>
          ))}
        </div>
      )}

      {buildPlan.nextItem && (
        <NextItemModule rec={buildPlan.nextItem} patchVersion={patchVersion} label={nextLabel} />
      )}

      {buildPlan.upcomingQueue.length > 0 && (
        <ol className="mt-3 space-y-1.5" aria-label="Upcoming build queue">
          {buildPlan.upcomingQueue.map((rec, idx) => (
            <li key={rec.item.id} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cx('m3-label-m num w-4 text-center', MUTED)}>{idx + 2}</span>
                <img
                  src={getItemIconUrl(rec.item.id, patchVersion)}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-[var(--md-sys-shape-corner-small)]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="min-w-0">
                  <span className="m3-label-l">{rec.item.name}</span>
                  <span className={cx('m3-body-s ml-2', MUTED)}>{rec.reason}</span>
                </div>
              </div>
              <span className={cx('m3-body-s num shrink-0', MUTED)}>{rec.item.cost}g</span>
            </li>
          ))}
        </ol>
      )}

      {buildPlan.fullBuildAlternatives.length > 0 && (
        <M3Card variant="module" className="mt-3">
          <div className="m3-title-s">Full-build replacement alternatives</div>
          <div className="mt-1.5 space-y-1.5">
            {buildPlan.fullBuildAlternatives.map((alt) => (
              <div key={alt.recommendedItem.id} className="m3-body-s">
                <span className="font-semibold">
                  Swap {alt.replaceTarget} → {alt.recommendedItem.name}
                </span>
                <span className={cx('block', MUTED)}>{alt.reason}</span>
              </div>
            ))}
          </div>
        </M3Card>
      )}

      {extra}
    </M3Card>
  );
}

function TrinketCard({ buildPlan }: { buildPlan: AdaptiveBuildPlan }) {
  return (
    <M3Card variant="hero" as="section" aria-label="Trinket & consumables">
      <h3 className="m3-title-m mb-2.5 flex items-center gap-2">
        <Eye className="h-4 w-4" aria-hidden /> Trinket &amp; consumables
      </h3>
      <M3Card variant="module">
        <div className="m3-title-s">Trinket: {buildPlan.trinketAdvice.item.name}</div>
        <p className={cx('m3-body-s mt-0.5', MUTED)}>{buildPlan.trinketAdvice.reason}</p>
      </M3Card>
      {buildPlan.consumableAdvice.length > 0 && (
        <ul className="mt-2 space-y-2">
          {buildPlan.consumableAdvice.map((cons) => (
            <li key={cons.item.id} className="m3-body-s">
              <div className="font-semibold">
                {cons.item.name} ({cons.item.cost}g)
              </div>
              <div className={MUTED}>{cons.reason}</div>
            </li>
          ))}
        </ul>
      )}
    </M3Card>
  );
}

function MacroCuesCard({
  title,
  cues,
  leading,
}: {
  title: string;
  cues: MacroCue[];
  leading?: ReactNode;
}) {
  const guardrailCount = cues.filter((c) => c.source === 'personal_guardrail').length;
  return (
    <M3Card variant="hero" as="section" aria-label={title}>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m3-title-m">{title}</h3>
        {guardrailCount > 0 && (
          <M3Chip size="sm" tone="primary">
            Guardrails {guardrailCount} / 2
          </M3Chip>
        )}
      </div>
      {leading}
      {cues.length === 0 ? (
        <p className={cx('m3-body-s', MUTED)}>No macro cues right now — keep tracking waves.</p>
      ) : (
        <ol className="space-y-2">
          {cues.map((cue, idx) => {
            const urgent = cue.priority === 'urgent';
            return (
              <li
                key={cue.id}
                className={cx(
                  'm3-spring flex gap-3 rounded-[var(--md-sys-shape-corner-large)] p-3',
                  urgent
                    ? 'bg-[color:var(--md-sys-color-tertiary-container)] text-[color:var(--md-sys-color-on-tertiary-container)]'
                    : 'bg-[color:var(--md-sys-color-surface-container-high)]'
                )}
              >
                <span
                  className={cx(
                    'm3-label-m num grid h-6 w-6 shrink-0 place-items-center rounded-full',
                    cue.source === 'personal_guardrail'
                      ? 'bg-[color:var(--md-sys-color-primary)] text-[color:var(--md-sys-color-on-primary)]'
                      : 'bg-[color:var(--md-sys-color-surface-container-lowest)] text-[color:var(--md-sys-color-on-surface)]'
                  )}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="m3-title-s">{cue.title}</span>
                    <div className="flex items-center gap-1.5">
                      {cue.source === 'personal_guardrail' && (
                        <M3Chip size="sm" tone="primary">
                          Personal Guardrail
                        </M3Chip>
                      )}
                      <span className={cx('m3-label-m capitalize', urgent ? '' : MUTED)}>
                        {cue.category}
                      </span>
                    </div>
                  </div>
                  <p className={cx('m3-body-s mt-0.5', urgent ? 'opacity-90' : MUTED)}>
                    {cue.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// Jungle-only cards
// ---------------------------------------------------------------------------

function SmiteTrackerCard({
  tierName,
  damage,
  note,
  remaining,
  thresholds,
}: {
  tierName: 'Base' | 'Unleashed' | 'Primal';
  damage: number;
  note: string;
  remaining: number;
  thresholds: SmiteThresholdsConfig;
}) {
  const tiers: Array<{ name: 'Base' | 'Unleashed' | 'Primal'; damage: number }> = [
    { name: 'Base', damage: thresholds.baseDamage },
    { name: 'Unleashed', damage: thresholds.unleashedDamage },
    { name: 'Primal', damage: thresholds.primalDamage },
  ];
  const activeIdx = tiers.findIndex((t) => t.name === tierName);
  return (
    <M3Card variant="hero" as="section" aria-label="Smite Damage Tracker">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="m3-title-m flex items-center gap-2">
          <Flame className="h-4 w-4" aria-hidden /> Smite Damage Tracker
        </h3>
        <span className="m3-title-m num">{damage}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="list" aria-label="Smite tiers">
        {tiers.map((tier, idx) => {
          const reached = idx <= activeIdx;
          return (
            <div
              key={tier.name}
              role="listitem"
              aria-current={idx === activeIdx ? 'true' : undefined}
              className={cx(
                'rounded-[var(--md-sys-shape-corner-medium)] px-2 py-2 text-center',
                reached
                  ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
                  : 'bg-[color:var(--md-sys-color-surface-container-high)] text-[color:var(--md-sys-color-on-surface)]'
              )}
            >
              <div className="m3-label-m">{tier.name}</div>
              <div className="m3-title-s num">{tier.damage}</div>
            </div>
          );
        })}
      </div>
      <p className={cx('m3-body-s mt-2', MUTED)}>
        {note}
        {remaining > 0 ? ` (~${remaining} left)` : ''}
      </p>
    </M3Card>
  );
}

function parseClock(value: string): number | null {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function OpeningClearCard({
  route,
  gameTime,
}: {
  route: WinConditionPlan['routes'][number] | null;
  gameTime: number;
}) {
  if (!route) return null;
  return (
    <M3Card variant="hero" as="section" aria-label="Opening Clear">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m3-title-m">Opening Clear</h3>
        <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
          {route.shortLabel}
        </M3Chip>
      </div>
      <p className={cx('m3-body-s mb-2', MUTED)}>{route.summary}</p>
      <ol className="space-y-1">
        {route.steps.map((step) => {
          const target = parseClock(step.targetTime);
          const done = target !== null && gameTime >= target;
          return (
            <li key={`${step.order}-${step.campId}`} className="flex items-start gap-2.5">
              {done ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--md-ext-success)]"
                  aria-label="done"
                />
              ) : (
                <Circle className={cx('mt-0.5 h-4 w-4 shrink-0', MUTED)} aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cx('m3-label-l', done && 'line-through opacity-70')}>
                    {step.order}. {step.campName}
                  </span>
                  <span className={cx('m3-label-m num', MUTED)}>{step.targetTime}</span>
                </div>
                {step.note && <p className={cx('m3-body-s', MUTED)}>{step.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// Off-role
// ---------------------------------------------------------------------------

function OffRoleGlobalCard() {
  return (
    <M3Card variant="hero" as="section" aria-label="Global Objectives Mode">
      <h3 className="m3-title-m">Global Objectives Mode Active</h3>
      <p className={cx('m3-body-m mt-1.5', MUTED)}>
        You are playing off-role in this match. Live Coach and the Compact HUD display strictly
        global neutral objectives (Dragon, Voidgrubs, Rift Herald, Baron Nashor) without injecting
        jungle items or role-specific tips.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Withheld in off-role games">
        {['Smite tracker', 'Jungle items', 'Jungle route cues', 'Build recommendations'].map(
          (label) => (
            <M3Chip key={label} size="sm">
              {label} · withheld
            </M3Chip>
          )
        )}
      </div>
    </M3Card>
  );
}

// ---------------------------------------------------------------------------
// ADC
// ---------------------------------------------------------------------------

function sanitizeAdcBuildPlan(plan: AdaptiveBuildPlan | null): AdaptiveBuildPlan | null {
  if (!plan) return null;
  const allowed = (rec: ItemRecommendation | null) =>
    rec !== null && !NON_ADC_ITEM_IDS.has(rec.item.id);
  return {
    ...plan,
    nextItem: allowed(plan.nextItem) ? plan.nextItem : null,
    upcomingQueue: plan.upcomingQueue.filter((rec) => allowed(rec)),
    fullBuildAlternatives: plan.fullBuildAlternatives.filter(
      (alt) => !NON_ADC_ITEM_IDS.has(alt.recommendedItem.id)
    ),
    consumableAdvice: plan.consumableAdvice.filter((c) => !NON_ADC_ITEM_IDS.has(c.item.id)),
  };
}

function AdcLiveSection({
  buildPlan,
  macroCues,
  adcWinPlan,
  patchVersion,
  gold,
  level,
  gameTime,
  creepScore,
  ownedTrinketId,
}: {
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  adcWinPlan: AdcWinConditionPlan | null;
  patchVersion: string;
  gold: number;
  level: number;
  gameTime: number;
  creepScore: number;
  ownedTrinketId?: number;
}) {
  const plan = sanitizeAdcBuildPlan(buildPlan);
  const csTarget = resolveAdcCsTarget(null).target;
  const minutes = gameTime / 60;
  const csPerMin = minutes >= 1 ? Math.round((creepScore / minutes) * 10) / 10 : 0;
  const plateDeadline = adcWinPlan?.plateWindow.deadlineSec ?? 840;
  const farsightDue =
    (level >= 9 || gameTime >= 900) && ownedTrinketId !== ADC_ITEM_IDS.farsightAlteration;
  const spikePct = Math.min(100, Math.round((gold / ADC_RECALL_SPIKE_GOLD) * 100));

  const quickTiles: Array<{ id: string; label: string; value: string; ok: boolean | null }> = [
    {
      id: 'bf',
      label: `B.F. Sword spike (${ADC_RECALL_SPIKE_GOLD}g)`,
      value: gold >= ADC_RECALL_SPIKE_GOLD ? 'Recall now' : `${spikePct}%`,
      ok: gold >= ADC_RECALL_SPIKE_GOLD ? true : null,
    },
    {
      id: 'cs',
      label: `CS/min pace vs ${csTarget}`,
      value: minutes >= 1 ? String(csPerMin) : '—',
      ok: minutes >= 1 ? csPerMin >= csTarget : null,
    },
    {
      id: 'plates',
      label: `Plates fall at ${formatClock(plateDeadline)}`,
      value:
        gameTime < plateDeadline ? `${formatClock(plateDeadline - gameTime)} left` : 'Plates gone',
      ok: gameTime < plateDeadline ? null : false,
    },
  ];

  const farsightReminder = farsightDue ? (
    <div className="m3-body-s mt-3 flex items-start gap-2 rounded-[var(--md-sys-shape-corner-medium)] bg-[color:var(--md-ext-warning-container)] px-3 py-2 text-[color:var(--md-ext-on-warning-container)]">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Swap to Farsight Alteration</strong> on your next recall (Lv9 / 15:00) — scout
        brushes from range instead of face-checking.
      </span>
    </div>
  ) : null;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {plan ? (
          <BuildCard
            title="ADC Adaptive Build & Trinket"
            buildPlan={plan}
            patchVersion={patchVersion}
            nextLabel={plan.upcomingQueue.length > 0 || plan.isFullBuild ? 'Next buy' : 'First core spike'}
            extra={
              <>
                <M3Card variant="module" className="mt-3">
                  <div className="m3-title-s">Trinket: {plan.trinketAdvice.item.name}</div>
                  <p className={cx('m3-body-s mt-0.5', MUTED)}>{plan.trinketAdvice.reason}</p>
                </M3Card>
                {farsightReminder}
              </>
            }
          />
        ) : (
          <M3Card variant="hero" as="section" aria-label="ADC Adaptive Build & Trinket">
            <h3 className="m3-title-m">ADC Adaptive Build &amp; Trinket</h3>
            <p className={cx('m3-body-s mt-1', MUTED)}>
              Waiting for the public scoreboard to resolve your first core spike.
            </p>
            {farsightReminder}
          </M3Card>
        )}

        <MacroCuesCard
          title="ADC Live Macro Cues"
          cues={macroCues}
          leading={
            <div className="mb-3 grid grid-cols-3 gap-2">
              {quickTiles.map((tile) => (
                <div
                  key={tile.id}
                  className={cx(
                    'rounded-[var(--md-sys-shape-corner-medium)] px-2.5 py-2',
                    tile.ok === true
                      ? 'bg-[color:var(--md-ext-success-container)] text-[color:var(--md-ext-on-success-container)]'
                      : tile.ok === false
                        ? 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
                        : 'bg-[color:var(--md-sys-color-surface-container-high)] text-[color:var(--md-sys-color-on-surface)]'
                  )}
                >
                  <div className="m3-body-s">{tile.label}</div>
                  <div className="m3-title-s num">{tile.value}</div>
                </div>
              ))}
            </div>
          }
        />
      </div>

      {adcWinPlan && <AdcWinPlanQuickCard plan={adcWinPlan} gameTime={gameTime} />}
    </>
  );
}

function AdcWinPlanQuickCard({ plan, gameTime }: { plan: AdcWinConditionPlan; gameTime: number }) {
  const threat = plan.enemyJunglerThreat;
  const inDanger =
    gameTime >= threat.dangerWindow.startSec && gameTime <= threat.dangerWindow.endSec;
  return (
    <M3Card variant="hero" as="section" aria-label="Bot Lane Plan Quick Reference">
      <h3 className="m3-title-m mb-3">Bot Lane Plan · Quick Reference</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <M3Card variant="module">
          <div className={cx('m3-label-m', MUTED)}>Wave plan</div>
          <div className="m3-title-s mt-0.5">
            {plan.wavePlan.decision === 'push_lv2_all_in' ? 'Push for Lv2 all-in' : 'Concede push · trim'}
          </div>
          <p className={cx('m3-body-s mt-1', MUTED)}>{plan.wavePlan.instruction}</p>
        </M3Card>
        <M3Card variant="module">
          <div className={cx('m3-label-m', MUTED)}>Bot → Mid swap</div>
          <div className="m3-title-s mt-0.5">{plan.midSwap.trigger}</div>
          <p className={cx('m3-body-s mt-1', MUTED)}>{plan.midSwap.instruction}</p>
        </M3Card>
        <div
          className={cx(
            'rounded-[var(--md-sys-shape-corner-large)] p-4',
            inDanger
              ? 'bg-[color:var(--md-sys-color-error-container)] text-[color:var(--md-sys-color-on-error-container)]'
              : 'bg-[color:var(--md-sys-color-surface-container-high)]'
          )}
        >
          <div className={cx('m3-label-m', inDanger ? '' : MUTED)}>
            Enemy jungler · {threat.threatLevel} threat
          </div>
          <div className="m3-title-s mt-0.5">
            {formatChampionName(threat.enemyJunglerName)} · {threat.dangerWindow.label}
          </div>
          <p className={cx('m3-body-s mt-1', inDanger ? 'opacity-90' : MUTED)}>
            {inDanger ? 'Gank danger window is open now. ' : ''}
            {threat.instruction}
          </p>
        </div>
      </div>
    </M3Card>
  );
}
