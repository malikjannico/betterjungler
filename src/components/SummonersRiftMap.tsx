import { useState } from 'react';
import type { JungleRoute, WardSpot } from '../types/coaching';
import type { MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { OfficialRiftMapBase } from './OfficialRiftMapBase';

interface SummonersRiftMapProps {
  mapSide: MapSide;
  patchVersion: string;
  route: JungleRoute;
  wardSpots: WardSpot[];
}

export function SummonersRiftMap({
  mapSide,
  patchVersion,
  route,
  wardSpots,
}: SummonersRiftMapProps) {
  const [showWards, setShowWards] = useState(true);
  const [selectedWard, setSelectedWard] = useState<WardSpot | null>(wardSpots[0] ?? null);

  const polylinePoints = route.steps.map((s) => `${s.x},${s.y}`).join(' ');

  return (
    <GlassSurface className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-white">
              Summoner&apos;s Rift Tactical Map ({mapSide.toUpperCase()} Side)
            </h3>
            <span className="text-[11px] font-medium text-slate-400">
              · {route.stageLabel} · {route.timeWindow}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{route.whyThisClear}</p>
        </div>

        <button
          type="button"
          onClick={() => setShowWards((v) => !v)}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
            showWards
              ? 'border-white/25 bg-white/12 text-white'
              : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200'
          }`}
        >
          {showWards ? 'Wards Visible' : 'Show Wards'}
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="lg-inset p-2">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Summoner's Rift Jungle Route and Ward Map"
            className="aspect-square w-full rounded-[10px]"
          >
            <defs>
              <marker
                id="routeArrow"
                markerWidth="9"
                markerHeight="9"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L7.5,3 z" fill="#ffffff" />
              </marker>
            </defs>

            <OfficialRiftMapBase patchVersion={patchVersion} />

            {/* Crisp White Path Line with Subtle Outer Halo */}
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="rgba(0,0,0,0.65)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#ffffff"
              strokeWidth="5"
              strokeDasharray="12 8"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />

            {/* Exact Numbered Camp Waypoints */}
            {route.steps.map((step) => (
              <g key={step.order}>
                <circle
                  cx={step.x}
                  cy={step.y}
                  r="23"
                  fill="rgba(9, 12, 18, 0.88)"
                  stroke="#ffffff"
                  strokeWidth="3.5"
                />
                <text
                  x={step.x}
                  y={step.y + 8}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="22"
                  fontWeight="800"
                >
                  {step.order}
                </text>
              </g>
            ))}

            {/* Exact Official Bush Ward Spots */}
            {showWards &&
              wardSpots.map((ward) => {
                const fill =
                  ward.kind === 'control'
                    ? '#f472b6'
                    : ward.kind === 'deep'
                      ? '#fbbf24'
                      : '#34d399';
                const isSelected = selectedWard?.id === ward.id;
                return (
                  <g
                    key={ward.id}
                    onClick={() => setSelectedWard(ward)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={ward.x}
                      cy={ward.y}
                      r={isSelected ? 24 : 18}
                      fill="rgba(0,0,0,0.55)"
                      stroke={fill}
                      strokeWidth={isSelected ? 4.5 : 3}
                    />
                    <circle cx={ward.x} cy={ward.y} r="7.5" fill={fill} />
                  </g>
                );
              })}
          </svg>
        </div>

        <div className="flex flex-col justify-between gap-3 text-xs">
          <div>
            <div className="text-xs font-semibold text-white">{route.label}</div>
            <p className="mt-1 text-[11px] text-slate-400">{route.summary}</p>
            <ol className="mt-3 divide-y divide-white/[0.06] border-t border-b border-white/[0.06]">
              {route.steps.map((step) => (
                <li
                  key={step.order}
                  className="flex items-start justify-between gap-3 py-2 text-[11px]"
                >
                  <div>
                    <span className="tabular-nums mr-2 font-semibold text-slate-400">
                      {step.order}.
                    </span>
                    <span className="font-semibold text-white">{step.campName}</span>
                    <span className="ml-2 text-slate-400">{step.note}</span>
                  </div>
                  <span className="tabular-nums shrink-0 font-mono text-[10px] text-slate-300">
                    {step.targetTime}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {showWards && selectedWard && (
            <div className="lg-inset p-3 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{selectedWard.label}</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {selectedWard.kind} ward · {selectedWard.timing}
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
