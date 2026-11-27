import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';

export type M3ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';
export type M3ButtonSize = 'sm' | 'md';

export interface M3ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: M3ButtonVariant;
  size?: M3ButtonSize;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Pill-shaped M3 Expressive button with state layer and press shape-morph. */
export function M3Button({
  variant = 'filled',
  size = 'md',
  icon,
  trailingIcon,
  type = 'button',
  className,
  children,
  ref,
  ...rest
}: M3ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'm3-btn m3-state',
        `m3-btn--${variant}`,
        size === 'sm' && 'm3-btn--sm',
        className
      )}
    >
      {icon}
      {children}
      {trailingIcon}
    </button>
  );
}
