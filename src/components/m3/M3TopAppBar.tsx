import type { ReactNode, Ref } from 'react';
import { Copy, Minus, SlidersHorizontal, Square, X } from 'lucide-react';
import { formatClock } from '../../domain/liveCoachEngine';
import type { MapSide } from '../../types/riot';
import { M3Chip } from './M3Chip';
import { SummonerProfilePill, TopBarPill } from './TopBarPill';
import type { SummonerProfilePillProps } from './TopBarPill';

export interface M3TopAppBarProps {
  /** Active view title. */
  title: string;
  /** Champion / role context badge (rendered only when a champion is known). */
  championName?: string | null;
  championIconUrl?: string | null;
  roleLabel?: string | null;
  mapSide?: MapSide | null;

  /** Elapsed recording seconds; `null`/`undefined` hides the REC pill. */
  recordingElapsedSec?: number | null;

  /** Active simulation scenario label; hides the pill when empty. */
  simulationLabel?: string | null;
  onExitSimulation?: () => void;

  /** Simulator popover trigger. Omit `onToggleSimulator` to hide the pill. */
  onToggleSimulator?: () => void;
  simulatorOpen?: boolean;
  simulatorActive?: boolean;
  simulatorButtonRef?: Ref<HTMLButtonElement>;

  /** Compact HUD toggle. Omit `onToggleHud` to hide the pill. */
  onToggleHud?: () => void;
  hudVisible?: boolean;
  hudHotkey?: string;

  /** Summoner profile pill; omit/null to hide. */
  profile?: SummonerProfilePillProps | null;

  /** Extra pills appended before the profile pill. */
  actions?: ReactNode;

  /** Renders Tauri window controls (minimize / maximize / close). */
  showWindowControls?: boolean;
  isMaximized?: boolean;
  className?: string;
}

async function withCurrentWindow(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    else if (action === 'toggleMaximize') await win.toggleMaximize();
    else await win.close();
  } catch (err) {
    console.warn(`[M3TopAppBar] window ${action} failed`, err);
  }
}

/** 48px draggable M3 top app bar with unified 32px action pills. */
export function M3TopAppBar({
  title,
  championName,
  championIconUrl,
  roleLabel,
  mapSide,
  recordingElapsedSec,
  simulationLabel,
  onExitSimulation,
  onToggleSimulator,
  simulatorOpen = false,
  simulatorActive = false,
  simulatorButtonRef,
  onToggleHud,
  hudVisible = false,
  hudHotkey,
  profile,
  actions,
  showWindowControls = false,
  isMaximized = false,
  className,
}: M3TopAppBarProps) {
  const contextParts = [roleLabel, mapSide ? (mapSide === 'blue' ? 'Blue side' : 'Red side') : null].filter(
    (part): part is string => Boolean(part)
  );

  return (
    <header data-tauri-drag-region className={`m3-topbar ${className ?? ''}`}>
      <div className="m3-topbar__title" data-tauri-drag-region>
        <h1 className="m3-title-l truncate">{title}</h1>
        {championName && (
          <M3Chip
            tone="plain"
            size="sm"
            className="min-w-0 shrink"
            icon={
              championIconUrl ? (
                <img
                  src={championIconUrl}
                  alt=""
                  width={18}
                  height={18}
                  draggable={false}
                  className="-ml-1.5 h-[18px] w-[18px] shrink-0 rounded-full object-cover"
                />
              ) : undefined
            }
          >
            <span className="truncate">
              {championName}
              {contextParts.length > 0 && <span className="m3-faint"> · {contextParts.join(' · ')}</span>}
            </span>
          </M3Chip>
        )}
      </div>

      <div className="m3-topbar__actions">
        {typeof recordingElapsedSec === 'number' && (
          <TopBarPill
            tone="error"
            leading={<span className="m3-dot m3-dot--rec" />}
            title="Opt-in League HWND GPU recording active"
            ariaLabel="Recording"
            className="num"
          >
            REC {formatClock(recordingElapsedSec)}
          </TopBarPill>
        )}

        {simulationLabel && (
          <TopBarPill tone="warning" title={`Simulation · ${simulationLabel}`}>
            <span className="max-w-[180px] truncate">Simulation · {simulationLabel}</span>
            {onExitSimulation && (
              <button
                type="button"
                onClick={onExitSimulation}
                className="m3-focus-ring -mr-1 rounded-full px-1.5 font-bold underline-offset-2 hover:underline"
              >
                Exit
              </button>
            )}
          </TopBarPill>
        )}

        {onToggleSimulator && (
          <TopBarPill
            ref={simulatorButtonRef}
            tone={simulatorOpen ? 'selected' : simulatorActive ? 'warning' : 'neutral'}
            leading={<SlidersHorizontal className="h-3.5 w-3.5" />}
            onClick={onToggleSimulator}
            ariaExpanded={simulatorOpen}
            title="Preview simulated match scenarios (Ctrl+K)"
          >
            Simulator
          </TopBarPill>
        )}

        {onToggleHud && (
          <TopBarPill
            tone={hudVisible ? 'primary' : 'neutral'}
            onClick={onToggleHud}
            ariaPressed={hudVisible}
            title={hudVisible ? 'Hide compact HUD' : 'Show compact HUD'}
            trailing={hudHotkey ? <kbd>{hudHotkey}</kbd> : undefined}
          >
            {hudVisible ? 'Hide HUD' : 'Compact HUD'}
          </TopBarPill>
        )}

        {actions}

        {profile && <SummonerProfilePill {...profile} />}

        {showWindowControls && (
          <div className="m3-topbar__window">
            <button
              type="button"
              aria-label="Minimize window"
              title="Minimize"
              onClick={() => void withCurrentWindow('minimize')}
              className="m3-icon-btn m3-state"
            >
              <Minus />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              title={isMaximized ? 'Restore' : 'Maximize'}
              onClick={() => void withCurrentWindow('toggleMaximize')}
              className="m3-icon-btn m3-state"
            >
              {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
            </button>
            <button
              type="button"
              aria-label="Close window"
              title="Close"
              onClick={() => void withCurrentWindow('close')}
              className="m3-icon-btn m3-icon-btn--danger m3-state"
            >
              <X />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
