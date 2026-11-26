import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { buildGoldXpSeries } from '../domain/trendAnalyticsEngine';
import type { MatchV5Detail } from '../types/riot';

interface GoldXpDiffChartProps {
  match: MatchV5Detail;
}

export function GoldXpDiffChart({ match }: GoldXpDiffChartProps) {
  const [metric, setMetric] = useState<'goldDiff' | 'xpDiff'>('goldDiff');
  const series = useMemo(() => buildGoldXpSeries(match), [match]);
  const [selectedIdx, setSelectedIdx] = useState<number>(
    Math.max(0, series.points.length - 1)
  );

  if (series.points.length < 2) {
    return null;
  }

  const width = 620;
  const height = 140;
  const padX = 28;
  const padY = 18;

  const values = series.points.map((p) => p[metric]);
  const maxAbs = Math.max(500, ...values.map((v) => Math.abs(v)));
  const zeroY = height / 2;

  const coords = series.points.map((pt, idx) => {
    const x =
      padX +
      (idx / Math.max(1, series.points.length - 1)) * (width - padX * 2);
    const val = pt[metric];
    const y = zeroY - (val / maxAbs) * (height / 2 - padY);
    return { x, y, pt };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const activeCoord = coords[Math.min(selectedIdx, coords.length - 1)] ?? coords[0]!;

  return (
    <div className="hud-card rounded-xl p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span>
            {metric === 'goldDiff' ? 'Gold' : 'XP'} Diff vs {match.enemyJunglerName}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-400">
            Peak Lead:{' '}
            <strong className="tabular-nums text-emerald-300">+{series.maxLead}g</strong>
          </span>
          <button
            type="button"
            onClick={() => setMetric('goldDiff')}
            className={`rounded px-2 py-0.5 font-semibold ${
              metric === 'goldDiff'
                ? 'bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            Gold Diff
          </button>
          <button
            type="button"
            onClick={() => setMetric('xpDiff')}
            className={`rounded px-2 py-0.5 font-semibold ${
              metric === 'xpDiff'
                ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            XP Diff
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Gold and XP Diff vs Enemy Jungler Chart"
        className="w-full rounded-lg border border-slate-800 bg-slate-950/70"
      >
        {/* Zero Axis */}
        <line
          x1={padX}
          y1={zeroY}
          x2={width - padX}
          y2={zeroY}
          stroke="#475569"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
        <text x={6} y={zeroY + 4} fill="#64748b" fontSize="10">
          0
        </text>
        <text x={4} y={14} fill="#34d399" fontSize="10">
          +{maxAbs}
        </text>
        <text x={4} y={height - 6} fill="#fb7185" fontSize="10">
          -{maxAbs}
        </text>

        {/* Curve */}
        <polyline
          points={polyline}
          fill="none"
          stroke={metric === 'goldDiff' ? '#22d3ee' : '#a78bfa'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Points */}
        {coords.map((c, idx) => {
          const val = c.pt[metric];
          const isSelected = idx === selectedIdx;
          return (
            <g
              key={c.pt.minute}
              onClick={() => setSelectedIdx(idx)}
              className="cursor-pointer"
            >
              <circle
                cx={c.x}
                cy={c.y}
                r={isSelected ? 5.5 : 3.5}
                fill={val >= 0 ? '#10b981' : '#f43f5e'}
                stroke={isSelected ? '#f8fafc' : 'none'}
                strokeWidth="1.5"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-300">
        <span>
          Minute <strong className="text-cyan-300">{activeCoord.pt.minute}:00</strong> — Gold{' '}
          <strong
            className={`tabular-nums ${
              activeCoord.pt.goldDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {activeCoord.pt.goldDiff >= 0 ? '+' : ''}
            {activeCoord.pt.goldDiff}g
          </strong>
          {' • '}XP{' '}
          <strong
            className={`tabular-nums ${
              activeCoord.pt.xpDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {activeCoord.pt.xpDiff >= 0 ? '+' : ''}
            {activeCoord.pt.xpDiff}
          </strong>
          {' • '}CS{' '}
          <strong className="tabular-nums text-slate-200">
            {activeCoord.pt.csDiff >= 0 ? '+' : ''}
            {activeCoord.pt.csDiff}
          </strong>
        </span>
        {series.swingMinute !== null && (
          <span className="text-amber-300">Momentum swing @ {series.swingMinute}:00</span>
        )}
      </div>
    </div>
  );
}
