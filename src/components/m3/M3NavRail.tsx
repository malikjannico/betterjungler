import type { ComponentType, ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { GamePhase } from '../../types/riot';
import { cx } from './cx';

export interface M3NavRailItem<T extends string> {
  id: T;
  label: string;
  /** Short label under the icon when the rail is collapsed (defaults to `label`). */
  shortLabel?: string;
  icon: ComponentType<{ className?: string }>;
  /** Shows the green "active match phase" dot on this destination. */
  live?: boolean;
}

export interface M3NavRailProps<T extends string> {
  items: ReadonlyArray<M3NavRailItem<T>>;
  /** Destinations pinned to the bottom of the rail (e.g. Settings). */
  bottomItems?: ReadonlyArray<M3NavRailItem<T>>;
  activeId: T;
  onSelect: (id: T) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Brand mark (always visible) + optional text shown when expanded. */
  brand?: ReactNode;
  brandText?: ReactNode;
  sectionLabel?: string;
  phase?: GamePhase;
  lcuConnected: boolean;
  liveClientConnected: boolean;
  /** Extra slot above the status block (e.g. update pill). */
  footer?: ReactNode;
  className?: string;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  idle: 'Idle',
  champ_select: 'Champ Select',
  loading: 'Loading',
  in_game: 'In Game',
  post_game: 'Post-Game',
};

function phaseDotClass(phase: GamePhase): string {
  switch (phase) {
    case 'in_game':
      return 'm3-dot m3-dot--on m3-dot--pulse';
    case 'champ_select':
    case 'loading':
      return 'm3-dot m3-dot--primary';
    case 'post_game':
      return 'm3-dot m3-dot--warning';
    default:
      return 'm3-dot';
  }
}

/** Collapsible M3 Expressive navigation rail (76px collapsed / 224px expanded). */
export function M3NavRail<T extends string>({
  items,
  bottomItems = [],
  activeId,
  onSelect,
  collapsed,
  onToggleCollapsed,
  brand,
  brandText,
  sectionLabel,
  phase = 'idle',
  lcuConnected,
  liveClientConnected,
  footer,
  className,
}: M3NavRailProps<T>) {
  const expanded = !collapsed;

  function renderDest(item: M3NavRailItem<T>) {
    const active = item.id === activeId;
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        aria-label={item.label}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={() => onSelect(item.id)}
        className="m3-rail__dest"
      >
        <span className="m3-rail__ind">
          <Icon className="shrink-0" />
          <span className="m3-rail__ind-label m3-label-l font-semibold">{item.label}</span>
          {item.live && <span title="Active match phase" className="m3-rail__live" />}
        </span>
        <span className="m3-rail__dest-label">{item.shortLabel ?? item.label}</span>
      </button>
    );
  }

  const lcuLabel = lcuConnected ? 'Ready' : 'Standby';
  const liveLabel = liveClientConnected ? 'Active' : 'Standby';

  return (
    <nav
      aria-label="Primary navigation"
      data-expanded={expanded ? 'true' : 'false'}
      className={cx('m3-rail', className)}
    >
      <div className="m3-rail__head">
        <div className="m3-rail__brand" data-tauri-drag-region>
          {brand && <span className="pointer-events-none flex shrink-0">{brand}</span>}
          {expanded && brandText && (
            <span className="pointer-events-none min-w-0 truncate">{brandText}</span>
          )}
        </div>
        <button
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={expanded}
          title={`${collapsed ? 'Expand' : 'Collapse'} navigation (Ctrl+B)`}
          onClick={onToggleCollapsed}
          className="m3-icon-btn m3-state"
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>

      <div
        className={cx('mb-2 flex items-center gap-2 m3-label-m m3-muted', expanded ? 'px-6' : 'justify-center')}
        title={`Phase: ${PHASE_LABELS[phase]}`}
      >
        <span className={phaseDotClass(phase)} />
        {expanded && <span className="truncate">{PHASE_LABELS[phase]}</span>}
      </div>

      {expanded && sectionLabel && <div className="m3-rail__section m3-label-m">{sectionLabel}</div>}
      <div className="m3-rail__dests">{items.map(renderDest)}</div>

      <div className="m3-rail__bottom">
        {bottomItems.length > 0 && <div className="m3-rail__dests">{bottomItems.map(renderDest)}</div>}
        {footer && <div className={expanded ? 'px-3' : 'flex justify-center'}>{footer}</div>}

        <div className="m3-rail__status m3-body-s m3-muted">
          {collapsed ? (
            <>
              <span
                title={`League Client: ${lcuLabel}`}
                aria-label={`League Client: ${lcuLabel}`}
                role="img"
                className={cx('m3-dot', lcuConnected && 'm3-dot--on')}
              />
              <span
                title={`Live Match: ${liveLabel}`}
                aria-label={`Live Match: ${liveLabel}`}
                role="img"
                className={cx('m3-dot', liveClientConnected && 'm3-dot--on m3-dot--pulse')}
              />
            </>
          ) : (
            <>
              <div className="m3-rail__status-row">
                <span className="inline-flex items-center gap-2">
                  <span className={cx('m3-dot', lcuConnected && 'm3-dot--on')} />
                  League Client
                </span>
                <span className="m3-faint">{lcuLabel}</span>
              </div>
              <div className="m3-rail__status-row">
                <span className="inline-flex items-center gap-2">
                  <span className={cx('m3-dot', liveClientConnected && 'm3-dot--on m3-dot--pulse')} />
                  Live Match
                </span>
                <span className="m3-faint">{liveLabel}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
