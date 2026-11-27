import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type M3ChipTone = 'plain' | 'primary' | 'success' | 'warning' | 'error' | 'tertiary';

export interface M3ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Omit for the default outlined (assist) chip. */
  tone?: M3ChipTone;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function M3Chip({
  tone,
  size = 'md',
  icon,
  label,
  className,
  children,
  ...rest
}: M3ChipProps) {
  return (
    <span
      {...rest}
      className={cx('m3-chip', size === 'sm' && 'm3-chip--sm', tone && `m3-chip--${tone}`, className)}
    >
      {icon}
      {label}
      {children}
    </span>
  );
}
