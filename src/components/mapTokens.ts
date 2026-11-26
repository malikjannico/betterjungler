import type { TimelineMarkerKind, WardSpot } from '../types/coaching';

export const RIFT_PALETTE = {
  routeStroke: '#f8fafc',
  routeHalo: 'rgba(6, 9, 15, 0.78)',
  enemyGhostStroke: '#fb7185',
} as const;

export const WARD_KIND_STYLE: Record<
  WardSpot['kind'],
  { color: string; bg: string; label: string }
> = {
  control: {
    color: '#f472b6',
    bg: 'rgba(244, 114, 182, 0.2)',
    label: 'Control Ward',
  },
  deep: {
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.2)',
    label: 'Deep Ward',
  },
  stealth: {
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.2)',
    label: 'Stealth Ward',
  },
};

export const TIMELINE_MARKER_COLORS: Record<TimelineMarkerKind, string> = {
  kill: '#34d399',
  pre_obj_death: '#ef4444',
  death: '#fb7185',
  assist: '#a78bfa',
  control_ward: '#f472b6',
  ward: '#fbbf24',
  objective: '#38bdf8',
};

export function toMapPercent(coord: number): number {
  return Math.max(2, Math.min(98, (coord / 1000) * 100));
}
