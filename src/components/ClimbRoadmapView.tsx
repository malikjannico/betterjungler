import { Award, BarChart3, Bot, Database, TrendingUp } from 'lucide-react';
import type { SummonerProfileSummary } from '../types/riot';

interface ClimbRoadmapViewProps {
  summonerProfile: SummonerProfileSummary | null;
  targetDivision: string;
}

export function ClimbRoadmapView({
  summonerProfile,
  targetDivision,
}: ClimbRoadmapViewProps) {
  return (
    <div className="space-y-3">
      <div className="hud-card rounded-xl p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Division Climb Ladder &amp; Post-Game Review
            </h2>
            <p className="text-[11px] text-slate-400">
              Target Next Milestone Division:{' '}
              <span className="font-semibold text-cyan-300">{targetDivision}</span>
            </p>
          </div>
          {summonerProfile ? (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs">
              <div className="font-bold text-cyan-200">{summonerProfile.riotId}</div>
              <div className="text-[11px] text-slate-300">
                {summonerProfile.tier} {summonerProfile.rank} • {summonerProfile.leaguePoints} LP (
                {summonerProfile.wins}W / {summonerProfile.losses}L)
              </div>
            </div>
          ) : (
            <span className="rounded bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">
              Connect Riot ID in Settings to sync live LP &amp; Mastery
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="hud-card rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
            <BarChart3 className="h-4 w-4" />
            Post-Game Match-V5 Timeline Review (Milestone 2)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            Automatically downloads your completed match timeline to plot your exact jungle
            pathing, ward placements, and death locations on Summoner&apos;s Rift — calling out
            strong plays (clean objective setups, cross-map trades) and avoidable mistakes
            (dying 40s before Dragon/Baron).
          </p>
        </div>

        <div className="hud-card rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
            <TrendingUp className="h-4 w-4" />
            Division-Benchmarked KPI Goals (Milestone 2)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            Compares your rolling CS/min, 15m Gold Diff, Objective Share, and Vision/min against
            benchmarks for {targetDivision}, assigning 1–3 concrete weekly improvement goals.
          </p>
        </div>

        <div className="hud-card rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <Database className="h-4 w-4" />
            High-Elo Match-V5 Sampler (Milestone 2)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            Rate-limit-aware background sampler caching Challenger/GM/Master jungle builds and
            runes into local SQLite to enrich the curated Knowledge Pack every patch.
          </p>
        </div>

        <div className="hud-card rounded-xl p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-violet-300">
            <Bot className="h-4 w-4" />
            Optional BYOK AI Coach (Milestone 2)
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
            Optionally plug in your own Gemini, OpenAI, or local Ollama key for natural-language
            post-game debriefs on top of the deterministic coaching engine.
          </p>
        </div>
      </div>

      <div className="hud-card flex items-center gap-2 rounded-xl p-3 text-xs text-slate-300">
        <Award className="h-4 w-4 shrink-0 text-cyan-400" />
        <span>
          SQLite tables (<code>match_summaries</code> &amp; <code>climb_goals</code>) are already
          provisioned in Milestone 1 so Milestone 2 activates seamlessly on your match history.
        </span>
      </div>
    </div>
  );
}
