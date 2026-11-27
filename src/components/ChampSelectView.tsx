import { Swords } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  SUMMONER_SPELL_INFO,
  findJungleChampionById,
  getChampionMeta,
  validateRunePage,
} from '../data/jungleKnowledgePack';
import {
  type PersonalChampRecord,
  analyzeTeamComposition,
  computePersonalBaselineWinRate,
  inferEnemyJunglerId,
  recommendJunglePicks,
  sanitizeChampSelectSession,
  scoreChampion,
} from '../domain/champSelectEngine';
import { getChampionIconUrl } from '../services/ddragonService';
import { applyRunesAndSpells } from '../services/tauriBridge';
import type {
  ChampSelectRecommendation,
  ClimbGoal,
  DemoScenarioId,
  HighEloMetaSnapshot,
} from '../types/coaching';
import type { LcuChampSelectSession, SummonerProfileSummary } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';

interface ChampSelectViewProps {
  session: LcuChampSelectSession | null;
  patchVersion: string;
  summonerProfile: SummonerProfileSummary | null;
  highEloMeta: HighEloMetaSnapshot | null;
  personalStats?: Record<number, PersonalChampRecord>;
  focusGoal?: ClimbGoal | null;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

export function ChampSelectView({
  session,
  patchVersion,
  summonerProfile,
  highEloMeta,
  personalStats,
  focusGoal,
  onPreviewSample,
}: ChampSelectViewProps) {
  const [manualOverride, setManualOverride] = useState<{
    championId: number;
    sessionKey: string;
  } | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

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
    manualOverride && manualOverride.sessionKey === sessionKey
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
  ]);

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

  const activePick =
    recommendations.find((r) => r.champion.championId === selectedChampionId) ??
    hoveredRec ??
    recommendations[0] ??
    null;

  const isUnmappedHover =
    selectedChampionId === null &&
    localSlot !== null &&
    localSlot.championId > 0 &&
    !hoveredRec;

  const hoveredMeta = isUnmappedHover && localSlot ? getChampionMeta(localSlot.championId) : null;

  const isOffRole =
    localSlot !== null &&
    localSlot.assignedPosition !== 'jungle' &&
    localSlot.assignedPosition !== 'unknown';

  async function handleApplyRunesAndSpells() {
    if (!activePick) return;
    setApplyStatus(null);
    setApplyError(null);
    const issues = validateRunePage(activePick.champion.recommendedRunes);
    if (issues.length > 0) {
      setApplyError(`Rune page check failed: ${issues.join(' ')}`);
      return;
    }
    try {
      const res = await applyRunesAndSpells(
        activePick.champion.recommendedRunes,
        activePick.champion.recommendedSpells[0],
        activePick.champion.recommendedSpells[1]
      );
      setApplyStatus(res.message);
    } catch (err) {
      setApplyError(
        err instanceof Error
          ? err.message
          : 'Could not apply runes & spells to League Client.'
      );
    }
  }

  const totalDamageWeight = Math.max(1, allyComp.adScore + allyComp.apScore);
  const adPct = Math.round((allyComp.adScore / totalDamageWeight) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="t-title text-white/[0.92]">Champion Select Draft Coach</h2>
          <p className="t-caption mt-0.5 text-white/[0.62]">
            {sanitized.mapSide === 'blue' ? 'Blue' : 'Red'} Side · Patch {patchVersion} ·
            Weighted by meta
            {highEloMeta ? ` (+${highEloMeta.sampleMatches} high-elo games)` : ''}, comp gaps &
            matchup
          </p>
        </div>

        {sanitized.isRankedSoloDuo && (
          <span className="t-caption inline-flex items-center gap-1.5 font-medium text-emerald-300/90">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Solo/Duo anonymity enforced
          </span>
        )}
      </div>

      {(focusGoal || isOffRole) && (
        <div className="flex flex-wrap items-center gap-2">
          {focusGoal && (
            <div className="lg-inset flex items-center gap-2 px-3 py-1.5 t-caption text-white/[0.85]">
              <span className="font-semibold text-sky-300">Match Focus</span>
              <span>{focusGoal.title}</span>
              <span className="tabular-nums text-white/[0.55]">
                (Target {focusGoal.lowerIsBetter ? '≤' : '≥'} {focusGoal.targetValue}
                {focusGoal.unit ? ` ${focusGoal.unit}` : ''})
              </span>
            </div>
          )}
          {isOffRole && localSlot && (
            <div
              role="status"
              className="rounded-[8px] border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 t-caption text-amber-200"
            >
              Assigned position: <span className="font-semibold capitalize">{localSlot.assignedPosition}</span>{' '}
              — swap or adjust jungle draft recommendations accordingly.
            </div>
          )}
        </div>
      )}

      {/* Hairline-Divided Draft Summary */}
      <GlassSurface className="p-4">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between t-caption">
              <span className="font-semibold text-white/[0.92]">
                Your team · {allyComp.archetype}
              </span>
              <span className="tabular-nums text-white/[0.55]">
                AD {allyComp.adScore} / AP {allyComp.apScore}
              </span>
            </div>

            <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/75 transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${adPct}%` }}
              />
            </div>

            <div className="divide-y divide-white/[0.06]">
              {sanitized.myTeam.map((slot) => {
                const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
                return (
                  <div
                    key={slot.cellId}
                    className="flex items-center justify-between py-2 t-caption"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-16 capitalize text-white/[0.45]">
                        {slot.assignedPosition}
                      </span>
                      <span
                        className={
                          slot.isLocalPlayer
                            ? 'font-semibold text-white/[0.92]'
                            : 'text-white/[0.72]'
                        }
                      >
                        {slot.displayName}
                      </span>
                    </div>
                    <span
                      className={`font-medium ${
                        meta ? 'text-white/[0.92]' : 'text-amber-300'
                      }`}
                    >
                      {meta ? meta.name : slot.isLocalPlayer ? 'Picking now' : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>

            {allyComp.gaps.length > 0 && (
              <div className="t-caption mt-2.5 text-amber-200/90">
                Draft gaps: {allyComp.gaps.join(' · ')}
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="mb-3 flex items-center justify-between t-caption">
              <span className="font-semibold text-white/[0.92]">Enemy team</span>
              <span className="text-white/[0.55]">
                Bans: {bannedIds.filter((id) => id > 0).length}
              </span>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {sanitized.theirTeam.map((slot) => {
                const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
                return (
                  <div
                    key={slot.cellId}
                    className="flex items-center justify-between py-2 t-caption"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-16 capitalize text-white/[0.45]">
                        {slot.assignedPosition}
                      </span>
                      <span className="text-white/[0.62]">{slot.displayName}</span>
                    </div>
                    <span className="font-medium text-white/[0.82]">
                      {meta ? meta.name : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </GlassSurface>

      {/* Top 5 Picks + Setup Card */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <GlassSurface className="p-4">
          <div className="t-caption mb-3 font-medium text-white/[0.62]">
            Top 5 jungle picks for this draft
          </div>

          <div className="space-y-1.5">
            {recommendations.map((rec, idx) => {
              const isSelected = activePick?.champion.championId === rec.champion.championId;
              return (
                <button
                  key={rec.champion.championId}
                  type="button"
                  onClick={() => {
                    setManualOverride({
                      championId: rec.champion.championId,
                      sessionKey,
                    });
                    setApplyStatus(null);
                  }}
                  className={`w-full rounded-[8px] border p-3 text-left transition-all duration-150 active:scale-[0.99] ${
                    isSelected
                      ? 'border-white/25 bg-white/[0.09]'
                      : 'border-white/[0.06] bg-black/20 hover:border-white/15 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="tabular-nums t-caption font-semibold text-white/[0.45]">
                        #{idx + 1}
                      </span>
                      <img
                        src={getChampionIconUrl(rec.champion.key, patchVersion)}
                        alt={rec.champion.name}
                        className="h-9 w-9 shrink-0 rounded-[7px] border border-white/15 bg-black object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] font-semibold text-white/[0.92]">
                            {rec.champion.name}
                          </span>
                          <span className="t-caption text-white/[0.55]">
                            {rec.champion.metaTier} · {rec.champion.damageProfile.toUpperCase()}
                          </span>
                        </div>
                        <p className="t-caption mt-0.5 truncate text-white/[0.55]">
                          {rec.reasons[0]}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="tabular-nums text-base font-bold text-white">
                        {rec.totalScore}
                      </div>
                      <div className="text-[11px] text-white/[0.45]">Fit</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </GlassSurface>

        {activePick && (
          <GlassSurface className="flex flex-col justify-between p-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="t-title text-white/[0.92]">
                    {activePick.champion.name} — Optimal Setup
                  </div>
                  <div className="t-caption mt-0.5 text-white/[0.62]">
                    {activePick.champion.recommendedRunes.name}
                  </div>
                </div>
                <span className="t-caption text-white/[0.55] capitalize">
                  {activePick.champion.powerSpike} spike
                </span>
              </div>

              <div className="border-t border-white/[0.07] pt-3">
                <div className="t-caption mb-1.5 font-medium text-white/[0.55]">
                  Summoner spells
                </div>
                <div className="flex gap-2">
                  {activePick.champion.recommendedSpells.map((spellId) => (
                    <div
                      key={spellId}
                      className="lg-inset px-3 py-1.5 t-caption font-medium text-white/[0.92]"
                    >
                      {SUMMONER_SPELL_INFO[spellId]?.name ?? `Spell ${spellId}`}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="t-caption mb-1.5 font-medium text-white/[0.55]">
                  Recommended runes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activePick.champion.recommendedRunes.summaryLabels.map((label, idx) => (
                    <span
                      key={label}
                      className={`rounded-full px-2.5 py-0.5 t-caption ${
                        idx === 0
                          ? 'border border-white/25 bg-white/12 font-semibold text-white'
                          : 'border border-white/[0.08] bg-white/[0.03] text-white/[0.75]'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/[0.07] pt-3">
                <div className="t-caption mb-1.5 font-medium text-white/[0.55]">
                  Draft reasoning
                </div>
                <ul className="space-y-1 t-caption text-white/[0.78]">
                  {activePick.reasons.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                  {activePick.warnings.map((w) => (
                    <li key={w} className="text-amber-300">
                      · Caution: {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-white/[0.07] pt-3.5">
              {isUnmappedHover && (
                <p className="t-caption text-center text-amber-300">
                  {hoveredMeta ? `${hoveredMeta.name} (Unscored): ` : ''}
                  Your hovered champion is outside the 32-jungler playbook; click a card to apply
                  specific runes.
                </p>
              )}
              <button
                type="button"
                disabled={isUnmappedHover}
                onClick={handleApplyRunesAndSpells}
                className="lg-btn-primary w-full px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                Apply {activePick.champion.name} Runes &amp; Spells to LoL Client
              </button>
              {applyStatus && (
                <p className="t-caption text-center font-medium text-emerald-300">
                  {applyStatus}
                </p>
              )}
              {applyError && (
                <p className="t-caption text-center font-medium text-rose-300">
                  {applyError}
                </p>
              )}
            </div>
          </GlassSurface>
        )}
      </div>
    </div>
  );
}
