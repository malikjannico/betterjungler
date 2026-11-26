import { useState } from 'react';
import { Eye, Route } from 'lucide-react';
import type { JungleRoute, WardSpot } from '../types/coaching';
import type { MapSide } from '../types/riot';

interface SummonersRiftMapProps {
  mapSide: MapSide;
  strongSide: 'top' | 'bot' | 'mid';
  route: JungleRoute;
  wardSpots: WardSpot[];
}

const STATIC_CAMPS = [
  { id: 'b-blue', x: 260, y: 465, label: 'Blue' },
  { id: 'b-gromp', x: 165, y: 425, label: 'Gromp' },
  { id: 'b-wolves', x: 265, y: 560, label: 'Wolves' },
  { id: 'b-raptors', x: 470, y: 635, label: 'Raptors' },
  { id: 'b-red', x: 525, y: 720, label: 'Red' },
  { id: 'b-krugs', x: 565, y: 805, label: 'Krugs' },
  { id: 'r-red', x: 475, y: 275, label: 'Red' },
  { id: 'r-krugs', x: 430, y: 195, label: 'Krugs' },
  { id: 'r-raptors', x: 530, y: 365, label: 'Raptors' },
  { id: 'r-wolves', x: 735, y: 440, label: 'Wolves' },
  { id: 'r-blue', x: 745, y: 535, label: 'Blue' },
  { id: 'r-gromp', x: 835, y: 575, label: 'Gromp' },
];

export function SummonersRiftMap({
  mapSide,
  strongSide,
  route,
  wardSpots,
}: SummonersRiftMapProps) {
  const [showWards, setShowWards] = useState(true);
  const [selectedWard, setSelectedWard] = useState<WardSpot | null>(wardSpots[0] ?? null);

  const polylinePoints = route.steps.map((s) => `${s.x},${s.y}`).join(' ');

  return (
    <div className="hud-card rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Route className="h-4 w-4 text-cyan-400" />
          <span>Summoner&apos;s Rift Tactical Map ({mapSide.toUpperCase()} Side)</span>
        </div>
        <button
          type="button"
          onClick={() => setShowWards((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
            showWards
              ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
              : 'border-slate-700 bg-slate-800/70 text-slate-400'
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          {showWards ? 'Wards Visible' : 'Show Wards'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(260px,320px)_1fr]">
        <svg
          viewBox="0 0 1000 1000"
          role="img"
          aria-label="Summoner's Rift Jungle Route and Ward Map"
          className="aspect-square w-full rounded-lg border border-slate-700/80 bg-[#0b1320]"
        >
          <defs>
            <marker
              id="routeArrow"
              markerWidth="10"
              markerHeight="10"
              refX="7"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#22d3ee" />
            </marker>
          </defs>

          {/* Outer Lanes */}
          <path
            d="M 115 885 L 115 125 L 885 125"
            fill="none"
            stroke={strongSide === 'top' ? '#22d3ee' : '#1e293b'}
            strokeWidth={strongSide === 'top' ? 28 : 22}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={strongSide === 'top' ? 0.55 : 0.75}
          />
          <path
            d="M 115 885 L 885 885 L 885 125"
            fill="none"
            stroke={strongSide === 'bot' ? '#22d3ee' : '#1e293b'}
            strokeWidth={strongSide === 'bot' ? 28 : 22}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={strongSide === 'bot' ? 0.55 : 0.75}
          />
          {/* Mid Lane */}
          <line
            x1="120"
            y1="880"
            x2="880"
            y2="120"
            stroke="#1e293b"
            strokeWidth="22"
            strokeLinecap="round"
          />

          {/* River */}
          <path
            d="M 160 175 Q 500 500 840 825"
            fill="none"
            stroke="#0f3452"
            strokeWidth="52"
            strokeLinecap="round"
            opacity="0.7"
          />

          {/* Baron / Grubs Pit & Dragon Pit */}
          <circle cx="325" cy="300" r="32" fill="#1e1b4b" stroke="#818cf8" strokeWidth="3" />
          <text x="325" y="258" textAnchor="middle" fill="#a5b4fc" fontSize="24" fontWeight="700">
            BARON / GRUBS
          </text>

          <circle cx="680" cy="705" r="32" fill="#3b1d1a" stroke="#fb923c" strokeWidth="3" />
          <text x="680" y="762" textAnchor="middle" fill="#fdba74" fontSize="24" fontWeight="700">
            DRAGON
          </text>

          {/* Blue & Red Nexus */}
          <circle cx="110" cy="890" r="36" fill="#0ea5e9" opacity="0.25" stroke="#38bdf8" strokeWidth="4" />
          <text x="110" y="898" textAnchor="middle" fill="#7dd3fc" fontSize="24" fontWeight="700">
            BLUE
          </text>
          <circle cx="890" cy="110" r="36" fill="#ef4444" opacity="0.25" stroke="#f87171" strokeWidth="4" />
          <text x="890" y="118" textAnchor="middle" fill="#fca5a5" fontSize="24" fontWeight="700">
            RED
          </text>

          {/* All Jungle Camps (subtle background nodes) */}
          {STATIC_CAMPS.map((camp) => (
            <g key={camp.id}>
              <circle cx={camp.x} cy={camp.y} r="13" fill="#1e293b" stroke="#475569" strokeWidth="2" />
            </g>
          ))}

          {/* Recommended Route Path */}
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="7"
            strokeDasharray="16 10"
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#routeArrow)"
          />

          {/* Route Steps */}
          {route.steps.map((step) => (
            <g key={step.order}>
              <circle
                cx={step.x}
                cy={step.y}
                r="22"
                fill="#083344"
                stroke="#22d3ee"
                strokeWidth="4"
              />
              <text
                x={step.x}
                y={step.y + 8}
                textAnchor="middle"
                fill="#ecfeff"
                fontSize="23"
                fontWeight="800"
              >
                {step.order}
              </text>
            </g>
          ))}

          {/* Ward Spots */}
          {showWards &&
            wardSpots.map((ward) => {
              const fill =
                ward.kind === 'control'
                  ? '#ec4899'
                  : ward.kind === 'deep'
                    ? '#f59e0b'
                    : '#10b981';
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
                    fill={fill}
                    fillOpacity="0.28"
                    stroke={fill}
                    strokeWidth={isSelected ? 5 : 3}
                  />
                  <circle cx={ward.x} cy={ward.y} r="7" fill={fill} />
                </g>
              );
            })}
        </svg>

        <div className="flex flex-col justify-between gap-2 text-xs">
          <div>
            <div className="font-semibold text-cyan-300">{route.label}</div>
            <p className="mt-0.5 text-[11px] text-slate-400">{route.summary}</p>
            <ol className="mt-2 space-y-1">
              {route.steps.map((step) => (
                <li
                  key={step.order}
                  className="flex items-start justify-between gap-2 rounded bg-slate-900/70 px-2 py-1 text-[11px]"
                >
                  <div>
                    <span className="mr-1.5 font-bold text-cyan-400">{step.order}.</span>
                    <span className="font-medium text-slate-100">{step.campName}</span>
                    <span className="ml-1.5 text-slate-400">— {step.note}</span>
                  </div>
                  <span className="tabular-nums shrink-0 font-mono text-[10px] text-cyan-300">
                    {step.targetTime}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {showWards && selectedWard && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-amber-200">{selectedWard.label}</span>
                <span className="rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                  {selectedWard.kind} ward
                </span>
              </div>
              <div className="mt-0.5 text-[10px] font-medium text-amber-300/90">
                When: {selectedWard.timing}
              </div>
              <p className="mt-0.5 text-slate-300">{selectedWard.reason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
