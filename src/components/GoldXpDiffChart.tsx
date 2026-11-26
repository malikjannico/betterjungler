import { useMemo, useState } from 'react';
import { buildGoldXpSeries } from '../domain/trendAnalyticsEngine';
import type { MatchV5Detail } from '../types/riot';
import { GlassSurface } from './GlassSurface';

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
  const height = 148;
  const padX = 32;
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
  const firstCoord = coords[0]!;
  const lastCoord = coords[coords.length - 1]!;
  const areaPolygon = `${firstCoord.x},${zeroY} ${polyline} ${lastCoord.x},${zeroY}`;
  const activeCoord = coords[Math.min(selectedIdx, coords.length - 1)] ?? firstCoord;

  return (
    <GlassSurface className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-white">
          {metric === 'goldDiff' ? 'Gold' : 'XP'} Diff vs {match.enemyJunglerName}
        </h3>

        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-slate-400">
            Peak Lead:{' '}
            <strong className="tabular-nums text-emerald-300">+{series.maxLead}g</strong>
          </span>

          <div className="lg-segmented flex gap-0.5">
            <button
              type="button"
              onClick={() => setMetric('goldDiff')}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                metric === 'goldDiff'
                  ? 'lg-segment-active font-semibold'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Gold Diff
            </button>
            <button
              type="button"
              onClick={() => setMetric('xpDiff')}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                metric === 'xpDiff'
                  ? 'lg-segment-active font-semibold'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              XP Diff
            </button>
          </div>
        </div>
      </div>

      <div className="lg-inset p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Gold and XP Diff vs Enemy Jungler Chart"
          className="w-full rounded-[10px]"
        >
          <defs>
            <linearGradient id="diffAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke="rgba(255,255,255,0.16)"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <text x={8} y={zeroY + 3} fill="#64748b" fontSize="10">
            0
          </text>
          <text x={6} y={14} fill="#34d399" fontSize="10">
            +{maxAbs}
          </text>
          <text x={6} y={height - 6} fill="#fb7185" fontSize="10">
            -{maxAbs}
          </text>

          <polygon points={areaPolygon} fill="url(#diffAreaGrad)" />

          <polyline
            points={polyline}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

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
                  r={isSelected ? 5 : 3.5}
                  fill={val >= 0 ? '#34d399' : '#fb7185'}
                  stroke={isSelected ? '#ffffff' : 'none'}
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-slate-400">
        <span>
          Minute <strong className="text-white">{activeCoord.pt.minute}:00</strong> · Gold{' '}
          <strong
            className={`tabular-nums ${
              activeCoord.pt.goldDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {activeCoord.pt.goldDiff >= 0 ? '+' : ''}
            {activeCoord.pt.goldDiff}g
          </strong>
          {' · '}XP{' '}
          <strong
            className={`tabular-nums ${
              activeCoord.pt.xpDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {activeCoord.pt.xpDiff >= 0 ? '+' : ''}
            {activeCoord.pt.xpDiff}
          </strong>
          {' · '}CS{' '}
          <strong className="tabular-nums text-slate-200">
            {activeCoord.pt.csDiff >= 0 ? '+' : ''}
            {activeCoord.pt.csDiff}
          </strong>
        </span>
        {series.swingMinute !== null && (
          <span className="text-amber-300">Momentum swing @ {series.swingMinute}:00</span>
        )}
      </div>
    </GlassSurface>
  );
}
