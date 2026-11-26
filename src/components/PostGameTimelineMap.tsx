import { useMemo, useState } from 'react';
import { Clock, Eye, MapPin, Skull, Swords } from 'lucide-react';
import type { NormalizedMapPoint, TimelineMapMarker } from '../types/coaching';

interface PostGameTimelineMapProps {
  durationSeconds: number;
  pathPoints: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
}

export function PostGameTimelineMap({
  durationSeconds,
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
          (m.kind === 'kill' || m.kind === 'death' || m.kind === 'pre_obj_death' || m.kind === 'assist')
        ) {
          return false;
        }
        return true;
      }),
    [markers, effectiveCutoff, showWards, showCombat]
  );

  const polylinePoints = visiblePath.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="hud-card rounded-xl p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <MapPin className="h-4 w-4 text-cyan-400" />
          <span>Match-V5 Timeline Replay Map (0m – {effectiveCutoff}m)</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setShowPath((v) => !v)}
            className={`rounded border px-2 py-0.5 font-medium ${
              showPath
                ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            Path Trail
          </button>
          <button
            type="button"
            onClick={() => setShowCombat((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${
              showCombat
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            <Skull className="h-3 w-3" />
            Kills/Deaths
          </button>
          <button
            type="button"
            onClick={() => setShowWards((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${
              showWards
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            <Eye className="h-3 w-3" />
            Wards
          </button>
        </div>
      </div>

      {/* Minute Scrubber */}
      <div className="mb-3 flex items-center gap-3 rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs">
        <Clock className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-[11px] text-slate-400">Timeline Minute:</span>
        <input
          type="range"
          aria-label="Timeline minute cutoff"
          min={1}
          max={maxMinute}
          value={effectiveCutoff}
          onChange={(e) => setMinuteCutoff(Number(e.target.value))}
          className="flex-1 accent-cyan-400"
        />
        <span className="tabular-nums font-mono text-xs font-bold text-cyan-300">
          {effectiveCutoff}m / {maxMinute}m
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(250px,310px)_1fr]">
        <svg
          viewBox="0 0 1000 1000"
          role="img"
          aria-label="Post-Game Match-V5 Timeline Map"
          className="aspect-square w-full rounded-lg border border-slate-700/80 bg-[#0b1320]"
        >
          {/* Lanes & River */}
          <path
            d="M 115 885 L 115 125 L 885 125"
            fill="none"
            stroke="#1e293b"
            strokeWidth="20"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 115 885 L 885 885 L 885 125"
            fill="none"
            stroke="#1e293b"
            strokeWidth="20"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="120" y1="880" x2="880" y2="120" stroke="#1e293b" strokeWidth="20" strokeLinecap="round" />
          <path
            d="M 160 175 Q 500 500 840 825"
            fill="none"
            stroke="#0f3452"
            strokeWidth="50"
            strokeLinecap="round"
            opacity="0.65"
          />
          <circle cx="325" cy="300" r="30" fill="#1e1b4b" stroke="#818cf8" strokeWidth="3" />
          <circle cx="680" cy="705" r="30" fill="#3b1d1a" stroke="#fb923c" strokeWidth="3" />

          {/* Path Trail */}
          {showPath && visiblePath.length > 1 && (
            <>
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="5"
                strokeOpacity="0.65"
                strokeDasharray="10 7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {visiblePath.map((pt) => (
                <circle
                  key={`pt-${pt.minute}`}
                  cx={pt.x}
                  cy={pt.y}
                  r="9"
                  fill="#0ea5e9"
                  fillOpacity="0.55"
                />
              ))}
            </>
          )}

          {/* Event Markers */}
          {visibleMarkers.map((marker) => {
            const color =
              marker.kind === 'kill'
                ? '#10b981'
                : marker.kind === 'pre_obj_death'
                  ? '#ef4444'
                  : marker.kind === 'death'
                    ? '#fb7185'
                    : marker.kind === 'control_ward'
                      ? '#ec4899'
                      : marker.kind === 'ward'
                        ? '#f59e0b'
                        : marker.kind === 'objective'
                          ? '#22d3ee'
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
                    strokeWidth="4"
                    strokeDasharray="6 4"
                  />
                )}
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r={isSelected ? 21 : 15}
                  fill={color}
                  fillOpacity="0.3"
                  stroke={color}
                  strokeWidth={isSelected ? 5 : 3}
                />
                <circle cx={marker.x} cy={marker.y} r="6" fill={color} />
              </g>
            );
          })}
        </svg>

        {/* Legend & Event List */}
        <div className="flex flex-col justify-between gap-2 text-xs">
          <div>
            <div className="mb-1.5 flex flex-wrap gap-2 text-[10px] text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Kill
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> Death
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-red-300">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-red-400/50" />{' '}
                Pre-Obj Death
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-pink-500" /> Control Ward
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Objective
              </span>
            </div>

            <div className="hud-scroll max-h-[210px] space-y-1 overflow-y-auto pr-1">
              {visibleMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  onClick={() => setSelectedMarker(marker)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] transition ${
                    selectedMarker?.id === marker.id
                      ? 'border border-cyan-400/60 bg-cyan-500/15 text-cyan-100'
                      : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate font-medium">{marker.label}</span>
                  <span className="ml-2 shrink-0 text-[10px] uppercase text-slate-400">
                    {marker.kind.replace('_', ' ')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedMarker && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/90 p-2.5 text-[11px]">
              <div className="flex items-center gap-1.5 font-semibold text-cyan-200">
                <Swords className="h-3.5 w-3.5" />
                {selectedMarker.label}
              </div>
              <p className="mt-1 text-slate-300">{selectedMarker.detail}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
