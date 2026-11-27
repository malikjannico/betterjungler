import {
  BadgeCheck,
  Crosshair,
  HeartHandshake,
  Info,
  Lock,
  Sparkles,
  Swords,
  TreePine,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  ADC_CHAMPIONS,
  ADC_PERK_NAMES,
  ADC_SUMMONER_SPELL_INFO,
  SUPPORT_ARCHETYPES,
  findAdcChampionById,
} from '../data/adcKnowledgePack';
import {
  SUMMONER_SPELL_INFO,
  findJungleChampionById,
  getChampionMeta,
  validateRunePage,
} from '../data/jungleKnowledgePack';
import {
  inferAllySupportId,
  inferEnemyBotLane,
  recommendAdcPicks,
} from '../domain/adc/adcDraftEngine';
import type { AdcDraftRecommendation, InferredEnemyBotLane } from '../domain/adc/types';
import {
  type PersonalChampRecord,
  analyzeTeamComposition,
  computePersonalBaselineWinRate,
  inferEnemyJunglerId,
  recommendJunglePicks,
  sanitizeChampSelectSession,
  scoreChampion,
} from '../domain/champSelectEngine';
import type { CoachedRole } from '../domain/roles/types';
import type { RoleResolutionSource } from '../domain/sessionContext';
import { getChampionIconUrl } from '../services/ddragonService';
import { applyRunesAndSpells } from '../services/tauriBridge';
import type {
  AdcKpiKey,
  ChampSelectRecommendation,
  ChampionTierOverride,
  ClimbGoal,
  DemoScenarioId,
  HighEloMetaSnapshot,
  RunePageSpec,
} from '../types/coaching';
import type {
  ChampSelectPlayerSlot,
  LcuChampSelectSession,
  SummonerProfileSummary,
} from '../types/riot';
import { EmptyState } from './EmptyState';
import { M3Button, M3Card, M3Chip, M3ListItem, M3SegmentedButton, cx } from './m3';

interface ChampSelectViewProps {
  session: LcuChampSelectSession | null;
  patchVersion: string;
  summonerProfile: SummonerProfileSummary | null;
  highEloMeta: HighEloMetaSnapshot | null;
  personalStats?: Record<number, PersonalChampRecord>;
  metaTierOverrides?: ChampionTierOverride[];
  focusGoal?: ClimbGoal | null;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
  /** Coached role currently driving the draft tools. `'bottom'` = ADC mode. */
  activeRole?: CoachedRole;
  /** How `activeRole` was resolved — drives the auto-detected chip. */
  roleSource?: RoleResolutionSource;
  onSelectRole?: (role: CoachedRole) => void;
}

const ROLE_OPTIONS = [
  { value: 'jungle', label: 'Jungle', icon: <TreePine size={16} aria-hidden /> },
  { value: 'bottom', label: 'ADC', icon: <Crosshair size={16} aria-hidden /> },
] as const;

const ROLE_SOURCE_LABEL: Record<RoleResolutionSource, string> = {
  lcu: 'Auto-detected · LCU',
  spell_heuristic: 'Auto-detected · Spells',
  manual: 'Manual override',
  settings: 'From Settings',
  default: 'Default role',
};

const OFF_ROLES: ReadonlySet<string> = new Set(['top', 'middle', 'utility']);

/** On-surface text for elevated pills/chips (never muted text on surface-container-highest). */
const ON_SURFACE = 'text-[var(--md-sys-color-on-surface)]';
const MUTED = 'text-[var(--md-sys-color-on-surface-variant)]';

function spellIconUrl(spellKey: string, patch: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/spell/${spellKey}.png`;
}

function hideOnError(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = 'hidden';
}

function ChampIcon({
  championKey,
  name,
  patchVersion,
  size = 40,
  className,
}: {
  championKey: string | null;
  name: string;
  patchVersion: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (!championKey) {
    return (
      <span
        aria-hidden
        style={style}
        className={cx(
          'inline-block shrink-0 rounded-[12px] shadow-[inset_0_0_0_1px_var(--md-sys-color-outline-variant)]',
          className
        )}
      />
    );
  }
  return (
    <img
      src={getChampionIconUrl(championKey, patchVersion)}
      alt={name}
      style={style}
      className={cx(
        'shrink-0 rounded-[12px] bg-[var(--md-sys-color-surface-container-highest)] object-cover',
        className
      )}
      onError={hideOnError}
    />
  );
}

function ScorePill({
  label,
  value,
  max,
  signed = false,
}: {
  label: string;
  value: number;
  max?: number;
  signed?: boolean;
}) {
  const sign = signed && value > 0 ? '+' : '';
  return (
    <M3Chip tone="plain" size="sm" className={cx('num', ON_SURFACE)}>
      <span className={MUTED}>{label}</span>
      <b className="font-bold">
        {sign}
        {Math.round(value)}
        {max !== undefined ? `/${max}` : ''}
      </b>
    </M3Chip>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={cx('m3-label-m mb-2 uppercase tracking-[0.6px]', MUTED)}>{children}</div>;
}

/** Ranked Solo/Duo hides enemy positions — the enemy bot duo is ALWAYS presented as `Likely`. */
function likelyBotLabel(enemy: InferredEnemyBotLane | null | undefined): string {
  if (!enemy) return 'Likely enemy bot lane: not visible yet';
  return `Likely enemy bot lane: ${enemy.adcName ?? 'Unknown ADC'} + ${enemy.supportName ?? 'Unknown support'}`;
}

function TeamColumn({
  title,
  side,
  slots,
  patchVersion,
  likelyBotIds,
  footer,
}: {
  title: string;
  side: 'ally' | 'enemy';
  slots: ChampSelectPlayerSlot[];
  patchVersion: string;
  likelyBotIds?: ReadonlySet<number>;
  footer?: ReactNode;
}) {
  return (
    <M3Card variant="hero" as="section" className="!p-5" aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className="m3-label-m font-bold uppercase tracking-[0.8px]"
          style={{
            color: side === 'ally' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)',
          }}
        >
          {title}
        </span>
      </div>
      <div className="space-y-0.5">
        {slots.map((slot) => {
          const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
          const isLikelyBot = Boolean(likelyBotIds?.has(slot.championId) && slot.championId > 0);
          return (
            <div
              key={slot.cellId}
              className={cx(
                'grid min-h-12 grid-cols-[56px_36px_minmax(0,1fr)_auto] items-center gap-2 rounded-[16px] px-2 py-1',
                slot.isLocalPlayer &&
                  'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
              )}
            >
              <span
                className={cx(
                  'm3-label-m font-bold uppercase',
                  slot.isLocalPlayer
                    ? 'text-[var(--md-sys-color-on-secondary-container)]'
                    : 'text-[var(--md-sys-color-outline)]'
                )}
              >
                {slot.assignedPosition === 'unknown' ? '—' : slot.assignedPosition}
              </span>
              <ChampIcon
                championKey={meta?.key ?? null}
                name={meta?.name ?? 'Pending'}
                patchVersion={patchVersion}
                size={36}
                className={slot.isLocalPlayer ? 'shadow-[0_0_0_2px_var(--md-sys-color-primary)]' : undefined}
              />
              <span className="min-w-0">
                <span className="m3-title-s block truncate">
                  {meta ? meta.name : slot.isLocalPlayer ? 'Picking now' : 'Pending'}
                </span>
                <span
                  className={cx(
                    'm3-body-s block truncate',
                    slot.isLocalPlayer ? 'text-[var(--md-sys-color-on-secondary-container)]' : MUTED
                  )}
                >
                  {slot.isLocalPlayer ? 'You' : slot.displayName}
                </span>
              </span>
              {isLikelyBot ? (
                <M3Chip tone="warning" size="sm" title="Inferred from visible picks — Riot hides enemy positions">
                  Likely bot
                </M3Chip>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      {footer}
    </M3Card>
  );
}

function RunePreview({
  runes,
  perkName,
  patchVersion,
  spells,
}: {
  runes: RunePageSpec;
  perkName: (id: number, idx: number) => string;
  patchVersion: string;
  spells: Array<{ id: number; name: string; key?: string }>;
}) {
  const shardIds = runes.selectedPerkIds.slice(6);
  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Summoner spells</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {spells.map((spell) => (
            <M3Chip key={spell.id} tone="plain" className={ON_SURFACE}>
              {spell.key && (
                <img
                  src={spellIconUrl(spell.key, patchVersion)}
                  alt=""
                  className="h-5 w-5 rounded-[6px]"
                  onError={hideOnError}
                />
              )}
              {spell.name}
            </M3Chip>
          ))}
        </div>
      </div>
      <div>
        <SectionLabel>Rune page · {runes.name}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {runes.selectedPerkIds.slice(0, 6).map((id, idx) => (
            <M3Chip
              key={`${id}-${idx}`}
              size="sm"
              tone={idx === 0 ? 'primary' : 'plain'}
              className={idx === 0 ? 'font-bold' : ON_SURFACE}
            >
              {perkName(id, idx)}
            </M3Chip>
          ))}
          {shardIds.length > 0 && (
            <M3Chip size="sm" className={ON_SURFACE}>
              Shards · {shardIds.map((id, i) => perkName(id, i + 6)).join(' · ')}
            </M3Chip>
          )}
        </div>
      </div>
    </div>
  );
}

function ApplyFooter({
  label,
  disabled,
  disabledNote,
  status,
  error,
  onApply,
}: {
  label: string;
  disabled: boolean;
  disabledNote?: string | null;
  status: string | null;
  error: string | null;
  onApply: () => void;
}) {
  return (
    <div className="mt-4 space-y-2 border-t border-[var(--md-sys-color-outline-variant)] pt-4">
      {disabledNote && (
        <p className="m3-body-s text-center text-[var(--md-ext-warning)]">{disabledNote}</p>
      )}
      <M3Button
        variant="filled"
        className="w-full"
        disabled={disabled}
        onClick={onApply}
        icon={<BadgeCheck size={18} aria-hidden />}
      >
        {label}
      </M3Button>
      {status && (
        <p role="status" className="m3-body-s text-center font-medium text-[var(--md-ext-success)]">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="m3-body-s text-center font-medium text-[var(--md-sys-color-error)]">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChampSelectView({
  session,
  patchVersion,
  summonerProfile,
  highEloMeta,
  personalStats,
  metaTierOverrides,
  focusGoal,
  onPreviewSample,
  activeRole,
  roleSource,
  onSelectRole,
}: ChampSelectViewProps) {
  const [localRole, setLocalRole] = useState<CoachedRole>('jungle');
  const role: CoachedRole = activeRole ?? localRole;
  const isAdcMode = role === 'bottom';

  const [manualOverride, setManualOverride] = useState<{
    championId: number;
    sessionKey: string;
    role: CoachedRole;
  } | null>(null);
  const [applyState, setApplyState] = useState<{
    key: string;
    status: string | null;
    error: string | null;
  } | null>(null);

  const sanitized = useMemo(
    () => (session ? sanitizeChampSelectSession(session) : null),
    [session]
  );

  const localSlot = useMemo(
    () => sanitized?.myTeam.find((s) => s.isLocalPlayer) ?? null,
    [sanitized]
  );
  const sessionKey = sanitized
    ? `${sanitized.mapSide}:${localSlot?.cellId ?? -1}:${localSlot?.championId ?? 0}`
    : 'none';
  const selectedChampionId =
    manualOverride && manualOverride.sessionKey === sessionKey && manualOverride.role === role
      ? manualOverride.championId
      : null;

  const allyIds = useMemo(
    () =>
      sanitized?.myTeam
        .filter((s) => !s.isLocalPlayer)
        .map((s) => s.championId)
        .filter((id) => id > 0) ?? [],
    [sanitized]
  );
  const enemyIds = useMemo(
    () => sanitized?.theirTeam.map((s) => s.championId).filter((id) => id > 0) ?? [],
    [sanitized]
  );
  const bannedIds = useMemo(
    () => [...(sanitized?.allyBans ?? []), ...(sanitized?.enemyBans ?? [])],
    [sanitized]
  );
  const enemyJunglerId = useMemo(
    () => (sanitized ? inferEnemyJunglerId(sanitized.theirTeam) : undefined),
    [sanitized]
  );

  const allyComp = useMemo(() => analyzeTeamComposition(allyIds), [allyIds]);

  // ---------------- Jungle (unchanged engine wiring) ----------------
  const recommendations = useMemo(() => {
    if (!sanitized) return [];
    return recommendJunglePicks({
      allyChampionIds: allyIds,
      enemyChampionIds: enemyIds,
      bannedChampionIds: bannedIds,
      enemyJunglerId,
      masteryChampionIds: summonerProfile?.topMasteryChampionIds,
      highEloMeta,
      personalStats,
      metaTierOverrides,
    });
  }, [
    sanitized,
    allyIds,
    enemyIds,
    bannedIds,
    enemyJunglerId,
    summonerProfile,
    highEloMeta,
    personalStats,
    metaTierOverrides,
  ]);

  const hoveredRec: ChampSelectRecommendation | undefined = useMemo(() => {
    if (!sanitized || !localSlot || localSlot.championId <= 0) return undefined;
    const inTop = recommendations.find((r) => r.champion.championId === localSlot.championId);
    if (inTop) return inTop;
    const poolMatch = findJungleChampionById(localSlot.championId);
    if (!poolMatch) return undefined;
    return scoreChampion(poolMatch, {
      allyIds,
      enemyIds,
      enemyJunglerId,
      masterySet: new Set(summonerProfile?.topMasteryChampionIds ?? []),
      highEloMeta,
      personalStats,
      baselinePersonalWr: computePersonalBaselineWinRate(personalStats),
      metaTierOverrides,
    });
  }, [
    sanitized,
    localSlot,
    recommendations,
    allyIds,
    enemyIds,
    enemyJunglerId,
    summonerProfile,
    highEloMeta,
    personalStats,
    metaTierOverrides,
  ]);

  // ---------------- ADC ----------------
  const allySupportId = useMemo(() => {
    if (!sanitized) return undefined;
    const utilitySlot = sanitized.myTeam.find(
      (s) => !s.isLocalPlayer && s.assignedPosition === 'utility' && s.championId > 0
    );
    if (utilitySlot) return utilitySlot.championId;
    return inferAllySupportId(allyIds);
  }, [sanitized, allyIds]);

  const enemyBotLane = useMemo(
    // No explicit positions are passed and Solo/Duo is assumed → always `likely`.
    () => (sanitized ? inferEnemyBotLane(enemyIds, { isRankedSoloDuo: true }) : null),
    [sanitized, enemyIds]
  );

  const adcFocusMetric =
    focusGoal && focusGoal.role === 'bottom' ? (focusGoal.metric as AdcKpiKey) : null;

  const allAdcRecs = useMemo<AdcDraftRecommendation[]>(() => {
    if (!sanitized || !isAdcMode) return [];
    return recommendAdcPicks({
      allyChampionIds: allyIds,
      enemyChampionIds: enemyIds,
      bannedChampionIds: bannedIds,
      allySupportId,
      isRankedSoloDuo: true,
      masteryChampionIds: summonerProfile?.topMasteryChampionIds,
      personalStats,
      metaTierOverrides,
      highEloMeta,
      focusMetric: adcFocusMetric,
      limit: ADC_CHAMPIONS.length,
    });
  }, [
    sanitized,
    isAdcMode,
    allyIds,
    enemyIds,
    bannedIds,
    allySupportId,
    summonerProfile,
    personalStats,
    metaTierOverrides,
    highEloMeta,
    adcFocusMetric,
  ]);
  const adcRecs = useMemo(() => allAdcRecs.slice(0, 5), [allAdcRecs]);
  const hoveredAdcRec = useMemo(() => {
    if (!localSlot || localSlot.championId <= 0) return undefined;
    return allAdcRecs.find((r) => r.champion.championId === localSlot.championId);
  }, [allAdcRecs, localSlot]);

  if (!sanitized) {
    return (
      <EmptyState
        icon={Swords}
        title="Not in Champ Select"
        description="Draft recommendations, team composition gaps, and one-click runes activate automatically as soon as your League client enters Champion Select."
        onPreviewSample={onPreviewSample ? () => onPreviewSample('champ_select') : undefined}
        sampleLabel="Preview sample draft"
      />
    );
  }

  const applyKey = `${role}:${sessionKey}:${selectedChampionId ?? 'auto'}`;
  const applyStatus = applyState?.key === applyKey ? applyState.status : null;
  const applyError = applyState?.key === applyKey ? applyState.error : null;

  const hasLocalHover = selectedChampionId === null && localSlot !== null && localSlot.championId > 0;
  const isOffRole = localSlot !== null && OFF_ROLES.has(localSlot.assignedPosition);

  function selectRole(next: CoachedRole) {
    setLocalRole(next);
    onSelectRole?.(next);
  }

  function selectPick(championId: number) {
    setManualOverride({ championId, sessionKey, role });
  }

  async function applyPage(runes: RunePageSpec, spell1: number, spell2: number) {
    setApplyState({ key: applyKey, status: null, error: null });
    const issues = validateRunePage(runes);
    if (issues.length > 0) {
      setApplyState({
        key: applyKey,
        status: null,
        error: `Rune page check failed: ${issues.join(' ')}`,
      });
      return;
    }
    try {
      const res = await applyRunesAndSpells(runes, spell1, spell2);
      setApplyState({ key: applyKey, status: res.message, error: null });
    } catch (err) {
      setApplyState({
        key: applyKey,
        status: null,
        error: err instanceof Error ? err.message : 'Could not apply runes & spells to League Client.',
      });
    }
  }

  const totalDamageWeight = Math.max(1, allyComp.adScore + allyComp.apScore);
  const adPct = Math.round((allyComp.adScore / totalDamageWeight) * 100);

  const likelyBotIds = new Set<number>(
    isAdcMode
      ? [enemyBotLane?.adcId ?? 0, enemyBotLane?.supportId ?? 0].filter((id) => id > 0)
      : []
  );

  const allyFooter = (
    <div className="mt-3">
      <div className="flex h-2 gap-[3px]" aria-hidden>
        <span
          className="rounded-full bg-[var(--md-sys-color-primary)] transition-all duration-500 motion-reduce:transition-none"
          style={{ width: `${adPct}%` }}
        />
        <span className="flex-1 rounded-full bg-[var(--md-sys-color-tertiary)]" />
      </div>
      <div className={cx('m3-body-s num mt-1 flex justify-between', MUTED)}>
        <span>
          AD {allyComp.adScore} · {adPct}%
        </span>
        <span>
          AP {allyComp.apScore} · {100 - adPct}%
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <M3Chip size="sm" tone="plain" className={ON_SURFACE}>
          {allyComp.archetype}
        </M3Chip>
        {allyComp.gaps.length > 0 ? (
          <M3Chip size="sm" tone="warning" icon={<TriangleAlert aria-hidden />}>
            Gaps: {allyComp.gaps.join(' · ')}
          </M3Chip>
        ) : (
          <M3Chip size="sm" tone="success" icon={<BadgeCheck aria-hidden />}>
            No draft gaps
          </M3Chip>
        )}
      </div>
    </div>
  );

  const enemyFooter = (
    <div className="mt-3 space-y-2">
      {!isAdcMode && enemyJunglerId && (
        <M3Chip size="sm" tone="error" icon={<Swords aria-hidden />}>
          Likely enemy jungler: {getChampionMeta(enemyJunglerId).name}
        </M3Chip>
      )}
      {isAdcMode && (
        <M3Chip size="sm" tone="warning" icon={<Crosshair aria-hidden />} className="max-w-full">
          <span className="truncate">{likelyBotLabel(enemyBotLane)}</span>
        </M3Chip>
      )}
      <div className={cx('m3-body-s num', MUTED)}>
        Bans: {bannedIds.filter((id) => id > 0).length}
      </div>
    </div>
  );

  // ---------------- Header ----------------
  const header = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m3-headline-s">Champion Select Draft Coach</h2>
          <p className={cx('m3-body-s mt-0.5', MUTED)}>
            {sanitized.mapSide === 'blue' ? 'Blue' : 'Red'} Side · Patch {patchVersion} · Weighted by
            meta
            {highEloMeta ? ` (+${highEloMeta.sampleMatches} high-elo games)` : ''},{' '}
            {isAdcMode ? 'support synergy & likely bot matchup' : 'comp gaps & matchup'}
          </p>
        </div>
        {sanitized.isRankedSoloDuo && (
          <M3Chip
            tone="plain"
            size="sm"
            className={ON_SURFACE}
            icon={<Lock aria-hidden />}
            title="Solo/Duo: other players are shown as Ally N / Enemy N; enemy positions are inferred, never guaranteed."
          >
            Solo/Duo anonymity enforced
          </M3Chip>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <M3SegmentedButton<CoachedRole>
          ariaLabel="Coached role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={selectRole}
        />
        {roleSource && (
          <M3Chip
            tone={roleSource === 'manual' ? 'tertiary' : 'success'}
            icon={<Sparkles aria-hidden />}
            title="Switch manually to preview the other coached role's draft tools"
          >
            {ROLE_SOURCE_LABEL[roleSource]}
          </M3Chip>
        )}
        {focusGoal && (
          <M3Chip tone="primary" className="num">
            <span className="font-bold">Match Focus</span>
            <span>{focusGoal.title}</span>
            <span>
              (Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
              {focusGoal.unit ? ` ${focusGoal.unit}` : ''})
            </span>
          </M3Chip>
        )}
      </div>

      {isOffRole && localSlot && (
        <M3Card variant="outlined" role="status" className="flex items-start gap-3 !py-3">
          <Info size={18} aria-hidden className="mt-0.5 shrink-0 text-[var(--md-sys-color-primary)]" />
          <p className="m3-body-m">
            Off-role detected · Assigned position:{' '}
            <span className="font-semibold capitalize">{localSlot.assignedPosition}</span> — live
            coaching focuses on global objectives; switch to Jungle or ADC above to preview draft
            tools.
          </p>
        </M3Card>
      )}
    </div>
  );

  // ---------------- Jungle mode ----------------
  if (!isAdcMode) {
    const activePick =
      recommendations.find((r) => r.champion.championId === selectedChampionId) ??
      hoveredRec ??
      recommendations[0] ??
      null;
    const isUnmappedHover = hasLocalHover && !hoveredRec;
    const hoveredMeta = isUnmappedHover && localSlot ? getChampionMeta(localSlot.championId) : null;

    return (
      <div className="space-y-5">
        {header}

        <div className="grid gap-4 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(260px,300px)]">
          <TeamColumn
            title={`${sanitized.mapSide === 'blue' ? 'Blue' : 'Red'} · Your team`}
            side="ally"
            slots={sanitized.myTeam}
            patchVersion={patchVersion}
            footer={allyFooter}
          />

          <div className="min-w-0 space-y-4">
            {activePick && (
              <M3Card variant="tonal" as="article" aria-live="polite" aria-label="Selected pick" className="!p-5">
                <div className="flex items-center gap-4">
                  <ChampIcon
                    championKey={activePick.champion.key}
                    name={activePick.champion.name}
                    patchVersion={patchVersion}
                    size={72}
                    className="rounded-[20px] shadow-[0_0_0_3px_var(--md-sys-color-primary)]"
                  />
                  <div className="min-w-0">
                    <div className="m3-label-m font-bold uppercase tracking-[0.8px] text-[var(--md-sys-color-primary)]">
                      {selectedChampionId === null && hoveredRec ? 'Your hover' : 'Recommended jungle pick'}
                    </div>
                    <div className="m3-headline-s truncate">{activePick.champion.name}</div>
                    <div className="m3-body-s capitalize">
                      {metaTierOverrides?.find((o) => o.championId === activePick.champion.championId)
                        ?.metaTier ?? activePick.champion.metaTier}{' '}
                      tier · {activePick.champion.damageProfile.toUpperCase()} ·{' '}
                      {activePick.champion.powerSpike} spike
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <b className="num block text-[56px] font-black leading-none tracking-[-2px]">
                      {activePick.totalScore}
                    </b>
                    <span className="m3-label-m">Draft fit</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <ScorePill label="Meta" value={activePick.breakdown.meta} />
                  <ScorePill label="Synergy" value={activePick.breakdown.synergy} />
                  <ScorePill label="Matchup" value={activePick.breakdown.matchup} />
                  <ScorePill label="Team need" value={activePick.breakdown.teamNeed} />
                  <ScorePill label="Mastery" value={activePick.breakdown.mastery} signed />
                </div>

                <ul className="m3-body-m mt-4 space-y-1">
                  {activePick.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <BadgeCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
                      {reason}
                    </li>
                  ))}
                  {activePick.warnings.map((w) => (
                    <li key={w} className="flex gap-2 text-[var(--md-ext-on-warning-container)]">
                      <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                      Caution: {w}
                    </li>
                  ))}
                </ul>
              </M3Card>
            )}

            <M3Card variant="hero" as="section" aria-label="Top 5 jungle picks" className="!p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="m3-title-m">Top 5 jungle picks for this draft</h3>
                <span className={cx('m3-body-s', MUTED)}>Click to compare</span>
              </div>
              <div className="space-y-1">
                {recommendations.map((rec, idx) => {
                  const overrideTier = metaTierOverrides?.find(
                    (ov) => ov.championId === rec.champion.championId
                  )?.metaTier;
                  return (
                    <M3ListItem
                      key={rec.champion.championId}
                      selected={activePick?.champion.championId === rec.champion.championId}
                      onClick={() => selectPick(rec.champion.championId)}
                      ariaLabel={`#${idx + 1} ${rec.champion.name}, fit ${rec.totalScore}`}
                      leading={
                        <span className="flex items-center gap-2">
                          <span className="num m3-label-m w-6 font-bold">#{idx + 1}</span>
                          <ChampIcon
                            championKey={rec.champion.key}
                            name={rec.champion.name}
                            patchVersion={patchVersion}
                            size={36}
                          />
                        </span>
                      }
                      title={
                        <>
                          {rec.champion.name}{' '}
                          <span className="m3-body-s opacity-80">
                            {overrideTier ?? rec.champion.metaTier} ·{' '}
                            {rec.champion.damageProfile.toUpperCase()}
                          </span>
                        </>
                      }
                      description={rec.reasons[0]}
                      meta={<span className="text-[20px] font-extrabold">{rec.totalScore}</span>}
                    />
                  );
                })}
              </div>
            </M3Card>
          </div>

          <TeamColumn
            title={`${sanitized.mapSide === 'blue' ? 'Red' : 'Blue'} · Enemy team`}
            side="enemy"
            slots={sanitized.theirTeam}
            patchVersion={patchVersion}
            footer={enemyFooter}
          />
        </div>

        {activePick && (
          <M3Card variant="module" as="section" aria-label="One-click LCU apply: runes and summoner spells" className="!rounded-[28px] !p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m3-title-m">{activePick.champion.name} — Optimal Setup</h3>
              <M3Chip size="sm" tone="success" icon={<BadgeCheck aria-hidden />}>
                Patch {patchVersion} rune allowlist check
              </M3Chip>
            </div>
            <RunePreview
              runes={activePick.champion.recommendedRunes}
              perkName={(_id, idx) =>
                activePick.champion.recommendedRunes.summaryLabels[idx] ?? `Shard ${idx - 5}`
              }
              patchVersion={patchVersion}
              spells={activePick.champion.recommendedSpells.map((id) => ({
                id,
                name: SUMMONER_SPELL_INFO[id]?.name ?? `Spell ${id}`,
                key: SUMMONER_SPELL_INFO[id]?.key,
              }))}
            />
            <ApplyFooter
              label={`Apply ${activePick.champion.name} Runes & Spells to LoL Client`}
              disabled={isUnmappedHover}
              disabledNote={
                isUnmappedHover
                  ? `${hoveredMeta ? `${hoveredMeta.name} (Unscored): ` : ''}Your hovered champion is outside the 32-jungler playbook; click a pick to apply specific runes.`
                  : null
              }
              status={applyStatus}
              error={applyError}
              onApply={() =>
                void applyPage(
                  activePick.champion.recommendedRunes,
                  activePick.champion.recommendedSpells[0],
                  activePick.champion.recommendedSpells[1]
                )
              }
            />
          </M3Card>
        )}
      </div>
    );
  }

  // ---------------- ADC mode ----------------
  const activeAdc =
    adcRecs.find((r) => r.champion.championId === selectedChampionId) ??
    allAdcRecs.find((r) => r.champion.championId === selectedChampionId) ??
    hoveredAdcRec ??
    adcRecs[0] ??
    null;
  const isUnmappedAdcHover =
    hasLocalHover && localSlot !== null && !findAdcChampionById(localSlot.championId);
  const hoveredAdcMeta =
    isUnmappedAdcHover && localSlot ? getChampionMeta(localSlot.championId) : null;
  const supportEntry = allySupportId ? SUPPORT_ARCHETYPES[allySupportId] : undefined;
  const supportMeta = allySupportId ? getChampionMeta(allySupportId) : null;

  function synergyCallout(rec: AdcDraftRecommendation): string {
    const syn = rec.supportSynergy;
    if (syn?.comboNote) return syn.comboNote;
    if (syn) {
      return syn.affinityRank >= 0
        ? `${syn.supportName} (${syn.supportArchetype}) is a preferred support archetype (#${syn.affinityRank + 1}).`
        : `${syn.supportName} (${syn.supportArchetype}) is outside ${rec.champion.name}'s preferred supports.`;
    }
    return `Prefers ${rec.champion.preferredSupports.join(' / ')} supports — ally support not locked yet.`;
  }

  return (
    <div className="space-y-5">
      {header}

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(260px,300px)]">
        <div className="min-w-0 space-y-4">
          <TeamColumn
            title={`${sanitized.mapSide === 'blue' ? 'Blue' : 'Red'} · Your team`}
            side="ally"
            slots={sanitized.myTeam}
            patchVersion={patchVersion}
            footer={allyFooter}
          />
          <M3Card
            as="aside"
            variant="hero"
            className="!bg-[var(--md-sys-color-tertiary-container)] !p-4 text-[var(--md-sys-color-on-tertiary-container)]"
            aria-label="Support synergy"
          >
            <div className="m3-label-m mb-2 flex items-center gap-1.5 font-bold uppercase tracking-[0.8px] text-[var(--md-sys-color-tertiary)]">
              <HeartHandshake size={14} aria-hidden /> Support Synergy
            </div>
            {allySupportId && supportMeta ? (
              <div className="flex items-center gap-3">
                <ChampIcon
                  championKey={supportMeta.key}
                  name={supportMeta.name}
                  patchVersion={patchVersion}
                  size={40}
                />
                <div className="min-w-0">
                  <div className="m3-title-s truncate">{supportMeta.name}</div>
                  <div className="m3-body-s capitalize">
                    {supportEntry ? `${supportEntry.archetype} · ${supportEntry.shortNote}` : 'Ally support'}
                  </div>
                </div>
              </div>
            ) : (
              <p className="m3-body-s">Ally support not locked or hovered yet — synergy is scored neutrally.</p>
            )}
            {activeAdc && <p className="m3-body-m mt-3">{synergyCallout(activeAdc)}</p>}
          </M3Card>
        </div>

        <div className="min-w-0 space-y-4">
          {activeAdc && (
            <M3Card variant="tonal" as="article" aria-live="polite" aria-label="Selected ADC pick" className="!p-5">
              <div className="flex items-center gap-4">
                <ChampIcon
                  championKey={activeAdc.champion.key}
                  name={activeAdc.champion.name}
                  patchVersion={patchVersion}
                  size={72}
                  className="rounded-[20px] shadow-[0_0_0_3px_var(--md-sys-color-primary)]"
                />
                <div className="min-w-0">
                  <div className="m3-label-m font-bold uppercase tracking-[0.8px] text-[var(--md-sys-color-primary)]">
                    {selectedChampionId === null && hoveredAdcRec ? 'Your hover' : 'Recommended ADC pick'}
                  </div>
                  <div className="m3-headline-s truncate">{activeAdc.champion.name}</div>
                  <div className="m3-body-s capitalize">
                    {metaTierOverrides?.find((o) => o.championId === activeAdc.champion.championId)
                      ?.metaTier ?? activeAdc.champion.metaTier}{' '}
                    tier · {activeAdc.champion.archetype.replace('_', ' ')} ·{' '}
                    {activeAdc.champion.rangeTier} range · {activeAdc.champion.scalingProfile} game
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <b className="num block text-[56px] font-black leading-none tracking-[-2px]">
                    {activeAdc.totalScore}
                  </b>
                  <span className="m3-label-m">Draft fit</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                <ScorePill label="Meta" value={activeAdc.breakdown.meta} max={35} />
                <ScorePill label="Synergy" value={activeAdc.breakdown.supportSynergy} max={20} />
                <ScorePill label="Matchup" value={activeAdc.breakdown.botMatchup} max={20} />
                <ScorePill label="Team need" value={activeAdc.breakdown.teamNeed} max={15} />
                <ScorePill label="Mastery" value={activeAdc.breakdown.mastery} signed />
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <div className="rounded-[16px] bg-[rgba(12,14,19,0.4)] p-3">
                  <div className="m3-label-m mb-1 flex items-center gap-1.5 font-bold">
                    <HeartHandshake size={14} aria-hidden /> Support Synergy
                  </div>
                  <p className="m3-body-s">{synergyCallout(activeAdc)}</p>
                </div>
                <div className="rounded-[16px] bg-[rgba(12,14,19,0.4)] p-3">
                  <div className="m3-label-m mb-1 flex items-center gap-1.5 font-bold">
                    <Crosshair size={14} aria-hidden /> Likely Enemy Bot Duo
                    <M3Chip size="sm" tone="warning" className="ml-auto">
                      Likely
                    </M3Chip>
                  </div>
                  <p className="m3-body-s">
                    {likelyBotLabel(activeAdc.botMatchup?.enemy ?? enemyBotLane)}
                    {activeAdc.botMatchup && activeAdc.botMatchup.versusAdc !== 'unknown'
                      ? ` · ${activeAdc.botMatchup.versusAdc}`
                      : ''}
                  </p>
                  {activeAdc.botMatchup?.notes[0] && (
                    <p className="m3-body-s mt-1 opacity-90">{activeAdc.botMatchup.notes[0]}</p>
                  )}
                </div>
              </div>

              <ul className="m3-body-m mt-4 space-y-1">
                {activeAdc.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2">
                    <BadgeCheck size={16} aria-hidden className="mt-0.5 shrink-0" />
                    {reason}
                  </li>
                ))}
                {activeAdc.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-[var(--md-ext-on-warning-container)]">
                    <TriangleAlert size={16} aria-hidden className="mt-0.5 shrink-0" />
                    Caution: {w}
                  </li>
                ))}
              </ul>
            </M3Card>
          )}

          <M3Card variant="hero" as="section" aria-label="Top 5 ADC picks" className="!p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="m3-title-m">Top 5 ADC picks for this draft</h3>
              <span className={cx('m3-body-s', MUTED)}>Click to compare</span>
            </div>
            <div className="space-y-1">
              {adcRecs.map((rec, idx) => (
                <M3ListItem
                  key={rec.champion.championId}
                  selected={activeAdc?.champion.championId === rec.champion.championId}
                  onClick={() => selectPick(rec.champion.championId)}
                  ariaLabel={`#${idx + 1} ${rec.champion.name}, fit ${rec.totalScore}`}
                  leading={
                    <span className="flex items-center gap-2">
                      <span className="num m3-label-m w-6 font-bold">#{idx + 1}</span>
                      <ChampIcon
                        championKey={rec.champion.key}
                        name={rec.champion.name}
                        patchVersion={patchVersion}
                        size={36}
                      />
                    </span>
                  }
                  title={
                    <>
                      {rec.champion.name}{' '}
                      <span className="m3-body-s capitalize opacity-80">
                        {rec.champion.metaTier} · {rec.champion.archetype.replace('_', ' ')}
                      </span>
                    </>
                  }
                  description={
                    <span className="num">
                      Meta {rec.breakdown.meta} · Syn {rec.breakdown.supportSynergy} · MU{' '}
                      {rec.breakdown.botMatchup} · Need {rec.breakdown.teamNeed} · Mastery{' '}
                      {rec.breakdown.mastery > 0 ? '+' : ''}
                      {rec.breakdown.mastery}
                      {rec.supportSynergy?.isExplicitCombo ? ' · Combo' : ''}
                    </span>
                  }
                  meta={<span className="text-[20px] font-extrabold">{rec.totalScore}</span>}
                />
              ))}
              {adcRecs.length === 0 && (
                <p className={cx('m3-body-s', MUTED)}>No eligible ADC picks remain in this draft.</p>
              )}
            </div>
          </M3Card>
        </div>

        <TeamColumn
          title={`${sanitized.mapSide === 'blue' ? 'Red' : 'Blue'} · Enemy team`}
          side="enemy"
          slots={sanitized.theirTeam}
          patchVersion={patchVersion}
          likelyBotIds={likelyBotIds}
          footer={enemyFooter}
        />
      </div>

      {activeAdc && (
        <M3Card variant="module" as="section" aria-label="One-click LCU apply: runes and summoner spells" className="!rounded-[28px] !p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m3-title-m">{activeAdc.champion.name} — Optimal Bot Lane Setup</h3>
            <M3Chip size="sm" tone="success" icon={<BadgeCheck aria-hidden />}>
              Patch {patchVersion} rune allowlist check
            </M3Chip>
          </div>
          <RunePreview
            runes={activeAdc.champion.recommendedRunes}
            perkName={(id) => ADC_PERK_NAMES[id] ?? `Perk ${id}`}
            patchVersion={patchVersion}
            spells={activeAdc.champion.recommendedSpells.map((id) => ({
              id,
              name: ADC_SUMMONER_SPELL_INFO[id]?.name ?? `Spell ${id}`,
              key: ADC_SUMMONER_SPELL_INFO[id]?.key,
            }))}
          />
          <ApplyFooter
            label={`Apply ${activeAdc.champion.name} Runes & Spells to LoL Client`}
            disabled={isUnmappedAdcHover}
            disabledNote={
              isUnmappedAdcHover
                ? `${hoveredAdcMeta ? `${hoveredAdcMeta.name} (Unscored): ` : ''}Your hovered champion is outside the ADC playbook; click a pick to apply specific runes.`
                : null
            }
            status={applyStatus}
            error={applyError}
            onApply={() =>
              void applyPage(
                activeAdc.champion.recommendedRunes,
                activeAdc.champion.recommendedSpells[0],
                activeAdc.champion.recommendedSpells[1]
              )
            }
          />
        </M3Card>
      )}
    </div>
  );
}
