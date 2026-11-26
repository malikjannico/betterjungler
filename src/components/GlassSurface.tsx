import type { MouseEvent, ReactNode } from 'react';

interface GlassSurfaceProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}

export function GlassSurface({
  children,
  className = '',
  interactive = false,
}: GlassSurfaceProps) {
  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
    e.currentTarget.style.setProperty('--mx', `${x.toFixed(1)}%`);
    e.currentTarget.style.setProperty('--my', `${y.toFixed(1)}%`);
  }

  return (
    <div
      onMouseMove={interactive ? handleMouseMove : undefined}
      className={`lg-surface ${interactive ? 'lg-surface-interactive' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
