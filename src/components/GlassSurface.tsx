import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';

export type MaterialVariant = 'plain' | 'glass' | 'chrome';

export type GlassSurfaceElement =
  | 'div'
  | 'section'
  | 'article'
  | 'aside'
  | 'header'
  | 'footer'
  | 'li'
  | 'ul';

interface GlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  variant?: MaterialVariant;
  /** Rendered element (defaults to `div`). */
  as?: GlassSurfaceElement;
  /**
   * Layers the M3 Expressive `surfaceContainerLow` tone + large (16px) corner
   * onto the plain plate. Only takes effect where `m3-expressive.css` is loaded
   * (main window); the HUD window never loads it, so HUD output is unchanged.
   */
  m3?: boolean;
}

export function GlassSurface({
  children,
  className = '',
  interactive = false,
  variant = 'plain',
  as: Tag = 'div',
  m3 = true,
  onMouseMove,
  ...rest
}: GlassSurfaceProps) {
  function handleMouseMove(e: MouseEvent<HTMLElement>) {
    onMouseMove?.(e);
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
    e.currentTarget.style.setProperty('--mx', `${x.toFixed(1)}%`);
    e.currentTarget.style.setProperty('--my', `${y.toFixed(1)}%`);
  }

  const materialClass =
    variant === 'glass'
      ? 'mat-glass mat-lens'
      : variant === 'chrome'
        ? 'mat-chrome'
        : `mat-plain${m3 ? ' m3-surface-low' : ''}`;

  return (
    <Tag
      {...rest}
      onMouseMove={interactive || onMouseMove ? handleMouseMove : undefined}
      className={`${materialClass} ${interactive ? 'lg-surface-interactive' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}
