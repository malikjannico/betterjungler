import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { GlassSurface } from './GlassSurface';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  children?: ReactNode;
}

/**
 * Calm, top-left aligned architectural empty state used across all gated views.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
}: EmptyStateProps) {
  return (
    <GlassSurface className="p-6 text-left">
      <div className="flex items-start gap-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-white/[0.08] bg-white/[0.04] text-white/[0.78]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="t-title text-white/[0.92]">{title}</h2>
          <p className="t-body max-w-xl text-white/[0.62]">{description}</p>
          {children}
          {action && (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={action.disabled}
                onClick={action.onClick}
                className="lg-btn-primary px-3.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {action.label}
              </button>
            </div>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}
