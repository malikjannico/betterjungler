import { useId, useMemo } from 'react';
import {
  ORDERED_DIVISIONS,
  aggregateDeathHeatmap,
  computeLpDeltaSummary,
  computeLpTargetProgress,
  formatTitleDivision,
} from '../domain/trendAnalyticsEngine';
import type { LpHistoryPoint } from '../types/coaching';
import type { MatchV5Detail, SummonerProfileSummary } from '../types/riot';
import { GlassSurface } from './GlassSurface';
import { OfficialRiftMapBase } from './OfficialRiftMapBase';

interface ClimbTrendChartsProps {
  matches: MatchV5Detail[];
  lpHistory: LpHistoryPoint[];
  patchVersion: string;
  targetDivision?: string;
  summonerProfile?: SummonerProfileSummary | null;
}

export function ClimbTrendCharts({
  matches,
  lpHistory,
  patchVersion,
  targetDivision = 'PLATINUM IV',
  summonerProfile = null,
}: ClimbTrendChartsProps) {
  const uid = useId();
  const lpGradId = `${uid}-lp`;
  const heatPreId = `${uid}-pre`;
  const heatStdId = `${uid}-std`;
  const lpSummary = useMemo(() => computeLpDeltaSummary(lpHistory), [lpHistory]);
  const heatmap = useMemo(() => aggregateDeathHeatmap(matches), [matches]);

  const latestAbsLp = useMemo(() => {
    if (lpHistory.length > 0) {
      return lpHistory[lpHistory.length - 1]!.absoluteLp;
    }
    if (summonerProfile?.tier) {
      const divMatch = ORDERED_DIVISIONS.find(
        (d) =>
          d.tier === summonerProfile.tier.trim().toUpperCase() &&
          (d.rank === '' || d.rank === summonerProfile.rank.trim().toUpperCase())
      );
      return (divMatch?.baseLp ?? 1600) + summonerProfile.leaguePoints;
    }
    return null;
  }, [lpHistory, summonerProfile]);

  const targetProgress = useMemo(
    () =>
      latestAbsLp !== null ? computeLpTargetProgress(latestAbsLp, targetDivision) : null,
    [latestAbsLp, targetDivision]
  );

  const width = 440;
  const height = 160;
  const padLeft = 56;
  const padRight = 18;
  const padY = 18;

  // Include nearby target division cleanly when within ~250 LP so target line appears on chart
  const baseMin = lpSummary.minAbsLp;
  const baseMax = lpSummary.maxAbsLp;
  const chartMinAbsLp = Math.max(0, Math.floor((baseMin - 15) / 50) * 50);
  const targetWithinChart =
    targetProgress &&
    targetProgress.targetAbsLp >= chartMinAbsLp - 40 &&
    targetProgress.targetAbsLp <= baseMax + 250;
  const chartMaxAbsLp = Math.max(
    chartMinAbsLp + 100,
    targetWithinChart
      ? Math.max(baseMax, targetProgress.targetAbsLp + 35)
      : baseMax + 15
  );
  const span = Math.max(50, chartMaxAbsLp - chartMinAbsLp);

  const yForLp = (absLp: number) =>
    height - padY - ((absLp - chartMinAbsLp) / span) * (height - padY * 2);

  const visibleDivisions = ORDERED_DIVISIONS.filter(
    (d) => d.baseLp >= chartMinAbsLp && d.baseLp <= chartMaxAbsLp
  );

  const lpCoords = lpHistory.map((pt, idx) => {
    const x =
      padLeft +
      (idx / Math.max(1, lpHistory.length - 1)) * (width - padLeft - padRight);
    const y = yForLp(pt.absoluteLp);
    return { x, y, pt };
  });

  const lpPolyline = lpCoords.map((c) => `${c.x},${c.y}`).join(' ');
  const lpArea =
    lpCoords.length > 1
      ? `${lpCoords[0]!.x},${height - padY} ${lpPolyline} ${lpCoords[lpCoords.length - 1]!.x},${height - padY}`
      : '';

  const currentRankHeader = summonerProfile?.tier
    ? `${formatTitleDivision(summonerProfile.tier, summonerProfile.rank)} · ${summonerProfile.leaguePoints} LP`
    : lpSummary.currentLabel;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      {/* LP Climb Progression Chart */}
      <GlassSurface className="p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-white">
            LP Climb Progression ({lpHistory.length} games)
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`tabular-nums font-bold ${
                lpSummary.netLpChange >= 0 ? 'text-emerald-300' : 'text-rose-300'
              }`}
            >
              {lpSummary.netLpChange >= 0 ? '+' : ''}
              {lpSummary.netLpChange} LP
            </span>
            <span className="text-slate-400">· {lpSummary.streakText}</span>
          </div>
        </div>

        {targetProgress && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5 text-slate-200">
              <span className="text-slate-400">Current:</span>
              <span className="font-semibold text-white">{currentRankHeader}</span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-400">Goal:</span>
              <span className="font-semibold text-emerald-300">{targetProgress.targetLabel}</span>
            </div>
            <span
              className={`tabular-nums rounded-full px-2 py-0.5 text-[10px] font-bold ${
                targetProgress.goalReached
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-sky-500/15 text-sky-200'
              }`}
            >
              {targetProgress.goalReached
                ? 'Goal Reached'
                : `${targetProgress.lpRemaining} LP away · ~${targetProgress.estimatedNetWins} net wins`}
            </span>
          </div>
        )}

        <div className="lg-inset p-2">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="LP Progression Chart"
            className="w-full rounded-[10px]"
          >
            <defs>
              <linearGradient id={lpGradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Horizontal Division Threshold Lines */}
            {visibleDivisions.map((div) => {
              const y = yForLp(div.baseLp);
              const isTargetLine = targetProgress?.targetAbsLp === div.baseLp;
              return (
                <g key={div.baseLp}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke={isTargetLine ? '#34d399' : '#94a3b8'}
                    strokeOpacity={isTargetLine ? 0.65 : 0.22}
                    strokeWidth={isTargetLine ? 1.4 : 1}
                    strokeDasharray={isTargetLine ? '5 3' : '3 4'}
                  />
                  <text
                    x={padLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9"
                    fontWeight={isTargetLine ? '700' : '500'}
                    fill={isTargetLine ? '#6ee7b7' : '#94a3b8'}
                  >
                    {div.shortLabel}
                  </text>
                </g>
              );
            })}

            {lpArea && <polygon points={lpArea} fill={`url(#${lpGradId})`} />}
            {lpCoords.length > 1 && (
              <polyline
                points={lpPolyline}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="2.2"
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
                fill={
                  c.pt.win === true
                    ? '#34d399'
                    : c.pt.win === false
                      ? '#fb7185'
                      : '#94a3b8'
                }
              >
                <title>
                  {`${c.pt.tier} ${c.pt.rank} · ${c.pt.leaguePoints} LP`}
                </title>
              </circle>
            ))}
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>Green line = Target division boundary</span>
          <span>Emerald dot = Win · Coral dot = Loss</span>
        </div>
      </GlassSurface>

      {/* Multi-Game Death Heatmap on Official map11.png */}
      <GlassSurface className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-white">
            Multi-Game Death Heatmap ({heatmap.totalDeaths})
          </h3>
          <span className="text-[11px] font-semibold text-rose-300">
            {heatmap.preObjectiveDeaths} Pre-Obj
          </span>
        </div>

        <div className="grid grid-cols-[150px_1fr] items-center gap-3.5">
          <div className="lg-inset p-1.5">
            <svg
              viewBox="0 0 1000 1000"
              role="img"
              aria-label="Multi-Game Death Heatmap"
              className="aspect-square w-full rounded-[9px]"
            >
              <defs>
                <radialGradient id={heatPreId}>
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.82" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={heatStdId}>
                  <stop offset="0%" stopColor="#fb7185" stopOpacity="0.68" />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
                </radialGradient>
              </defs>

              <OfficialRiftMapBase patchVersion={patchVersion} />

              {heatmap.points.map((pt) => (
                <g key={pt.id}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={pt.isPreObjective ? 92 : 70}
                    fill={pt.isPreObjective ? `url(#${heatPreId})` : `url(#${heatStdId})`}
                  />
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="11"
                    fill={pt.isPreObjective ? '#ef4444' : '#fb7185'}
                    stroke="#06090f"
                    strokeWidth="4"
                  />
                </g>
              ))}
            </svg>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="t-caption text-white/[0.62]">
              Hotspot:{' '}
              <span className="font-semibold text-white">
                {heatmap.topDangerZone ?? 'Balanced'}
              </span>
            </div>
            {(
              Object.entries(heatmap.zoneCounts) as Array<[string, number]>
            )
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([zone, count]) => (
                <div
                  key={zone}
                  className="lg-inset flex items-center justify-between px-2.5 py-1 text-[11px]"
                >
                  <span className="text-slate-300">{zone}</span>
                  <span className="tabular-nums font-bold text-rose-300">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}
