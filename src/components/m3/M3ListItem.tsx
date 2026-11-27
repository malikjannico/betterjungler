import type { ReactNode } from 'react';
import { cx } from './cx';

export interface M3ListItemProps {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Stacked-card / master-detail list row. Renders a <button> (with state layer,
 * focus ring and aria-pressed) when `onClick` is provided, otherwise a <div>.
 */
export function M3ListItem({
  leading,
  title,
  description,
  meta,
  trailing,
  selected = false,
  disabled = false,
  onClick,
  ariaLabel,
  className,
}: M3ListItemProps) {
  const content = (
    <>
      {leading !== undefined && <span className="m3-list-item__leading">{leading}</span>}
      <span className="m3-list-item__body">
        <span className="m3-list-item__title m3-title-s block">{title}</span>
        {description !== undefined && (
          <span className="m3-list-item__desc m3-body-s block">{description}</span>
        )}
      </span>
      {meta !== undefined && <span className="m3-list-item__meta m3-label-m num">{meta}</span>}
      {trailing !== undefined && <span className="m3-list-item__trailing">{trailing}</span>}
    </>
  );

  const classes = cx(
    'm3-list-item',
    onClick && 'm3-list-item--interactive m3-state',
    selected && 'm3-list-item--selected',
    className
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onClick}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return (
    <div aria-label={ariaLabel} aria-current={selected ? 'true' : undefined} className={classes}>
      {content}
    </div>
  );
}
