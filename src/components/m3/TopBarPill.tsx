import { useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { getProfileIconUrl } from '../../services/ddragonService';
import { cx } from './cx';

export type TopBarPillTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'selected';

export interface TopBarPillProps {
  tone?: TopBarPillTone;
  /** Icon, status dot or 24px avatar rendered before the content. */
  leading?: ReactNode;
  /** Tightens left padding so a 24px circular avatar sits 4px from the edge. */
  leadingIsMedia?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
  /** When provided, the pill renders as a <button> with a state layer. */
  onClick?: () => void;
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaPressed?: boolean;
  /** Only attached when rendering as a button. */
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * Unified 32px top-bar pill. Every top-bar action/status (REC, Simulation,
 * Simulator, Compact HUD, profile) shares this exact height + shape so the
 * row stays optically aligned.
 */
export function TopBarPill({
  tone = 'neutral',
  leading,
  leadingIsMedia = false,
  trailing,
  children,
  onClick,
  title,
  ariaLabel,
  ariaExpanded,
  ariaPressed,
  ref,
  className,
}: TopBarPillProps) {
  const classes = cx(
    'm3-topbar-pill',
    tone !== 'neutral' && `m3-topbar-pill--${tone}`,
    leadingIsMedia && 'm3-topbar-pill--leading-media',
    onClick && 'm3-state',
    className
  );

  const content = (
    <>
      {leading !== undefined && <span className="m3-topbar-pill__leading">{leading}</span>}
      {children}
      {trailing}
    </>
  );

  if (onClick) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded}
        aria-pressed={ariaPressed}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title ?? ariaLabel} className={classes}>
      {content}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summoner profile pill                                              */
/* ------------------------------------------------------------------ */

const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function titleCase(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "PLATINUM", "II", 64 → "Platinum II · 64 LP"; apex tiers drop the division. */
export function formatRankLine(tier?: string | null, rank?: string | null, leaguePoints?: number | null): string {
  const normalizedTier = (tier ?? '').trim().toUpperCase();
  if (!normalizedTier || normalizedTier === 'UNRANKED' || normalizedTier === 'NONE') {
    return 'Unranked';
  }
  const division = !APEX_TIERS.has(normalizedTier) && rank ? ` ${rank.trim()}` : '';
  const lp = typeof leaguePoints === 'number' && Number.isFinite(leaguePoints) ? ` · ${leaguePoints} LP` : '';
  return `${titleCase(normalizedTier)}${division}${lp}`;
}

/** "Name#TAG" → { name, tag }. */
export function splitRiotId(riotId?: string | null): { name: string; tag: string | null } {
  const raw = (riotId ?? '').trim();
  const hashIndex = raw.lastIndexOf('#');
  if (hashIndex <= 0) return { name: raw, tag: null };
  return { name: raw.slice(0, hashIndex), tag: raw.slice(hashIndex + 1) || null };
}

export interface SummonerProfilePillProps {
  /** Riot ID in "GameName#TAG" form. */
  riotId?: string | null;
  profileIconId?: number;
  patchVersion?: string;
  tier?: string | null;
  rank?: string | null;
  leaguePoints?: number | null;
  onClick?: () => void;
  title?: string;
  className?: string;
}

export function SummonerProfilePill({
  riotId,
  profileIconId,
  patchVersion,
  tier,
  rank,
  leaguePoints,
  onClick,
  title,
  className,
}: SummonerProfilePillProps) {
  const { name, tag } = splitRiotId(riotId);
  const displayName = name || 'Summoner';
  // `undefined` patch falls back to the service's cached Data Dragon patch.
  const iconUrl = getProfileIconUrl(profileIconId, patchVersion);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageSrc = iconUrl !== null && failedUrl !== iconUrl ? iconUrl : null;
  const initial = displayName.charAt(0).toUpperCase() || '?';
  const rankLine = formatRankLine(tier, rank, leaguePoints);

  const avatar = imageSrc ? (
    <img
      src={imageSrc}
      alt=""
      width={24}
      height={24}
      draggable={false}
      onError={() => setFailedUrl(imageSrc)}
      className="m3-avatar h-6 w-6"
    />
  ) : (
    <span aria-hidden="true" className="m3-avatar h-6 w-6 text-[11px]">
      {initial}
    </span>
  );

  return (
    <TopBarPill
      leading={avatar}
      leadingIsMedia
      onClick={onClick}
      title={title ?? `${displayName}${tag ? `#${tag}` : ''} · ${rankLine}`}
      ariaLabel={`Summoner ${displayName}${tag ? ` #${tag}` : ''}, ${rankLine}`}
      className={cx('max-w-[320px] pr-3.5', className)}
    >
      <span className="m3-title-s flex min-w-0 items-baseline truncate text-[var(--md-sys-color-on-surface)]">
        <span className="truncate">{displayName}</span>
        {tag && <span className="m3-faint shrink-0 font-medium">#{tag}</span>}
      </span>
      <span aria-hidden="true" className="m3-topbar-pill__divider" />
      <span className="m3-label-m num shrink-0 text-[var(--md-sys-color-on-surface-variant)]">
        {rankLine}
      </span>
    </TopBarPill>
  );
}
