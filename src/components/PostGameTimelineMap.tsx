import { useMemo, useState } from 'react';
import type { NormalizedMapPoint, TimelineMapMarker } from '../types/coaching';
import { GlassSurface } from './GlassSurface';
import { OfficialRiftMapBase } from './OfficialRiftMapBase';

interface PostGameTimelineMapProps {
  durationSeconds: number;
  patchVersion: string;
  pathPoints: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
}

export function PostGameTimelineMap({
  durationSeconds,
  patchVersion,
  pathPoints,
  markers,
}: PostGameTimelineMapProps) {
  const maxMinute = Math.max(1, Math.ceil(durationSeconds / 60));
  const [minuteCutoff, setMinuteCutoff] = useState<number>(maxMinute);
  const [showPath, setShowPath] = useState(true);
  const [showCombat, setShowCombat] = useState(true);
  const [showWards, setShowWards] = useState(true);
  const [selectedMarker, setSelectedMarker] = useState<TimelineMapMarker | null>(
    markers.find((m) => m.kind === 'pre_obj_death') ?? markers[0] ?? null
  );

  const effectiveCutoff = Math.min(minuteCutoff, maxMinute);

  const visiblePath = useMemo(
    () => pathPoints.filter((p) => p.minute <= effectiveCutoff),
    [pathPoints, effectiveCutoff]
  );

  const visibleMarkers = useMemo(
    () =>
      markers.filter((m) => {
        if (m.minute > effectiveCutoff) return false;
        if (!showWards && (m.kind === 'ward' || m.kind === 'control_ward')) return false;
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

  const polylinePoints = visiblePath.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <GlassSurface className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white">
          Match-V5 Timeline Replay Map (0m – {effectiveCutoff}m)
        </h3>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setShowPath((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition ${
              showPath
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Path Trail
          </button>
          <button
            type="button"
            onClick={() => setShowCombat((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition ${
              showCombat
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Kills/Deaths
          </button>
          <button
            type="button"
            onClick={() => setShowWards((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-medium transition ${
              showWards
                ? 'border-white/25 bg-white/12 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-400'
            }`}
          >
            Wards
          </button>
        </div>
      </div>

      {/* Minute Scrubber */}
      <div className="lg-inset mb-3.5 flex items-center gap-3 px-3 py-2 text-xs">
        <span className="text-[11px] text-slate-400">Timeline Minute</span>
        <input
          type="range"
          aria-label="Timeline minute cutoff"
          min={1}
          max={maxMinute}
          value={effectiveCutoff}
          onChange={(e) => setMinuteCutoff(Number(e.target.value))}
          className="flex-1 accent-white"
        />
        <span className="tabular-nums font-mono text-xs font-semibold text-white">
          {effectiveCutoff}m / {maxMinute}m
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="lg-inset p-2">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Post-Game Match-V5 Timeline Map"
            className="aspect-square w-full rounded-[10px]"
          >
            <OfficialRiftMapBase patchVersion={patchVersion} />

            {showPath && visiblePath.length > 1 && (
              <>
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="rgba(0,0,0,0.65)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="4"
                  strokeDasharray="10 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {visiblePath.map((pt) => (
                  <circle
                    key={`pt-${pt.minute}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="8"
                    fill="#ffffff"
                    fillOpacity="0.7"
                  />
                ))}
              </>
            )}

            {visibleMarkers.map((marker) => {
              const color =
                marker.kind === 'kill'
                  ? '#34d399'
                  : marker.kind === 'pre_obj_death'
                    ? '#ef4444'
                    : marker.kind === 'death'
                      ? '#fb7185'
                      : marker.kind === 'control_ward'
                        ? '#f472b6'
                        : marker.kind === 'ward'
                          ? '#fbbf24'
                          : marker.kind === 'objective'
                            ? '#38bdf8'
                            : '#a78bfa';

              const isSelected = selectedMarker?.id === marker.id;
              return (
                <g
                  key={marker.id}
                  onClick={() => setSelectedMarker(marker)}
                  className="cursor-pointer"
                >
                  {marker.kind === 'pre_obj_death' && (
                    <circle
                      cx={marker.x}
                      cy={marker.y}
                      r="28"
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="3.5"
                      strokeDasharray="6 4"
                    />
                  )}
                  <circle
                    cx={marker.x}
                    cy={marker.y}
                    r={isSelected ? 21 : 15}
                    fill="rgba(0,0,0,0.65)"
                    stroke={color}
                    strokeWidth={isSelected ? 4.5 : 3}
                  />
                  <circle cx={marker.x} cy={marker.y} r="6.5" fill={color} />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-col justify-between gap-2.5 text-xs">
          <div>
            <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Kill
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Death
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-300">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Pre-Obj Death
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-pink-400" /> Control Ward
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Objective
              </span>
            </div>

            <div className="hud-scroll max-h-[220px] divide-y divide-white/[0.06] overflow-y-auto pr-1">
              {visibleMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  onClick={() => setSelectedMarker(marker)}
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] transition ${
                    selectedMarker?.id === marker.id
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-300 hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="truncate font-medium">{marker.label}</span>
                  <span className="ml-2 shrink-0 text-[10px] uppercase text-slate-500">
                    {marker.kind.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedMarker && (
            <div className="lg-inset p-3 text-[11px]">
              <div className="font-semibold text-white">{selectedMarker.label}</div>
              <p className="mt-1 text-slate-300">{selectedMarker.detail}</p>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}
