import { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type {
  JungleRoute,
  NormalizedMapPoint,
  TimelineMapMarker,
  WardSpot,
} from '../types/coaching';
import type { MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { OfficialRiftMapBase } from './OfficialRiftMapBase';
import {
  RIFT_PALETTE,
  TIMELINE_MARKER_COLORS,
  WARD_KIND_STYLE,
  toMapPercent,
} from './mapTokens';

interface RouteModeProps {
  mode: 'route';
  mapSide: MapSide;
  patchVersion: string;
  route: JungleRoute;
  wardSpots: WardSpot[];
  compact?: boolean;
}

interface ReplayModeProps {
  mode: 'replay';
  patchVersion: string;
  durationSeconds: number;
  activeMinute: number;
  onChangeMinute: (minute: number) => void;
  pathPoints: NormalizedMapPoint[];
  enemyPathPoints?: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
}

export type RiftMapProps = RouteModeProps | ReplayModeProps;

export function RiftMap(props: RiftMapProps) {
  if (props.mode === 'route') {
    return <RouteRiftMap key={props.route.id} {...props} />;
  }
  const replayKey = `${props.durationSeconds}-${props.markers.length}-${props.markers[0]?.timestampSec ?? 0}`;
  return <ReplayRiftMap key={replayKey} {...props} />;
}

function RouteRiftMap({
  mapSide,
  patchVersion,
  route,
  wardSpots,
  compact = false,
}: RouteModeProps) {
  const arrowMarkerId = useId();
  const [showWards, setShowWards] = useState(true);
  const [selectedWardId, setSelectedWardId] = useState<string | null>(
    wardSpots[0]?.id ?? null
  );
  const [selectedStepOrder, setSelectedStepOrder] = useState<number | null>(null);

  const polylinePoints = route.steps.map((s) => `${s.x},${s.y}`).join(' ');
  const activeStep =
    route.steps.find((s) => s.order === selectedStepOrder) ?? null;
  const selectedWard =
    wardSpots.find((w) => w.id === selectedWardId) ?? wardSpots[0] ?? null;

  return (
    <GlassSurface className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-white">
              Summoner&apos;s Rift Route &amp; Vision ({mapSide.toUpperCase()} Side)
            </h3>
            <span className="rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
              {route.stageLabel} · {route.timeWindow}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{route.whyThisClear}</p>
        </div>
      </div>

      <div
        className={`grid gap-5 ${
          compact
            ? 'md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(440px,520px)_minmax(0,1fr)]'
        }`}
      >
        {/* Hero Interactive Map Frame */}
        <div
          className={`relative mx-auto aspect-square w-full min-w-0 overflow-hidden rounded-[16px] border border-white/10 bg-[#080b11] shadow-inner ${
            compact ? 'max-w-[340px] md:max-w-none' : 'max-w-[420px] lg:max-w-none'
          }`}
        >
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Summoner's Rift Jungle Route and Ward Map"
            className="h-full w-full"
          >
            <defs>
              <marker
                id={arrowMarkerId}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L7,3 z" fill={RIFT_PALETTE.routeStroke} />
              </marker>
            </defs>

            <OfficialRiftMapBase patchVersion={patchVersion} />

            {/* Halo & animated route stroke */}
            <polyline
              points={polylinePoints}
              fill="none"
              stroke={RIFT_PALETTE.routeHalo}
              strokeWidth="8"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={polylinePoints}
              fill="none"
              stroke={RIFT_PALETTE.routeStroke}
              strokeWidth="3.2"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="10 8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lg-route-flow"
              markerEnd={`url(#${arrowMarkerId})`}
            />
          </svg>

          {/* Accessible 40px Ward Targets */}
          {showWards &&
            wardSpots.map((ward) => {
              const style = WARD_KIND_STYLE[ward.kind];
              const isSelected = selectedWard?.id === ward.id;
              return (
                <button
                  key={ward.id}
                  type="button"
                  aria-label={`Ward spot: ${ward.label} (${ward.timing})`}
                  onClick={() => setSelectedWardId(ward.id)}
                  style={{
                    left: `${toMapPercent(ward.x)}%`,
                    top: `${toMapPercent(ward.y)}%`,
                  }}
                  className="group absolute z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <span
                    style={{
                      borderColor: style.color,
                      backgroundColor: isSelected ? style.bg : 'rgba(9,12,20,0.82)',
                    }}
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition motion-reduce:transition-none ${
                      isSelected ? 'scale-115 shadow-lg' : 'group-hover:scale-110'
                    }`}
                  >
                    <span
                      style={{ backgroundColor: style.color }}
                      className="h-2 w-2 rounded-full"
                    />
                  </span>
                </button>
              );
            })}

          {/* Accessible 40px Camp Waypoints (rendered above wards so camp steps stay clickable) */}
          {route.steps.map((step) => {
            const isSelected = selectedStepOrder === step.order;
            return (
              <button
                key={`${route.id}-${step.order}`}
                type="button"
                aria-label={`Step ${step.order}: ${step.campName} at ${step.targetTime}`}
                onClick={() => {
                  setSelectedStepOrder((prev) =>
                    prev === step.order ? null : step.order
                  );
                }}
                style={{
                  left: `${toMapPercent(step.x)}%`,
                  top: `${toMapPercent(step.y)}%`,
                }}
                className="group absolute z-20 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <span
                  className={`tabular-nums flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold transition motion-reduce:transition-none ${
                    isSelected
                      ? 'scale-110 border-white bg-white text-slate-950 shadow-[0_0_16px_rgba(255,255,255,0.45)]'
                      : 'border-white/85 bg-[#090c14]/90 text-white group-hover:scale-105'
                  }`}
                >
                  {step.order}
                </span>
              </button>
            );
          })}

          {/* Floating Liquid Glass Map Control Pill */}
          <div className="mat-glass mat-lens absolute top-3 right-3 z-30 flex items-center gap-1.5 !rounded-full px-2.5 py-1">
            <button
              type="button"
              aria-pressed={showWards}
              onClick={() => setShowWards((v) => !v)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition motion-reduce:transition-none ${
                showWards ? 'bg-white/16 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              {showWards ? 'Wards Visible' : 'Show Wards'}
            </button>
          </div>

          {activeStep && (
            <div className="mat-glass mat-lens absolute top-3 left-3 z-30 max-w-[70%] px-3 py-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  {activeStep.order}. {activeStep.campName}
                </span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-mono text-[10px] text-emerald-300">
                    {activeStep.targetTime}
                  </span>
                  <button
                    type="button"
                    aria-label="Close step detail"
                    onClick={() => setSelectedStepOrder(null)}
                    className="rounded p-0.5 text-slate-400 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p className="mt-0.5 text-slate-300">{activeStep.note}</p>
            </div>
          )}
        </div>

        {/* Route Sequence & Selected Ward Detail */}
        <div className="flex min-w-0 flex-col justify-between gap-3 text-xs">
          <div>
            <div className="text-xs font-semibold text-white">{route.label}</div>
            <p className="mt-1 text-[11px] text-slate-400">{route.summary}</p>
            <ol className="mt-3 divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
              {route.steps.map((step) => {
                const isSelected = selectedStepOrder === step.order;
                return (
                  <li key={step.order}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStepOrder((prev) =>
                          prev === step.order ? null : step.order
                        )
                      }
                      className={`flex w-full items-start justify-between gap-3 px-1.5 py-2 text-left text-[11px] transition motion-reduce:transition-none ${
                        isSelected ? 'bg-white/[0.06] text-white' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="tabular-nums mr-2 font-semibold text-slate-400">
                          {step.order}.
                        </span>
                        <span className="font-semibold text-white">{step.campName}</span>
                        <span className="ml-2 text-slate-400">{step.note}</span>
                      </div>
                      <span className="tabular-nums shrink-0 font-mono text-[10px] text-slate-300">
                        {step.targetTime}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {showWards && selectedWard && (
            <div className="lg-inset p-3.5 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">{selectedWard.label}</span>
                <span className="t-micro text-slate-400">
                  {WARD_KIND_STYLE[selectedWard.kind].label} · {selectedWard.timing}
                </span>
              </div>
              <p className="mt-1 text-slate-300">{selectedWard.reason}</p>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}

function ReplayRiftMap({
  patchVersion,
  durationSeconds,
  activeMinute,
  onChangeMinute,
  pathPoints,
  enemyPathPoints = [],
  markers,
}: ReplayModeProps) {
  const maxMinute = Math.max(1, Math.ceil(durationSeconds / 60));
  const [showPath, setShowPath] = useState(true);
  const [showEnemyGhost, setShowEnemyGhost] = useState(false);
  const [showCombat, setShowCombat] = useState(true);
  const [showWards, setShowWards] = useState(true);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(
    (markers.find((m) => m.kind === 'pre_obj_death') ?? markers[0])?.id ?? null
  );

  const effectiveCutoff = Math.min(Math.max(1, activeMinute), maxMinute);

  const visiblePath = useMemo(
    () => pathPoints.filter((p) => p.minute <= effectiveCutoff),
    [pathPoints, effectiveCutoff]
  );

  const visibleEnemyPath = useMemo(
    () => enemyPathPoints.filter((p) => p.minute <= effectiveCutoff),
    [enemyPathPoints, effectiveCutoff]
  );

  const visibleMarkers = useMemo(
    () =>
      markers.filter((m) => {
        if (m.minute > effectiveCutoff) return false;
        if (!showWards && (m.kind === 'ward' || m.kind === 'control_ward')) {
          return false;
        }
        if (
          !showCombat &&
          (m.kind === 'kill' ||
            m.kind === 'death' ||
            m.kind === 'pre_obj_death' ||
            m.kind === 'assist')
        ) {
          return false;
        }
        return true;
      }),
    [markers, effectiveCutoff, showWards, showCombat]
  );

  const selectedMarker =
    visibleMarkers.find((m) => m.id === selectedMarkerId) ??
    visibleMarkers[visibleMarkers.length - 1] ??
    null;

  const polylinePoints = visiblePath.map((p) => `${p.x},${p.y}`).join(' ');
  const enemyPolylinePoints = visibleEnemyPath.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <GlassSurface className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white">
          Jungle Path &amp; Timeline Replay (0m – {effectiveCutoff}m)
        </h3>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            aria-pressed={showPath}
            onClick={() => setShowPath((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition motion-reduce:transition-none ${
              showPath
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Path Trail
          </button>
          {enemyPathPoints.length > 0 && (
            <button
              type="button"
              aria-pressed={showEnemyGhost}
              onClick={() => setShowEnemyGhost((v) => !v)}
              className={`rounded-full border px-2.5 py-0.5 font-medium transition motion-reduce:transition-none ${
                showEnemyGhost
                  ? 'border-rose-400/35 bg-rose-400/15 text-rose-200'
                  : 'border-white/10 bg-white/[0.04] text-slate-400'
              }`}
            >
              Enemy Jungler Ghost
            </button>
          )}
          <button
            type="button"
            aria-pressed={showCombat}
            onClick={() => setShowCombat((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition motion-reduce:transition-none ${
              showCombat
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Kills/Deaths
          </button>
          <button
            type="button"
            aria-pressed={showWards}
            onClick={() => setShowWards((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition motion-reduce:transition-none ${
              showWards
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Wards
          </button>
        </div>
      </div>

      {/* Synchronized Timeline Scrubber */}
      <div className="lg-inset mb-4 flex items-center gap-3 px-3 py-2 text-xs">
        <span className="text-[11px] text-slate-400">Timeline Minute</span>
        <input
          type="range"
          aria-label="Timeline minute cutoff"
          min={1}
          max={maxMinute}
          value={effectiveCutoff}
          onChange={(e) => onChangeMinute(Number(e.target.value))}
          className="flex-1 accent-white"
        />
        <span className="tabular-nums font-mono text-xs font-semibold text-white">
          {effectiveCutoff}m / {maxMinute}m
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(440px,520px)_minmax(0,1fr)]">
        <div className="relative mx-auto aspect-square w-full max-w-[420px] min-w-0 overflow-hidden rounded-[16px] border border-white/10 bg-[#080b11] lg:max-w-none">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Post-Game Jungle Timeline Map"
            className="h-full w-full"
          >
            <OfficialRiftMapBase patchVersion={patchVersion} />

            {showEnemyGhost && visibleEnemyPath.length > 1 && (
              <polyline
                points={enemyPolylinePoints}
                fill="none"
                stroke={RIFT_PALETTE.enemyGhostStroke}
                strokeOpacity="0.6"
                strokeWidth="2.4"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="6 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {showPath && visiblePath.length > 1 && (
              <>
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke={RIFT_PALETTE.routeHalo}
                  strokeWidth="7"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke={RIFT_PALETTE.routeStroke}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="9 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            )}
          </svg>

          {/* Accessible 40px Marker Targets */}
          {visibleMarkers.map((marker) => {
            const color = TIMELINE_MARKER_COLORS[marker.kind];
            const isSelected = selectedMarker?.id === marker.id;
            return (
              <button
                key={marker.id}
                type="button"
                aria-label={marker.label}
                onClick={() => {
                  setSelectedMarkerId(marker.id);
                  onChangeMinute(Math.max(1, marker.minute));
                }}
                style={{
                  left: `${toMapPercent(marker.x)}%`,
                  top: `${toMapPercent(marker.y)}%`,
                }}
                className="group absolute z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <span
                  style={{
                    borderColor: color,
                    backgroundColor: 'rgba(9,12,20,0.88)',
                  }}
                  className={`flex h-4 w-4 items-center justify-center rounded-full border-2 transition motion-reduce:transition-none ${
                    marker.kind === 'pre_obj_death'
                      ? 'ring-2 ring-rose-500/70 ring-offset-1 ring-offset-transparent'
                      : ''
                  } ${isSelected ? 'scale-125' : 'group-hover:scale-110'}`}
                >
                  <span
                    style={{ backgroundColor: color }}
                    className="h-1.5 w-1.5 rounded-full"
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-3 text-xs">
          <div className="lg-inset p-3.5">
            <div className="t-micro text-slate-400">Selected Timeline Event</div>
            {selectedMarker ? (
              <div className="mt-1.5">
                <div className="font-semibold text-white">{selectedMarker.label}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                  {selectedMarker.detail}
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                No events up to {effectiveCutoff}m — scrub forward to inspect later plays.
              </p>
            )}
          </div>

          <div className="hud-scroll max-h-[340px] divide-y divide-white/[0.06] overflow-y-auto border-t border-b border-white/[0.06]">
            {visibleMarkers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedMarkerId(m.id);
                  onChangeMinute(Math.max(1, m.minute));
                }}
                className={`flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-[11px] transition motion-reduce:transition-none ${
                  selectedMarker?.id === m.id
                    ? 'bg-white/[0.07] text-white'
                    : 'text-slate-300 hover:bg-white/[0.03]'
                }`}
              >
                <span className="min-w-0 truncate">{m.label}</span>
                <span className="tabular-nums shrink-0 font-mono text-[10px] text-slate-400">
                  {m.minute}m
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Kill
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> Pre-Obj Death
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-pink-400" /> Control Ward
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> Objective
            </span>
          </div>
        </div>
      </div>
    </GlassSurface>
  );
}
