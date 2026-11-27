import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import { buildRoutesForSide, buildWardSpotsForSide } from '../data/jungleKnowledgePack';
import { selectLiveActiveRoute } from '../domain/jungleRoutingEngine';
import { computeSmiteProgression, formatClock } from '../domain/liveCoachEngine';
import { getItemIconUrl } from '../services/ddragonService';
import type {
  AdaptiveBuildPlan,
  DemoScenarioId,
  MacroCue,
  ObjectiveWindow,
  WinConditionPlan,
} from '../types/coaching';
import type { GamePhase, LiveGameData, MapSide } from '../types/riot';
import { EmptyState } from './EmptyState';
import { GlassSurface } from './GlassSurface';
import { SummonersRiftMap } from './SummonersRiftMap';

interface LiveCoachViewProps {
  phase?: GamePhase;
  liveData: LiveGameData | null;
  objectives: ObjectiveWindow[];
  buildPlan: AdaptiveBuildPlan | null;
  macroCues: MacroCue[];
  winPlan: WinConditionPlan | null;
  mapSide: MapSide | null;
  patchVersion: string;
  onPreviewSample?: (scenario: DemoScenarioId) => void;
}

export function LiveCoachView({
  phase = 'idle',
  liveData,
  objectives,
  buildPlan,
  macroCues,
  winPlan,
  mapSide,
  patchVersion,
  onPreviewSample,
}: LiveCoachViewProps) {
  const effectiveSide: MapSide = mapSide ?? 'blue';
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

  if (!liveData || !buildPlan) {
    return (
      <EmptyState
        icon={Activity}
        title={phase === 'loading' ? 'Match loading · coach starts at 0:00' : 'Live In-Game Coach'}
        description={
          phase === 'loading'
            ? 'Your match is loading. Objective timers, Smite charge cadence, and adaptive itemization activate automatically at 0:00.'
            : 'Connects automatically via Riot Live Client Data (127.0.0.1:2999) when your match begins — zero setup needed.'
        }
        onPreviewSample={onPreviewSample ? () => onPreviewSample('in_game_mid') : undefined}
        sampleLabel="Preview live match"
      />
    );
  }

  const gold = Math.floor(liveData.activePlayer.currentGold);
  const smiteStatus = computeSmiteProgression(liveData);

  return (
    <div className="space-y-6">
      {/* Telemetry & Objective Cadence */}
      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <GlassSurface className="flex flex-col justify-between p-4">
          <div>
            <div className="t-caption font-medium text-white/[0.55]">Match clock &amp; gold</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="t-display text-white">
                {formatClock(liveData.gameData.gameTime)}
              </span>
              <span className="tabular-nums text-sm font-semibold text-amber-300">
                {gold}g
              </span>
            </div>

            <div className="lg-inset mt-3 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`t-caption font-semibold tabular-nums ${
                    smiteStatus.damage === 1200
                      ? 'text-emerald-300'
                      : smiteStatus.damage === 900
                        ? 'text-sky-300'
                        : 'text-white/[0.85]'
                  }`}
                >
                  {smiteStatus.damage} Smite · {smiteStatus.tierName}
                </span>
                {smiteStatus.estimatedStacksRemaining > 0 && (
                  <span className="tabular-nums text-[11px] text-white/[0.55]">
                    ~{smiteStatus.estimatedStacksRemaining} left
                  </span>
                )}
              </div>
              <p className="t-caption mt-1 text-white/[0.62]">{smiteStatus.note}</p>
            </div>
          </div>

          <div className="t-caption mt-3 border-t border-white/[0.08] pt-2.5 text-white/[0.55]">
            Level {liveData.activePlayer.level} ·{' '}
            {liveData.gameData.gameTime < 840
              ? 'Early clear & skirmish'
              : liveData.gameData.gameTime < 1500
                ? 'Mid-game objective control'
                : 'Late-game Baron / Elder'}
          </div>
        </GlassSurface>

        <GlassSurface className="p-4">
          <div className="t-caption mb-3 font-medium text-white/[0.55]">
            Objective windows &amp; vision prep
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
                  <span className="font-semibold text-white/[0.92]">{obj.name}</span>
                  <span
                    className={`tabular-nums font-bold ${
                      obj.status === 'live'
                        ? 'text-emerald-300'
                        : obj.status === 'prep_vision'
                          ? 'text-amber-300'
                          : 'text-white/[0.72]'
                    }`}
                  >
                    {obj.status === 'live'
                      ? 'LIVE NOW'
                      : `in ${formatClock(obj.secondsRemaining)}`}
                  </span>
                </div>
                <p className="t-caption mt-1 text-white/[0.62]">{obj.actionText}</p>
              </div>
            ))}
          </div>
        </GlassSurface>
      </div>

      {/* Live Auto-Updating Jungle Route & Ward Map */}
      <SummonersRiftMap
        mapSide={effectiveSide}
        patchVersion={patchVersion}
        route={activeRoute}
        wardSpots={wardSpots}
        compact
      />

      {/* Adaptive Itemization & Macro Cues */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <GlassSurface className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="t-title text-white/[0.92]">Adaptive Item Build</h3>
            {buildPlan.isFullBuild && (
              <span className="t-caption rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 font-semibold text-white">
                Full build active
              </span>
            )}
          </div>

          <ul className="t-caption mb-3 space-y-1 text-white/[0.78]">
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
                    className="h-10 w-10 rounded-[7px] border border-white/15 bg-black"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                  <div>
                    <div className="text-[13px] font-semibold text-white/[0.92]">
                      Next priority: {buildPlan.nextItem.item.name}
                    </div>
                    <div className="t-caption mt-0.5 text-white/[0.62]">
                      {buildPlan.nextItem.reason}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`tabular-nums t-caption font-bold ${
                      buildPlan.nextItem.affordableNow ? 'text-emerald-300' : 'text-amber-200'
                    }`}
                  >
                    {buildPlan.nextItem.affordableNow
                      ? 'AFFORDABLE NOW'
                      : `Need ${buildPlan.nextItem.goldNeeded}g`}
                  </div>
                  <div className="tabular-nums text-[11px] text-white/[0.45]">
                    Total {buildPlan.nextItem.item.cost}g
                  </div>
                </div>
              </div>

              {!buildPlan.nextItem.affordableNow &&
                buildPlan.nextItem.affordableComponents.length > 0 && (
                  <div className="t-caption mt-2.5 border-t border-white/[0.07] pt-2 text-white/[0.72]">
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
                  className="flex items-center justify-between py-2 t-caption"
                >
                  <div>
                    <span className="font-medium text-white/[0.92]">{rec.item.name}</span>
                    <span className="ml-2 text-white/[0.55]">{rec.reason}</span>
                  </div>
                  <span className="tabular-nums text-white/[0.55]">
                    {rec.item.cost}g
                  </span>
                </div>
              ))}
            </div>
          )}

          {buildPlan.fullBuildAlternatives.length > 0 && (
            <div className="lg-inset mt-3 p-3">
              <div className="t-caption font-semibold text-white/[0.92]">
                Full-build replacement alternatives
              </div>
              <div className="t-caption mt-1.5 space-y-1.5">
                {buildPlan.fullBuildAlternatives.map((alt) => (
                  <div key={alt.recommendedItem.id} className="text-white/[0.75]">
                    <span className="font-semibold text-white">
                      Swap {alt.replaceTarget} → {alt.recommendedItem.name}
                    </span>
                    <span className="block text-white/[0.55]">{alt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassSurface>

        <div className="space-y-4">
          <GlassSurface className="p-4">
            <div className="t-caption mb-2.5 font-medium text-white/[0.55]">
              Trinket &amp; consumables
            </div>
            <div className="lg-inset p-2.5 t-caption">
              <div className="font-semibold text-white/[0.92]">
                Trinket: {buildPlan.trinketAdvice.item.name}
              </div>
              <p className="mt-0.5 text-white/[0.62]">
                {buildPlan.trinketAdvice.reason}
              </p>
            </div>
            <div className="mt-2 divide-y divide-white/[0.06]">
              {buildPlan.consumableAdvice.map((cons) => (
                <div key={cons.item.id} className="t-caption py-2">
                  <div className="font-medium text-white/[0.92]">
                    {cons.item.name} ({cons.item.cost}g)
                  </div>
                  <div className="text-white/[0.55]">{cons.reason}</div>
                </div>
              ))}
            </div>
          </GlassSurface>

          <GlassSurface className="p-4">
            <div className="t-caption mb-2.5 font-medium text-white/[0.55]">
              Macro action cues
            </div>
            <div className="space-y-2">
              {macroCues.map((cue) => (
                <div
                  key={cue.id}
                  className={`lg-inset p-2.5 t-caption ${
                    cue.priority === 'urgent' ? 'border-amber-400/35' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white/[0.92]">{cue.title}</span>
                    <span className="capitalize text-[11px] text-white/[0.55]">
                      {cue.category}
                    </span>
                  </div>
                  <p className="mt-0.5 text-white/[0.62]">{cue.detail}</p>
                </div>
              ))}
            </div>
          </GlassSurface>
        </div>
      </div>
    </div>
  );
}
