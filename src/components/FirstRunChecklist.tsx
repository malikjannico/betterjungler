import { CheckCircle2, Circle, X } from 'lucide-react';
import { GlassSurface } from './GlassSurface';

interface FirstRunChecklistProps {
  hasVerifiedKey: boolean;
  hasTestedHud: boolean;
  overlayHotkey: string;
  onOpenSettings: () => void;
  onTestHud: () => void;
  onDismiss: () => void;
}

export function FirstRunChecklist({
  hasVerifiedKey,
  hasTestedHud,
  overlayHotkey,
  onOpenSettings,
  onTestHud,
  onDismiss,
}: FirstRunChecklistProps) {
  return (
    <GlassSurface className="mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            First-Run Windows Setup
          </div>
          <h2 className="mt-0.5 text-xs font-semibold text-white">
            3 Quick Checks Before Your Next Ranked Queue
          </h2>
        </div>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          onClick={onDismiss}
          className="rounded-md p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 grid gap-2.5 md:grid-cols-3">
        <div className="lg-inset flex items-start gap-2.5 p-3 text-xs">
          {hasVerifiedKey ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-white">Riot API Key</div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {hasVerifiedKey
                ? 'Stored & ready for Match-V5 sync.'
                : 'Add your personal Riot key in Settings.'}
            </p>
            {!hasVerifiedKey && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-1.5 text-[11px] font-semibold text-emerald-300 hover:underline"
              >
                Open Settings
              </button>
            )}
          </div>
        </div>

        <div className="lg-inset flex items-start gap-2.5 p-3 text-xs">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
          <div className="min-w-0">
            <div className="font-medium text-white">League Video Mode</div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Set League of Legends Video Mode to <strong>Borderless</strong> or{' '}
              <strong>Windowed</strong> for click-through overlays.
            </p>
          </div>
        </div>

        <div className="lg-inset flex items-start gap-2.5 p-3 text-xs">
          {hasTestedHud ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-white">Test Click-Through HUD</div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Press <kbd className="font-mono text-slate-200">{overlayHotkey}</kbd> to toggle the HUD.
            </p>
            {!hasTestedHud && (
              <button
                type="button"
                onClick={onTestHud}
                className="mt-1.5 text-[11px] font-semibold text-emerald-300 hover:underline"
              >
                Preview HUD Now
              </button>
            )}
          </div>
        </div>
      </div>
    </GlassSurface>
  );
}
