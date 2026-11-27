import type { ReactNode } from 'react';

interface HudCardProps {
  children: ReactNode;
  className?: string;
  urgent?: boolean;
  pill?: boolean;
  testId?: string;
}

/**
 * Sharp broadcast-inspired translucent HUD plate with high-contrast outer keyline.
 */
export function HudCard({
  children,
  className = '',
  urgent = false,
  pill = false,
  testId,
}: HudCardProps) {
  return (
    <div
      data-testid={testId}
      className={`hud-card text-xs text-white/[0.94] ${
        pill ? 'rounded-[3px]' : ''
      } ${urgent ? 'ring-1 ring-amber-400/70' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
