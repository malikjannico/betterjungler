import { useMemo } from 'react';
import { Flame, TrendingUp } from 'lucide-react';
import {
  aggregateDeathHeatmap,
  computeLpDeltaSummary,
} from '../domain/trendAnalyticsEngine';
import type { LpHistoryPoint } from '../types/coaching';
import type { MatchV5Detail } from '../types/riot';

interface ClimbTrendChartsProps {
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
}

export function ClimbTrendCharts({ matches, lpHistory }: ClimbTrendChartsProps) {
  const lpSummary = useMemo(() => computeLpDeltaSummary(lpHistory), [lpHistory]);
  const heatmap = useMemo(() => aggregateDeathHeatmap(matches), [matches]);

  const width = 420;
  const height = 135;
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

  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
      {/* LP Climb Progression Chart */}
      <div className="hud-card rounded-xl p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span>LP Climb Progression ({lpHistory.length} games)</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`tabular-nums rounded px-2 py-0.5 font-bold ${
                lpSummary.netLpChange >= 0
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {lpSummary.netLpChange >= 0 ? '+' : ''}
              {lpSummary.netLpChange} LP
            </span>
            <span className="text-slate-400">{lpSummary.streakText}</span>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="LP Progression Chart"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/70"
        >
          {lpCoords.length > 1 && (
            <polyline
              points={lpPolyline}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {lpCoords.map((c, idx) => (
            <g key={`${c.pt.timestamp}-${idx}`}>
              <circle
                cx={c.x}
                cy={c.y}
                r="4"
                fill={c.pt.win ? '#10b981' : '#f43f5e'}
              />
            </g>
          ))}
        </svg>

        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>Current: {lpSummary.currentLabel}</span>
          <span>Green = Win • Rose = Loss</span>
        </div>
      </div>

      {/* Multi-Game Death Cluster Heatmap */}
      <div className="hud-card rounded-xl p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
            <Flame className="h-4 w-4 text-rose-400" />
            <span>Multi-Game Death Heatmap ({heatmap.totalDeaths})</span>
          </div>
          <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-200">
            {heatmap.preObjectiveDeaths} Pre-Obj
          </span>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-3">
          <svg
            viewBox="0 0 1000 1000"
            role="img"
            aria-label="Multi-Game Death Heatmap"
            className="aspect-square w-full rounded-lg border border-slate-800 bg-[#0b1320]"
          >
            <path
              d="M 115 885 L 115 125 L 885 125"
              fill="none"
              stroke="#1e293b"
              strokeWidth="24"
            />
            <path
              d="M 115 885 L 885 885 L 885 125"
              fill="none"
              stroke="#1e293b"
              strokeWidth="24"
            />
            <line x1="120" y1="880" x2="880" y2="120" stroke="#1e293b" strokeWidth="22" />
            <path
              d="M 160 175 Q 500 500 840 825"
              fill="none"
              stroke="#0f3452"
              strokeWidth="52"
              opacity="0.65"
            />
            {heatmap.points.map((pt) => (
              <g key={pt.id}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={pt.isPreObjective ? 58 : 44}
                  fill={pt.isPreObjective ? '#ef4444' : '#fb7185'}
                  fillOpacity="0.28"
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="14"
                  fill={pt.isPreObjective ? '#ef4444' : '#fda4af'}
                />
              </g>
            ))}
          </svg>

          <div className="space-y-1.5 text-[11px]">
            <div>
              <div className="text-[10px] uppercase text-slate-400">Highest-Risk Zone</div>
              <div className="font-bold text-rose-300">
                {heatmap.topDangerZone ?? 'No deaths recorded'}
              </div>
            </div>
            <div className="space-y-0.5 text-[10px] text-slate-400">
              {Object.entries(heatmap.zoneCounts)
                .filter(([, count]) => count > 0)
                .map(([zone, count]) => (
                  <div key={zone} className="flex justify-between">
                    <span>{zone}</span>
                    <span className="tabular-nums font-semibold text-slate-200">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
