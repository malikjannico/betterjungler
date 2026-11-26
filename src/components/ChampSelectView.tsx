import { useMemo, useState } from 'react';
import {
  SUMMONER_SPELL_INFO,
  getChampionMeta,
  validateRunePage,
} from '../data/jungleKnowledgePack';
import {
  analyzeTeamComposition,
  inferEnemyJunglerId,
  recommendJunglePicks,
  sanitizeChampSelectSession,
} from '../domain/champSelectEngine';
import { getChampionIconUrl } from '../services/ddragonService';
import { applyRunesAndSpells } from '../services/tauriBridge';
import type { HighEloMetaSnapshot } from '../types/coaching';
import type { LcuChampSelectSession, SummonerProfileSummary } from '../types/riot';
import { GlassSurface } from './GlassSurface';

interface ChampSelectViewProps {
  session: LcuChampSelectSession | null;
  patchVersion: string;
  summonerProfile: SummonerProfileSummary | null;
  highEloMeta: HighEloMetaSnapshot | null;
}

export function ChampSelectView({
  session,
  patchVersion,
  summonerProfile,
  highEloMeta,
}: ChampSelectViewProps) {
  const [selectedChampionId, setSelectedChampionId] = useState<number | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const sanitized = useMemo(
    () => (session ? sanitizeChampSelectSession(session) : null),
    [session]
  );

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

  const recommendations = useMemo(
    () =>
      recommendJunglePicks({
        allyChampionIds: allyIds,
        enemyChampionIds: enemyIds,
        bannedChampionIds: bannedIds,
        enemyJunglerId,
        masteryChampionIds: summonerProfile?.topMasteryChampionIds,
        highEloMeta,
      }),
    [allyIds, enemyIds, bannedIds, enemyJunglerId, summonerProfile, highEloMeta]
  );

  const activePick =
    recommendations.find((r) => r.champion.championId === selectedChampionId) ??
    recommendations[0] ??
    null;

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <div>
          <h2 className="text-sm font-semibold text-white">Champion Select Draft Coach</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {sanitized
              ? `${sanitized.mapSide.toUpperCase()} Side · Patch ${patchVersion} · Weighted by meta${highEloMeta ? ` (+${highEloMeta.sampleMatches} High-Elo games)` : ''}, comp gaps & matchup`
              : 'Waiting for League Client Champ Select (or select Demo: Champ Select)'}
          </p>
        </div>

        {sanitized?.isRankedSoloDuo && (
          <span className="text-[11px] font-medium text-emerald-300/90">
            Solo/Duo Anonymity Enforced
          </span>
        )}
      </div>

      {/* Hairline-Divided Draft Summary */}
      {sanitized && (
        <GlassSurface className="p-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-white">
                  Your Team · {allyComp.archetype}
                </span>
                <span className="tabular-nums text-[11px] text-slate-400">
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
                      className="flex items-center justify-between py-2 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-14 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          {slot.assignedPosition}
                        </span>
                        <span
                          className={
                            slot.isLocalPlayer
                              ? 'font-semibold text-white'
                              : 'text-slate-300'
                          }
                        >
                          {slot.displayName}
                        </span>
                      </div>
                      <span
                        className={`font-medium ${
                          meta ? 'text-white' : 'text-amber-300'
                        }`}
                      >
                        {meta ? meta.name : slot.isLocalPlayer ? 'Picking Now' : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {allyComp.gaps.length > 0 && (
                <div className="mt-2.5 text-[11px] text-amber-200/90">
                  Draft gaps: {allyComp.gaps.join(' · ')}
                </div>
              )}
            </div>

            <div className="border-t border-white/[0.08] pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Enemy Team</span>
                <span className="text-[11px] text-slate-400">
                  Bans: {bannedIds.filter((id) => id > 0).length}
                </span>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {sanitized.theirTeam.map((slot) => {
                  const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
                  return (
                    <div
                      key={slot.cellId}
                      className="flex items-center justify-between py-2 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-14 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          {slot.assignedPosition}
                        </span>
                        <span className="text-slate-400">{slot.displayName}</span>
                      </div>
                      <span className="font-medium text-slate-200">
                        {meta ? meta.name : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </GlassSurface>
      )}

      {/* Top 5 Picks + Setup Card */}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <GlassSurface className="p-4">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
            Top 5 Jungle Picks for This Draft
          </div>

          <div className="space-y-1.5">
            {recommendations.map((rec, idx) => {
              const isSelected = activePick?.champion.championId === rec.champion.championId;
              return (
                <button
                  key={rec.champion.championId}
                  type="button"
                  onClick={() => {
                    setSelectedChampionId(rec.champion.championId);
                    setApplyStatus(null);
                  }}
                  className={`w-full rounded-[12px] border p-3 text-left transition-all duration-200 active:scale-[0.99] ${
                    isSelected
                      ? 'border-white/25 bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                      : 'border-white/[0.05] bg-black/25 hover:border-white/15 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="tabular-nums text-xs font-semibold text-slate-500">
                        #{idx + 1}
                      </span>
                      <img
                        src={getChampionIconUrl(rec.champion.key, patchVersion)}
                        alt={rec.champion.name}
                        className="h-9 w-9 shrink-0 rounded-[9px] border border-white/15 bg-black object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-white">
                            {rec.champion.name}
                          </span>
                          <span className="text-[10px] font-medium uppercase text-slate-400">
                            {rec.champion.metaTier} · {rec.champion.damageProfile}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          {rec.reasons[0]}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="tabular-nums text-base font-bold text-white">
                        {rec.totalScore}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-500">
                        Fit
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </GlassSurface>

        {activePick && (
          <GlassSurface className="flex flex-col justify-between p-5">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {activePick.champion.name} — Optimal Setup
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {activePick.champion.recommendedRunes.name}
                  </div>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {activePick.champion.powerSpike} spike
                </span>
              </div>

              <div className="border-t border-white/[0.07] pt-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  Summoner Spells
                </div>
                <div className="flex gap-2">
                  {activePick.champion.recommendedSpells.map((spellId) => (
                    <div
                      key={spellId}
                      className="lg-inset px-3 py-1.5 text-xs font-medium text-white"
                    >
                      {SUMMONER_SPELL_INFO[spellId]?.name ?? `Spell ${spellId}`}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  Recommended Runes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activePick.champion.recommendedRunes.summaryLabels.map((label, idx) => (
                    <span
                      key={label}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                        idx === 0
                          ? 'border border-white/25 bg-white/12 font-semibold text-white'
                          : 'border border-white/[0.08] bg-white/[0.03] text-slate-300'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="border-t border-white/[0.07] pt-3">
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
                  Draft Reasoning
                </div>
                <ul className="space-y-1 text-[11px] text-slate-300">
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
              <button
                type="button"
                onClick={handleApplyRunesAndSpells}
                className="lg-btn-primary w-full px-4 py-2.5 text-xs font-bold"
              >
                Apply Runes &amp; Spells to LoL Client
              </button>
              {applyStatus && (
                <p className="text-center text-[11px] font-medium text-emerald-300">
                  {applyStatus}
                </p>
              )}
              {applyError && (
                <p className="text-center text-[11px] font-medium text-rose-300">
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
