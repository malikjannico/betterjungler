import type { ReactNode } from 'react';

interface HudCardProps {
  children: ReactNode;
  className?: string;
  urgent?: boolean;
  pill?: boolean;
  testId?: string;
}

/**
 * Independent translucent floating HUD card with crisp double edge stroke for visibility over bright Rift terrain.
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
      className={`hud-card text-xs text-white/[0.92] ${
        pill ? '!rounded-full' : ''
      } ${urgent ? 'ring-1 ring-amber-400/50' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
