import { useState } from 'react';
import { Eye, Route } from 'lucide-react';
import type { JungleRoute, WardSpot } from '../types/coaching';
import type { MapSide } from '../types/riot';
import { GlassSurface } from './GlassSurface';

interface SummonersRiftMapProps {
  mapSide: MapSide;
  strongSide: 'top' | 'bot' | 'mid';
  route: JungleRoute;
  wardSpots: WardSpot[];
}

const STATIC_CAMPS = [
  { id: 'b-blue', x: 260, y: 465 },
  { id: 'b-gromp', x: 165, y: 425 },
  { id: 'b-wolves', x: 265, y: 560 },
  { id: 'b-raptors', x: 470, y: 635 },
  { id: 'b-red', x: 525, y: 720 },
  { id: 'b-krugs', x: 565, y: 805 },
  { id: 'r-red', x: 475, y: 275 },
  { id: 'r-krugs', x: 430, y: 195 },
  { id: 'r-raptors', x: 530, y: 365 },
  { id: 'r-wolves', x: 735, y: 440 },
  { id: 'r-blue', x: 745, y: 535 },
  { id: 'r-gromp', x: 835, y: 575 },
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
    <GlassSurface className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
          <Route className="h-4 w-4 text-sky-300" />
          <span>Summoner&apos;s Rift Tactical Map ({mapSide.toUpperCase()} Side)</span>
        </div>

        <button
          type="button"
          onClick={() => setShowWards((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
            showWards
              ? 'border-amber-300/40 bg-amber-400/15 text-amber-200'
              : 'border-white/10 bg-white/5 text-slate-400'
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          {showWards ? 'Wards Visible' : 'Show Wards'}
        </button>
      </div>

      <div className="grid gap-3.5 md:grid-cols-[minmax(260px,325px)_1fr]">
        <div className="lg-inset p-2">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Summoner's Rift Jungle Route and Ward Map"
            className="aspect-square w-full rounded-[10px] bg-[#080e1a]"
          >
            <defs>
              <linearGradient id="riverGlow" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(56,189,248,0.22)" />
                <stop offset="100%" stopColor="rgba(14,165,233,0.12)" />
              </linearGradient>
              <marker
                id="routeArrow"
                markerWidth="10"
                markerHeight="10"
                refX="7"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L8,3 z" fill="#38bdf8" />
              </marker>
            </defs>

            {/* Top / Bot / Mid Lanes */}
            <path
              d="M 115 885 L 115 125 L 885 125"
              fill="none"
              stroke={strongSide === 'top' ? '#38bdf8' : 'rgba(148,163,184,0.18)'}
              strokeWidth={strongSide === 'top' ? 24 : 18}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={strongSide === 'top' ? 0.5 : 1}
            />
            <path
              d="M 115 885 L 885 885 L 885 125"
              fill="none"
              stroke={strongSide === 'bot' ? '#38bdf8' : 'rgba(148,163,184,0.18)'}
              strokeWidth={strongSide === 'bot' ? 24 : 18}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={strongSide === 'bot' ? 0.5 : 1}
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

            {/* River */}
            <path
              d="M 160 175 Q 500 500 840 825"
              fill="none"
              stroke="url(#riverGlow)"
              strokeWidth="52"
              strokeLinecap="round"
            />

            {/* Baron / Dragon Pits */}
            <circle cx="325" cy="300" r="32" fill="rgba(99,102,241,0.18)" stroke="rgba(165,180,252,0.7)" strokeWidth="2.5" />
            <text x="325" y="254" textAnchor="middle" fill="#c7d2fe" fontSize="22" fontWeight="700">
              BARON / GRUBS
            </text>
            <circle cx="680" cy="705" r="32" fill="rgba(251,146,60,0.16)" stroke="rgba(253,186,116,0.7)" strokeWidth="2.5" />
            <text x="680" y="762" textAnchor="middle" fill="#fed7aa" fontSize="22" fontWeight="700">
              DRAGON
            </text>

            {/* Nexuses */}
            <circle cx="110" cy="890" r="34" fill="rgba(56,189,248,0.18)" stroke="#38bdf8" strokeWidth="3" />
            <text x="110" y="897" textAnchor="middle" fill="#bae6fd" fontSize="22" fontWeight="700">
              BLUE
            </text>
            <circle cx="890" cy="110" r="34" fill="rgba(244,63,94,0.18)" stroke="#fb7185" strokeWidth="3" />
            <text x="890" y="117" textAnchor="middle" fill="#fecdd3" fontSize="22" fontWeight="700">
              RED
            </text>

            {/* Static Camp Nodes */}
            {STATIC_CAMPS.map((camp) => (
              <circle
                key={camp.id}
                cx={camp.x}
                cy={camp.y}
                r="11"
                fill="rgba(255,255,255,0.06)"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="2"
              />
            ))}

            {/* Path Line */}
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="6.5"
              strokeDasharray="14 9"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd="url(#routeArrow)"
            />

            {/* Ordered Route Steps */}
            {route.steps.map((step) => (
              <g key={step.order}>
                <circle
                  cx={step.x}
                  cy={step.y}
                  r="24"
                  fill="rgba(14,165,233,0.2)"
                />
                <circle
                  cx={step.x}
                  cy={step.y}
                  r="19"
                  fill="#0b2239"
                  stroke="#7dd3fc"
                  strokeWidth="3"
                />
                <text
                  x={step.x}
                  y={step.y + 7}
                  textAnchor="middle"
                  fill="#f0f9ff"
                  fontSize="21"
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
                      fill={fill}
                      fillOpacity="0.22"
                      stroke={fill}
                      strokeWidth={isSelected ? 4.5 : 2.5}
                    />
                    <circle cx={ward.x} cy={ward.y} r="6.5" fill={fill} />
                  </g>
                );
              })}
          </svg>
        </div>

        <div className="flex flex-col justify-between gap-2.5 text-xs">
          <div>
            <div className="font-bold text-sky-200">{route.label}</div>
            <p className="mt-0.5 text-[11px] text-slate-400">{route.summary}</p>
            <ol className="mt-2.5 space-y-1.5">
              {route.steps.map((step) => (
                <li
                  key={step.order}
                  className="lg-inset flex items-start justify-between gap-2 px-2.5 py-1.5 text-[11px]"
                >
                  <div>
                    <span className="mr-1.5 font-bold text-sky-300">{step.order}.</span>
                    <span className="font-semibold text-slate-100">{step.campName}</span>
                    <span className="ml-1.5 text-slate-400">— {step.note}</span>
                  </div>
                  <span className="tabular-nums shrink-0 font-mono text-[10px] text-sky-300">
                    {step.targetTime}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {showWards && selectedWard && (
            <div className="lg-inset border-amber-300/25 bg-amber-400/[0.07] p-3 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-amber-200">{selectedWard.label}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                  {selectedWard.kind} ward
                </span>
              </div>
              <div className="mt-0.5 text-[10px] font-medium text-amber-300">
                When: {selectedWard.timing}
              </div>
              <p className="mt-1 text-slate-300">{selectedWard.reason}</p>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}
