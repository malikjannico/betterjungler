import { useMemo, useState } from 'react';
import { Clock, Eye, MapPin, Skull, Swords } from 'lucide-react';
import type { NormalizedMapPoint, TimelineMapMarker } from '../types/coaching';
import { GlassSurface } from './GlassSurface';

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
    <GlassSurface className="p-4">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
          <MapPin className="h-4 w-4 text-sky-300" />
          <span>Match-V5 Timeline Replay Map (0m – {effectiveCutoff}m)</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setShowPath((v) => !v)}
            className={`rounded-full border px-2.5 py-0.5 font-semibold transition ${
              showPath
                ? 'border-sky-300/40 bg-sky-400/15 text-sky-200'
                : 'border-white/10 bg-white/5 text-slate-400'
            }`}
          >
            Path Trail
          </button>
          <button
            type="button"
            onClick={() => setShowCombat((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold transition ${
              showCombat
                ? 'border-rose-300/40 bg-rose-400/15 text-rose-200'
                : 'border-white/10 bg-white/5 text-slate-400'
            }`}
          >
            <Skull className="h-3 w-3" />
            Kills/Deaths
          </button>
          <button
            type="button"
            onClick={() => setShowWards((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold transition ${
              showWards
                ? 'border-amber-300/40 bg-amber-400/15 text-amber-200'
                : 'border-white/10 bg-white/5 text-slate-400'
            }`}
          >
            <Eye className="h-3 w-3" />
            Wards
          </button>
        </div>
      </div>

      {/* Minute Scrubber */}
      <div className="lg-inset mb-3 flex items-center gap-3 px-3 py-2 text-xs">
        <Clock className="h-3.5 w-3.5 text-sky-300" />
        <span className="text-[11px] text-slate-400">Timeline Minute:</span>
        <input
          type="range"
          aria-label="Timeline minute cutoff"
          min={1}
          max={maxMinute}
          value={effectiveCutoff}
          onChange={(e) => setMinuteCutoff(Number(e.target.value))}
          className="flex-1 accent-sky-400"
        />
        <span className="tabular-nums font-mono text-xs font-bold text-sky-300">
          {effectiveCutoff}m / {maxMinute}m
        </span>
      </div>

      <div className="grid gap-3.5 md:grid-cols-[minmax(250px,315px)_1fr]">
        <div className="lg-inset p-2">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Post-Game Match-V5 Timeline Map"
            className="aspect-square w-full rounded-[10px] bg-[#080e1a]"
          >
            <path
              d="M 115 885 L 115 125 L 885 125"
              fill="none"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="18"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 115 885 L 885 885 L 885 125"
              fill="none"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="18"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="120"
              y1="880"
              x2="880"
              y2="120"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="18"
              strokeLinecap="round"
            />
            <path
              d="M 160 175 Q 500 500 840 825"
              fill="none"
              stroke="rgba(56,189,248,0.16)"
              strokeWidth="50"
              strokeLinecap="round"
            />
            <circle
              cx="325"
              cy="300"
              r="30"
              fill="rgba(99,102,241,0.16)"
              stroke="rgba(165,180,252,0.65)"
              strokeWidth="2.5"
            />
            <circle
              cx="680"
              cy="705"
              r="30"
              fill="rgba(251,146,60,0.16)"
              stroke="rgba(253,186,116,0.65)"
              strokeWidth="2.5"
            />

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
                    r="8.5"
                    fill="#38bdf8"
                    fillOpacity="0.5"
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
                    fill={color}
                    fillOpacity="0.28"
                    stroke={color}
                    strokeWidth={isSelected ? 4.5 : 2.5}
                  />
                  <circle cx={marker.x} cy={marker.y} r="6" fill={color} />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex flex-col justify-between gap-2.5 text-xs">
          <div>
            <div className="mb-2 flex flex-wrap gap-2.5 text-[10px] text-slate-300">
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
                <span className="h-2.5 w-2.5 rounded-full bg-pink-400" /> Control Ward
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Objective
              </span>
            </div>

            <div className="hud-scroll max-h-[210px] space-y-1.5 overflow-y-auto pr-1">
              {visibleMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  onClick={() => setSelectedMarker(marker)}
                  className={`flex w-full items-center justify-between rounded-[10px] border px-2.5 py-1.5 text-left text-[11px] transition ${
                    selectedMarker?.id === marker.id
                      ? 'border-sky-300/45 bg-sky-400/15 text-sky-100'
                      : 'border-white/[0.05] bg-black/35 text-slate-300 hover:bg-white/[0.04]'
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
            <div className="lg-inset p-3 text-[11px]">
              <div className="flex items-center gap-1.5 font-bold text-sky-200">
                <Swords className="h-3.5 w-3.5" />
                {selectedMarker.label}
              </div>
              <p className="mt-1 text-slate-300">{selectedMarker.detail}</p>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}
