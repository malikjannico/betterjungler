import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type M3CardVariant = 'hero' | 'module' | 'tonal' | 'outlined' | 'lowest';

export interface M3CardProps extends HTMLAttributes<HTMLElement> {
  /**
   * hero → surfaceContainer · 28px corners · 24px padding
   * module → surfaceContainerHigh · 16px corners · 16px padding
   * tonal → primaryContainer · 28px corners
   * outlined → transparent + outlineVariant hairline · 16px corners
   * lowest → surfaceContainerLowest well · 16px corners
   */
  variant?: M3CardVariant;
  /** Adds state layer, pointer cursor and expressive hover lift. */
  interactive?: boolean;
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
  className?: string;
  children?: ReactNode;
}

export function M3Card({
  variant = 'hero',
  interactive = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: M3CardProps) {
  return (
    <Tag
      {...rest}
      className={cx(
        'm3-card',
        `m3-card--${variant}`,
        interactive && 'm3-card--interactive m3-state',
        className
      )}
    >
      {children}
    </Tag>
  );
}
