import { useMemo } from 'react';
import { selectLiveActiveRoute } from '../domain/jungleRoutingEngine';
import { formatClock } from '../domain/liveCoachEngine';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  MacroCue,
  ObjectiveWindow,
  WinConditionPlan,
} from '../types/coaching';
import type { LiveGameData, MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { SummonersRiftMap } from './SummonersRiftMap';

interface LiveCoachViewProps {
  liveData: LiveGameData | null;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  winPlan: WinConditionPlan;
  mapSide: MapSide;
  patchVersion: string;
}

export function LiveCoachView({
  liveData,
  objectives,
  buildPlan,
  macroCues,
  winPlan,
  mapSide,
  patchVersion,
}: LiveCoachViewProps) {
  const activeRoute = useMemo(() => {
    const time = liveData?.gameData.gameTime ?? 0;
    return selectLiveActiveRoute(time, objectives, winPlan.routes);
  }, [liveData, objectives, winPlan.routes]);

  if (!liveData || !buildPlan) {
    return (
      <GlassSurface className="p-8 text-center">
        <h2 className="text-sm font-semibold text-white">Live In-Game Coach</h2>
        <p className="mt-1.5 text-xs text-slate-400">
          Connects automatically to League&apos;s Live Client Data API (127.0.0.1:2999) when a
          match begins, or select an In-Game Demo scenario in the header.
        </p>
      </GlassSurface>
    );
  }

  const gold = Math.floor(liveData.activePlayer.currentGold);

  return (
    <div className="space-y-4">
      {/* Telemetry & Objective Cadence */}
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <GlassSurface className="flex flex-col justify-between p-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Live Telemetry
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="tabular-nums text-3xl font-bold tracking-tight text-white">
                {formatClock(liveData.gameData.gameTime)}
              </span>
              <span className="tabular-nums text-sm font-semibold text-amber-300">
                {gold}g
              </span>
            </div>
          </div>
          <div className="mt-3 border-t border-white/[0.08] pt-2.5 text-[11px] text-slate-400">
            Level {liveData.activePlayer.level} ·{' '}
            {liveData.gameData.gameTime < 840
              ? 'Early Clear & Skirmish'
              : liveData.gameData.gameTime < 1500
                ? 'Mid-Game Objective Control'
                : 'Late-Game Baron / Elder'}
          </div>
        </GlassSurface>

        <GlassSurface className="p-4">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
            Objective Windows &amp; Vision Prep
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {objectives.map((obj) => (
              <div
                key={obj.id}
                className={`lg-inset p-3 text-xs ${
                  obj.status === 'live'
                    ? 'border-emerald-400/35 bg-emerald-400/[0.07]'
                    : obj.status === 'prep_vision'
                      ? 'border-amber-400/35 bg-amber-400/[0.07]'
                      : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">{obj.name}</span>
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
                <p className="mt-1 text-[11px] text-slate-400">{obj.actionText}</p>
              </div>
            ))}
          </div>
        </GlassSurface>
      </div>

      {/* Live Auto-Updating Jungle Route & Ward Map on Official map11.png */}
      <SummonersRiftMap
        mapSide={mapSide}
        patchVersion={patchVersion}
        route={activeRoute}
        wardSpots={winPlan.wardSpots}
      />

      {/* Adaptive Itemization & Macro Cues */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <GlassSurface className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-white">Adaptive Item Build</h3>
            {buildPlan.isFullBuild && (
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-white">
                FULL BUILD OPTIMIZER ACTIVE
              </span>
            )}
          </div>

          <ul className="mb-3 space-y-1 text-[11px] text-slate-300">
            {buildPlan.threats.reasons.map((reason) => (
              <li key={reason}>· {reason}</li>
            ))}
          </ul>

          {buildPlan.nextItem && (
            <div className="lg-inset p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={getItemIconUrl(buildPlan.nextItem.item.id, patchVersion)}
                    alt={buildPlan.nextItem.item.name}
                    className="h-10 w-10 rounded-[10px] border border-white/15 bg-black"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div>
                    <div className="text-xs font-semibold text-white">
                      Next Priority: {buildPlan.nextItem.item.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
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
                  <div className="tabular-nums text-[10px] text-slate-500">
                    Total {buildPlan.nextItem.item.cost}g
                  </div>
                </div>
              </div>

              {!buildPlan.nextItem.affordableNow &&
                buildPlan.nextItem.affordableComponents.length > 0 && (
                  <div className="mt-2.5 border-t border-white/[0.07] pt-2 text-[11px] text-slate-300">
                    Buy components now:{' '}
                    <span className="font-semibold text-white">
                      {buildPlan.nextItem.affordableComponents
                        .map((c) => `${c.name} (${c.cost}g)`)
                        .join(', ')}
                    </span>
                  </div>
                )}
            </div>
          )}

          {buildPlan.upcomingQueue.length > 0 && (
            <div className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {buildPlan.upcomingQueue.map((rec) => (
                <div
                  key={rec.item.id}
                  className="flex items-center justify-between py-2 text-xs"
                >
                  <div>
                    <span className="font-medium text-white">{rec.item.name}</span>
                    <span className="ml-2 text-[11px] text-slate-400">{rec.reason}</span>
                  </div>
                  <span className="tabular-nums text-[11px] text-slate-400">
                    {rec.item.cost}g
                  </span>
                </div>
              ))}
            </div>
          )}

          {buildPlan.fullBuildAlternatives.length > 0 && (
            <div className="lg-inset mt-3 p-3">
              <div className="text-[11px] font-semibold text-white">
                Full-Build Replacement Alternatives
              </div>
              <div className="mt-1.5 space-y-1.5">
                {buildPlan.fullBuildAlternatives.map((alt) => (
                  <div key={alt.recommendedItem.id} className="text-[11px] text-slate-300">
                    <span className="font-semibold text-white">
                      Swap {alt.replaceTarget} → {alt.recommendedItem.name}
                    </span>
                    <span className="block text-slate-400">{alt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassSurface>

        <div className="space-y-4">
          <GlassSurface className="p-4">
            <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Trinket &amp; Consumables
            </div>
            <div className="lg-inset p-2.5 text-xs">
              <div className="font-semibold text-white">
                Trinket: {buildPlan.trinketAdvice.item.name}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {buildPlan.trinketAdvice.reason}
              </p>
            </div>
            <div className="mt-2 divide-y divide-white/[0.06]">
              {buildPlan.consumableAdvice.map((cons) => (
                <div key={cons.item.id} className="py-2 text-[11px]">
                  <div className="font-medium text-white">
                    {cons.item.name} ({cons.item.cost}g)
                  </div>
                  <div className="text-slate-400">{cons.reason}</div>
                </div>
              ))}
            </div>
          </GlassSurface>

          <GlassSurface className="p-4">
            <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
              Macro Action Cues
            </div>
            <div className="space-y-2">
              {macroCues.map((cue) => (
                <div
                  key={cue.id}
                  className={`lg-inset p-2.5 text-[11px] ${
                    cue.priority === 'urgent' ? 'border-amber-400/35' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{cue.title}</span>
                    <span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">
                      {cue.category}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-400">{cue.detail}</p>
                </div>
              ))}
            </div>
          </GlassSurface>
        </div>
      </div>
    </div>
  );
}
