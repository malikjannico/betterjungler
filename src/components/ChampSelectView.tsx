import { useMemo, useState } from 'react';
import { CheckCircle2, Lock, Sparkles, Wand2 } from 'lucide-react';
import {
  SUMMONER_SPELL_INFO,
  getChampionMeta,
} from '../data/jungleKnowledgePack';
import {
  analyzeTeamComposition,
  recommendJunglePicks,
  sanitizeChampSelectSession,
} from '../domain/champSelectEngine';
import { getChampionIconUrl } from '../services/ddragonService';
import { applyRunesAndSpells } from '../services/tauriBridge';
import type { LcuChampSelectSession, SummonerProfileSummary } from '../types/riot';

interface ChampSelectViewProps {
  session: LcuChampSelectSession | null;
  patchVersion: string;
  summonerProfile: SummonerProfileSummary | null;
}

export function ChampSelectView({
  session,
  patchVersion,
  summonerProfile,
}: ChampSelectViewProps) {
  const [selectedChampionId, setSelectedChampionId] = useState<number | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  const sanitized = useMemo(
    () => (session ? sanitizeChampSelectSession(session) : null),
    [session]
  );

  const allyIds = useMemo(
    () => sanitized?.myTeam.map((s) => s.championId).filter((id) => id > 0) ?? [],
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
    () => sanitized?.theirTeam.find((s) => s.assignedPosition === 'jungle')?.championId,
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
      }),
    [allyIds, enemyIds, bannedIds, enemyJunglerId, summonerProfile]
  );

  const activePick =
    recommendations.find((r) => r.champion.championId === selectedChampionId) ??
    recommendations[0] ??
    null;

  async function handleApplyRunesAndSpells() {
    if (!activePick) return;
    const res = await applyRunesAndSpells(
      activePick.champion.recommendedRunes,
      activePick.champion.recommendedSpells[0],
      activePick.champion.recommendedSpells[1]
    );
    setApplyStatus(res.message);
  }

  return (
    <div className="space-y-3">
      {/* Draft Header & Anonymity Badge */}
      <div className="hud-card flex flex-wrap items-center justify-between gap-2 rounded-xl p-3">
        <div>
          <h2 className="text-sm font-bold text-slate-100">Champion Select Draft Coach</h2>
          <p className="text-[11px] text-slate-400">
            {sanitized
              ? `${sanitized.mapSide.toUpperCase()} Side • Patch ${patchVersion} • Picks weighted by meta, team gaps & matchup`
              : 'Waiting for League Client Champ Select (or switch to Demo: Champ Select above)'}
          </p>
        </div>
        {sanitized?.isRankedSoloDuo && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            <Lock className="h-3 w-3" />
            Solo/Duo Anonymity Enforced
          </span>
        )}
      </div>

      {/* Team Draft Summary & Gaps */}
      {sanitized && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="hud-card rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-cyan-300">
              <span>Your Team ({allyComp.archetype})</span>
              <span className="text-[11px] text-slate-400">
                AD {allyComp.adScore} / AP {allyComp.apScore}
              </span>
            </div>
            <div className="space-y-1.5">
              {sanitized.myTeam.map((slot) => {
                const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
                return (
                  <div
                    key={slot.cellId}
                    className="flex items-center justify-between rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-[10px] uppercase text-slate-400">
                        {slot.assignedPosition}
                      </span>
                      <span className="font-medium text-slate-200">{slot.displayName}</span>
                    </div>
                    <span className="font-semibold text-cyan-200">
                      {meta ? meta.name : slot.isLocalPlayer ? 'Picking Now...' : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>
            {allyComp.gaps.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {allyComp.gaps.map((gap) => (
                  <span
                    key={gap}
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200"
                  >
                    {gap}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="hud-card rounded-xl p-3">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-rose-300">
              <span>Enemy Team</span>
              <span className="text-[11px] text-slate-400">
                Bans: {bannedIds.filter((id) => id > 0).length}
              </span>
            </div>
            <div className="space-y-1.5">
              {sanitized.theirTeam.map((slot) => {
                const meta = slot.championId > 0 ? getChampionMeta(slot.championId) : null;
                return (
                  <div
                    key={slot.cellId}
                    className="flex items-center justify-between rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-[10px] uppercase text-slate-400">
                        {slot.assignedPosition}
                      </span>
                      <span className="font-medium text-slate-300">{slot.displayName}</span>
                    </div>
                    <span className="font-semibold text-rose-200">
                      {meta ? meta.name : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Top 5 Recommendations + Runes/Spells 1-Click Apply */}
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="hud-card rounded-xl p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            Top 5 Jungle Picks for This Draft
          </div>
          <div className="space-y-2">
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
                  className={`w-full rounded-lg border p-2.5 text-left transition ${
                    isSelected
                      ? 'border-cyan-400/70 bg-cyan-500/10'
                      : 'border-slate-700/70 bg-slate-900/60 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="tabular-nums text-xs font-bold text-slate-400">
                        #{idx + 1}
                      </span>
                      <img
                        src={getChampionIconUrl(rec.champion.key, patchVersion)}
                        alt={rec.champion.name}
                        className="h-8 w-8 rounded-md border border-slate-700 bg-slate-800 object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-100">
                            {rec.champion.name}
                          </span>
                          <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                            {rec.champion.metaTier}
                          </span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                            {rec.champion.damageProfile}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-300">{rec.reasons[0]}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular-nums text-sm font-extrabold text-cyan-300">
                        {rec.totalScore}
                      </div>
                      <div className="text-[10px] text-slate-400">Fit Score</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {activePick && (
          <div className="hud-card flex flex-col justify-between rounded-xl p-3">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-100">
                    {activePick.champion.name} — Optimal Setup
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {activePick.champion.recommendedRunes.name}
                  </div>
                </div>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                  {activePick.champion.powerSpike} spike
                </span>
              </div>

              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Summoner Spells
                </div>
                <div className="flex gap-2">
                  {activePick.champion.recommendedSpells.map((spellId) => (
                    <div
                      key={spellId}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-cyan-200"
                    >
                      {SUMMONER_SPELL_INFO[spellId]?.name ?? `Spell ${spellId}`}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Recommended Runes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activePick.champion.recommendedRunes.summaryLabels.map((label, idx) => (
                    <span
                      key={label}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        idx === 0
                          ? 'border border-amber-400/40 bg-amber-500/15 font-semibold text-amber-200'
                          : 'bg-slate-800/90 text-slate-200'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Draft Reasoning
                </div>
                <ul className="space-y-1 text-[11px] text-slate-300">
                  {activePick.reasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      <span>{reason}</span>
                    </li>
                  ))}
                  {activePick.warnings.map((w) => (
                    <li key={w} className="text-amber-300">
                      • Caution: {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={handleApplyRunesAndSpells}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-400"
              >
                <Wand2 className="h-4 w-4" />
                Apply Runes &amp; Spells to LoL Client
              </button>
              {applyStatus && (
                <p className="text-center text-[11px] text-emerald-300">{applyStatus}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
