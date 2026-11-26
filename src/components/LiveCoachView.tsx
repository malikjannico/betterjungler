import { AlertTriangle, Coins, Compass, Eye, Flame, ShieldCheck, ShoppingBag } from 'lucide-react';
import { formatClock } from '../domain/liveCoachEngine';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  MacroCue,
  ObjectiveWindow,
} from '../types/coaching';
import type { LiveGameData } from '../types/riot';

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
      <div className="hud-card rounded-xl p-6 text-center">
        <h2 className="text-sm font-bold text-slate-200">Live In-Game Coach</h2>
        <p className="mt-1 text-xs text-slate-400">
          Connects automatically to League&apos;s Live Client Data API (127.0.0.1:2999) when a
          match begins, or select an In-Game Demo scenario in the header.
        </p>
      </div>
    );
  }

  const gold = Math.floor(liveData.activePlayer.currentGold);

  return (
    <div className="space-y-3">
      {/* Match Clock & Objective Cadence */}
      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <div className="hud-card rounded-xl p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Live Telemetry
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="tabular-nums text-2xl font-extrabold text-cyan-300">
              {formatClock(liveData.gameData.gameTime)}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-300">
              <Coins className="h-3.5 w-3.5" />
              <span className="tabular-nums">{gold}g</span>
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-300">
            Level {liveData.activePlayer.level} •{' '}
            {liveData.gameData.gameTime < 840
              ? 'Early Clear & Skirmish Phase'
              : liveData.gameData.gameTime < 1500
                ? 'Mid-Game Objective Control'
                : 'Late-Game Baron / Elder'}
          </div>
        </div>

        <div className="hud-card rounded-xl p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <Flame className="h-4 w-4 text-amber-400" />
            Objective Windows &amp; Vision Prep
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {objectives.map((obj) => (
              <div
                key={obj.id}
                className={`rounded-lg border p-2 text-xs ${
                  obj.status === 'live'
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : obj.status === 'prep_vision'
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-700/70 bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100">{obj.name}</span>
                  <span
                    className={`tabular-nums text-xs font-bold ${
                      obj.status === 'live'
                        ? 'text-emerald-300'
                        : obj.status === 'prep_vision'
                          ? 'text-amber-300'
                          : 'text-slate-300'
                    }`}
                  >
                    {obj.status === 'live'
                      ? 'LIVE NOW'
                      : `in ${formatClock(obj.secondsRemaining)}`}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-300">{obj.actionText}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Adaptive Itemization + Trinket & Consumables */}
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <div className="hud-card rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
              <ShoppingBag className="h-4 w-4 text-cyan-400" />
              Adaptive Item Build
            </div>
            {buildPlan.isFullBuild && (
              <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-200">
                FULL BUILD OPTIMIZER ACTIVE
              </span>
            )}
          </div>

          {/* Live Threat Badges */}
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {buildPlan.threats.reasons.map((reason) => (
              <span
                key={reason}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] text-slate-200"
              >
                <AlertTriangle className="h-3 w-3 text-amber-400" />
                {reason}
              </span>
            ))}
          </div>

          {buildPlan.nextItem && (
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <img
                    src={getItemIconUrl(buildPlan.nextItem.item.id, patchVersion)}
                    alt={buildPlan.nextItem.item.name}
                    className="h-9 w-9 rounded border border-cyan-500/40 bg-slate-900"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div>
                    <div className="text-xs font-bold text-cyan-200">
                      Next Priority: {buildPlan.nextItem.item.name}
                    </div>
                    <div className="text-[11px] text-slate-200">
                      {buildPlan.nextItem.reason}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`tabular-nums text-xs font-bold ${
                      buildPlan.nextItem.affordableNow ? 'text-emerald-300' : 'text-amber-300'
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
                  <div className="mt-2 border-t border-cyan-500/20 pt-1.5 text-[11px] text-slate-300">
                    Buy components now:{' '}
                    <span className="font-semibold text-cyan-200">
                      {buildPlan.nextItem.affordableComponents
                        .map((c) => `${c.name} (${c.cost}g)`)
                        .join(', ')}
                    </span>
                  </div>
                )}
            </div>
          )}

          {buildPlan.upcomingQueue.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {buildPlan.upcomingQueue.map((rec) => (
                <div
                  key={rec.item.id}
                  className="flex items-center justify-between rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-200">{rec.item.name}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{rec.reason}</span>
                  </div>
                  <span className="tabular-nums text-[11px] text-slate-400">
                    {rec.item.cost}g
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Full Build Alternative Swaps */}
          {buildPlan.fullBuildAlternatives.length > 0 && (
            <div className="mt-3 rounded-lg border border-violet-500/40 bg-violet-500/10 p-2.5">
              <div className="text-[11px] font-bold text-violet-200">
                Full-Build Replacement Alternatives
              </div>
              <div className="mt-1.5 space-y-1.5">
                {buildPlan.fullBuildAlternatives.map((alt) => (
                  <div key={alt.recommendedItem.id} className="text-[11px] text-slate-200">
                    <span className="font-semibold text-violet-300">
                      Swap {alt.replaceTarget} → {alt.recommendedItem.name}
                    </span>
                    <span className="block text-slate-400">{alt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Trinket, Potions & Macro Cues */}
        <div className="space-y-3">
          <div className="hud-card rounded-xl p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-100">
              <Eye className="h-4 w-4 text-amber-400" />
              Trinket &amp; Consumables
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
              <div className="font-semibold text-amber-200">
                Trinket: {buildPlan.trinketAdvice.item.name}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-300">
                {buildPlan.trinketAdvice.reason}
              </p>
            </div>
            <div className="mt-2 space-y-1.5">
              {buildPlan.consumableAdvice.map((cons) => (
                <div
                  key={cons.item.id}
                  className="rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="font-semibold text-slate-200">
                    {cons.item.name} ({cons.item.cost}g)
                  </div>
                  <div className="text-slate-400">{cons.reason}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hud-card rounded-xl p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-100">
              <Compass className="h-4 w-4 text-cyan-400" />
              Macro Action Cues
            </div>
            <div className="space-y-1.5">
              {macroCues.map((cue) => (
                <div
                  key={cue.id}
                  className={`rounded-lg border p-2 text-[11px] ${
                    cue.priority === 'urgent'
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-700/70 bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">{cue.title}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase text-slate-300">
                      {cue.category}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-400">{cue.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-300/90">
              <ShieldCheck className="h-3.5 w-3.5" />
              100% Riot-compliant: no enemy cooldown tracking or hidden data.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
