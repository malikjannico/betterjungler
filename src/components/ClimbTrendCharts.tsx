import { useMemo } from 'react';
import { Flame, TrendingUp } from 'lucide-react';
import {
  aggregateDeathHeatmap,
  computeLpDeltaSummary,
} from '../domain/trendAnalyticsEngine';
import type { LpHistoryPoint } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';
import { GlassSurface } from './GlassSurface';

interface ClimbTrendChartsProps {
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
}

export function ClimbTrendCharts({ matches, lpHistory }: ClimbTrendChartsProps) {
  const lpSummary = useMemo(() => computeLpDeltaSummary(lpHistory), [lpHistory]);
  const heatmap = useMemo(() => aggregateDeathHeatmap(matches), [matches]);

  const width = 420;
  const height = 140;
  const padX = 24;
  const padY = 18;
  const span = Math.max(20, lpSummary.maxAbsLp - lpSummary.minAbsLp);

  const lpCoords = lpHistory.map((pt, idx) => {
    const x =
      padX + (idx / Math.max(1, lpHistory.length - 1)) * (width - padX * 2);
    const y =
      height -
      padY -
      ((pt.absoluteLp - lpSummary.minAbsLp) / span) * (height - padY * 2);
    return { x, y, pt };
  });

  const lpPolyline = lpCoords.map((c) => `${c.x},${c.y}`).join(' ');
  const lpArea =
    lpCoords.length > 1
      ? `${lpCoords[0]!.x},${height - padY} ${lpPolyline} ${lpCoords[lpCoords.length - 1]!.x},${height - padY}`
      : '';

  return (
    <div className="grid gap-3.5 lg:grid-cols-[1.3fr_1fr]">
      {/* LP Climb Progression Chart */}
      <GlassSurface interactive className="p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
            <TrendingUp className="h-4 w-4 text-emerald-300" />
            <span>LP Climb Progression ({lpHistory.length} games)</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`tabular-nums rounded-full px-2.5 py-0.5 font-bold ${
                lpSummary.netLpChange >= 0
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-rose-400/15 text-rose-200'
              }`}
            >
              {lpSummary.netLpChange >= 0 ? '+' : ''}
              {lpSummary.netLpChange} LP
            </span>
            <span className="text-slate-400">{lpSummary.streakText}</span>
          </div>
        </div>

        <div className="lg-inset p-2">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="LP Progression Chart"
            className="w-full rounded-[10px] bg-[#080d18]"
          >
            <defs>
              <linearGradient id="lpAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {lpArea && <polygon points={lpArea} fill="url(#lpAreaGrad)" />}
            {lpCoords.length > 1 && (
              <polyline
                points={lpPolyline}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {lpCoords.map((c, idx) => (
              <circle
                key={`${c.pt.timestamp}-${idx}`}
                cx={c.x}
                cy={c.y}
                r="4"
                fill={c.pt.win ? '#34d399' : '#fb7185'}
              />
            ))}
          </svg>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>Current: {lpSummary.currentLabel}</span>
          <span>Emerald = Win • Coral = Loss</span>
        </div>
      </GlassSurface>

      {/* Multi-Game Death Cluster Heatmap */}
      <GlassSurface interactive className="p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
            <Flame className="h-4 w-4 text-rose-300" />
            <span>Multi-Game Death Heatmap ({heatmap.totalDeaths})</span>
          </div>
          <span className="rounded-full bg-rose-400/15 px-2.5 py-0.5 text-[10px] font-bold text-rose-200">
            {heatmap.preObjectiveDeaths} Pre-Obj
          </span>
        </div>

        <div className="grid grid-cols-[145px_1fr] items-center gap-3">
          <div className="lg-inset p-1.5">
            <svg
              viewBox="0 0 1000 1000"
              role="img"
              aria-label="Multi-Game Death Heatmap"
              className="aspect-square w-full rounded-[9px] bg-[#080e1a]"
            >
              <defs>
                <radialGradient id="heatPreObj">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="heatStd">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
                </radialGradient>
              </defs>

              <path
                d="M 115 885 L 115 125 L 885 125"
                fill="none"
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="22"
              />
              <path
                d="M 115 885 L 885 885 L 885 125"
                fill="none"
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="22"
              />
              <line
                x1="120"
                y1="880"
                x2="880"
                y2="120"
                stroke="rgba(148,163,184,0.18)"
                strokeWidth="20"
              />
              <path
                d="M 160 175 Q 500 500 840 825"
                fill="none"
                stroke="rgba(56,189,248,0.16)"
                strokeWidth="52"
              />
              {heatmap.points.map((pt) => (
                <g key={pt.id}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={pt.isPreObjective ? 88 : 68}
                    fill={pt.isPreObjective ? 'url(#heatPreObj)' : 'url(#heatStd)'}
                  />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="13"
                    fill={pt.isPreObjective ? '#ef4444' : '#fda4af'}
                  />
                </g>
              ))}
            </svg>
          </div>

          <div className="space-y-2 text-[11px]">
            <div className="lg-inset p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Highest-Risk Zone
              </div>
              <div className="mt-0.5 font-bold text-rose-200">
                {heatmap.topDangerZone ?? 'No deaths recorded'}
              </div>
            </div>
            <div className="space-y-1 text-[10px] text-slate-400">
              {Object.entries(heatmap.zoneCounts)
                .filter(([, count]) => count > 0)
                .map(([zone, count]) => (
                  <div key={zone} className="flex justify-between px-1">
                    <span>{zone}</span>
                    <span className="tabular-nums font-semibold text-slate-200">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}
