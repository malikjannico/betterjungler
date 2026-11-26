import {
  AlertTriangle,
  Coins,
  Compass,
  Eye,
  Flame,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react';
import { formatClock } from '../domain/liveCoachEngine';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  MacroCue,
  ObjectiveWindow,
} from '../types/coaching';
import type { LiveGameData } from '../types/riot';
import { GlassSurface } from './GlassSurface';

interface LiveCoachViewProps {
  liveData: LiveGameData | null;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  patchVersion: string;
}

export function LiveCoachView({
  liveData,
  objectives,
  buildPlan,
  macroCues,
  patchVersion,
}: LiveCoachViewProps) {
  if (!liveData || !buildPlan) {
    return (
      <GlassSurface className="p-8 text-center">
        <h2 className="text-sm font-bold text-slate-100">Live In-Game Coach</h2>
        <p className="mt-1.5 text-xs text-slate-400">
          Connects automatically to League&apos;s Live Client Data API (127.0.0.1:2999) when a
          match begins, or select an In-Game Demo scenario in the header.
        </p>
      </GlassSurface>
    );
  }

  const gold = Math.floor(liveData.activePlayer.currentGold);

  return (
    <div className="space-y-3.5">
      {/* Telemetry & Objective Cadence */}
      <div className="grid gap-3.5 md:grid-cols-[245px_1fr]">
        <GlassSurface className="flex flex-col justify-between p-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Live Telemetry
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="tabular-nums text-3xl font-extrabold tracking-tight text-slate-50">
                {formatClock(liveData.gameData.gameTime)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/12 px-2.5 py-0.5 text-xs font-bold text-amber-200">
                <Coins className="h-3.5 w-3.5" />
                <span className="tabular-nums">{gold}g</span>
              </span>
            </div>
          </div>
          <div className="lg-inset mt-3 px-2.5 py-1.5 text-[11px] font-medium text-slate-300">
            Level {liveData.activePlayer.level} •{' '}
            {liveData.gameData.gameTime < 840
              ? 'Early Clear & Skirmish'
              : liveData.gameData.gameTime < 1500
                ? 'Mid-Game Objective Control'
                : 'Late-Game Baron / Elder'}
          </div>
        </GlassSurface>

        <GlassSurface className="p-4">
          <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-slate-100">
            <Flame className="h-4 w-4 text-amber-300" />
            Objective Windows &amp; Vision Prep
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {objectives.map((obj) => (
              <div
                key={obj.id}
                className={`lg-inset p-3 text-xs ${
                  obj.status === 'live'
                    ? 'border-emerald-400/40 bg-emerald-400/10'
                    : obj.status === 'prep_vision'
                      ? 'border-amber-400/40 bg-amber-400/10'
                      : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100">{obj.name}</span>
                  <span
                    className={`tabular-nums rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      obj.status === 'live'
                        ? 'bg-emerald-400/20 text-emerald-200'
                        : obj.status === 'prep_vision'
                          ? 'bg-amber-400/20 text-amber-200'
                          : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    {obj.status === 'live'
                      ? 'LIVE NOW'
                      : `in ${formatClock(obj.secondsRemaining)}`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-300">{obj.actionText}</p>
              </div>
            ))}
          </div>
        </GlassSurface>
      </div>

      {/* Adaptive Itemization & Macro Cues */}
      <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr]">
        <GlassSurface interactive className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
              <ShoppingBag className="h-4 w-4 text-sky-300" />
              Adaptive Item Build
            </div>
            {buildPlan.isFullBuild && (
              <span className="rounded-full border border-violet-300/35 bg-violet-400/15 px-2.5 py-0.5 text-[10px] font-bold text-violet-200">
                FULL BUILD OPTIMIZER ACTIVE
              </span>
            )}
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {buildPlan.threats.reasons.map((reason) => (
              <span
                key={reason}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] text-slate-200"
              >
                <AlertTriangle className="h-3 w-3 text-amber-300" />
                {reason}
              </span>
            ))}
          </div>

          {buildPlan.nextItem && (
            <div className="lg-inset border-sky-300/30 bg-sky-400/[0.08] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={getItemIconUrl(buildPlan.nextItem.item.id, patchVersion)}
                    alt={buildPlan.nextItem.item.name}
                    className="h-10 w-10 rounded-[10px] border border-sky-300/35 bg-slate-950"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div>
                    <div className="text-xs font-bold text-sky-100">
                      Next Priority: {buildPlan.nextItem.item.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-300">
                      {buildPlan.nextItem.reason}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`tabular-nums text-xs font-bold ${
                      buildPlan.nextItem.affordableNow ? 'text-emerald-300' : 'text-amber-200'
                    }`}
                  >
                    {buildPlan.nextItem.affordableNow
                      ? 'AFFORDABLE NOW'
                      : `Need ${buildPlan.nextItem.goldNeeded}g`}
                  </div>
                  <div className="tabular-nums text-[10px] text-slate-400">
                    Total {buildPlan.nextItem.item.cost}g
                  </div>
                </div>
              </div>

              {!buildPlan.nextItem.affordableNow &&
                buildPlan.nextItem.affordableComponents.length > 0 && (
                  <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-slate-300">
                    Buy components now:{' '}
                    <span className="font-semibold text-sky-200">
                      {buildPlan.nextItem.affordableComponents
                        .map((c) => `${c.name} (${c.cost}g)`)
                        .join(', ')}
                    </span>
                  </div>
                )}
            </div>
          )}

          {buildPlan.upcomingQueue.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              {buildPlan.upcomingQueue.map((rec) => (
                <div
                  key={rec.item.id}
                  className="lg-inset flex items-center justify-between px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-100">{rec.item.name}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{rec.reason}</span>
                  </div>
                  <span className="tabular-nums text-[11px] font-medium text-slate-400">
                    {rec.item.cost}g
                  </span>
                </div>
              ))}
            </div>
          )}

          {buildPlan.fullBuildAlternatives.length > 0 && (
            <div className="lg-inset mt-3 border-violet-300/35 bg-violet-400/[0.08] p-3">
              <div className="text-[11px] font-bold text-violet-200">
                Full-Build Replacement Alternatives
              </div>
              <div className="mt-1.5 space-y-1.5">
                {buildPlan.fullBuildAlternatives.map((alt) => (
                  <div key={alt.recommendedItem.id} className="text-[11px] text-slate-200">
                    <span className="font-semibold text-violet-200">
                      Swap {alt.replaceTarget} → {alt.recommendedItem.name}
                    </span>
                    <span className="block text-slate-400">{alt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassSurface>

        <div className="space-y-3.5">
          <GlassSurface className="p-4">
            <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-slate-100">
              <Eye className="h-4 w-4 text-amber-300" />
              Trinket &amp; Consumables
            </div>
            <div className="lg-inset border-amber-300/25 bg-amber-400/[0.07] p-2.5 text-xs">
              <div className="font-semibold text-amber-200">
                Trinket: {buildPlan.trinketAdvice.item.name}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-300">
                {buildPlan.trinketAdvice.reason}
              </p>
            </div>
            <div className="mt-2 space-y-1.5">
              {buildPlan.consumableAdvice.map((cons) => (
                <div key={cons.item.id} className="lg-inset px-3 py-2 text-[11px]">
                  <div className="font-semibold text-slate-100">
                    {cons.item.name} ({cons.item.cost}g)
                  </div>
                  <div className="text-slate-400">{cons.reason}</div>
                </div>
              ))}
            </div>
          </GlassSurface>

          <GlassSurface className="p-4">
            <div className="mb-2.5 flex items-center gap-2 text-xs font-bold text-slate-100">
              <Compass className="h-4 w-4 text-sky-300" />
              Macro Action Cues
            </div>
            <div className="space-y-1.5">
              {macroCues.map((cue) => (
                <div
                  key={cue.id}
                  className={`lg-inset p-2.5 text-[11px] ${
                    cue.priority === 'urgent'
                      ? 'border-amber-300/35 bg-amber-400/[0.08]'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">{cue.title}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-300">
                      {cue.category}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-400">{cue.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-emerald-300/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              100% Riot-compliant: no enemy cooldown tracking or hidden data.
            </div>
          </GlassSurface>
        </div>
      </div>
    </div>
  );
}
