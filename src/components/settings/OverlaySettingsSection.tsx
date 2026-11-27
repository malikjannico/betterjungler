import { useId } from 'react';
import { CircleCheck, Lock, LockOpen, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { DEFAULT_HUD_WIDGETS, sanitizeHudWidgetsClient } from '../../services/tauriBridge';
import type {
  HudCorner,
  HudMonitorTarget,
  HudScalePercent,
  HudWidgetId,
  HudWidgetMap,
  MinimapSide,
  OverlayHotkeyPreset,
  UserSettings,
} from '../../types/coaching';
import { M3Button, M3Chip, M3SegmentedButton, cx } from '../m3';
import {
  SEG_CONTRAST_CLASS,
  SETTINGS_FIELD_CLASS,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
} from './AccountSettingsSection';

export type OverlayPatch = Partial<
  Pick<UserSettings, 'hudCorner' | 'overlayHotkey' | 'hudOpacity' | 'hudScale' | 'hudMonitor' | 'minimapSide'>
>;

export const HUD_CORNERS: Array<{ value: HudCorner; label: string }> = [
  { value: 'beside-minimap', label: 'Beside Minimap (LoL Safe)' },
  { value: 'top-right', label: 'Top-Right' },
  { value: 'top-left', label: 'Top-Left' },
  { value: 'bottom-right', label: 'Bottom-Right' },
  { value: 'bottom-left', label: 'Bottom-Left' },
];

const HOTKEY_PRESETS: OverlayHotkeyPreset[] = ['Alt+J', 'Alt+B', 'Ctrl+Shift+J', 'F8'];

const HUD_SCALE_OPTIONS: ReadonlyArray<{ value: `${HudScalePercent}`; label: string; title: string }> = [
  { value: '100', label: '100%', title: 'Standard (1080p)' },
  { value: '125', label: '125%', title: '1440p Comfortable' },
  { value: '150', label: '150%', title: 'Large / High-DPI' },
];

const RECOMMENDED_LOL_HUD: Array<{ setting: string; value: string; why: string }> = [
  {
    setting: 'Video → Window Mode',
    value: 'Borderless',
    why: 'Exclusive Fullscreen hides desktop overlays.',
  },
  {
    setting: 'Interface → HUD Scale',
    value: '≤ 50 (35 – 50)',
    why: 'Prevents the bottom bar from overlapping the Compact HUD.',
  },
  {
    setting: 'Interface → Minimap Scale',
    value: '100 (min. 50)',
    why: 'Leaves click-through room beside the minimap; sync Minimap Side above.',
  },
  {
    setting: 'Interface → Show Timestamps',
    value: 'ON',
    why: 'Chat timestamps make summoner spell & objective tracking easy.',
  },
  {
    setting: 'Interface → Colorblind Mode',
    value: 'Optional',
    why: 'Compact HUD tones stay readable with League colorblind mode on or off.',
  },
];

const HUD_WIDGET_TOGGLES: ReadonlyArray<{ id: HudWidgetId; name: string; detail: string }> = [
  { id: 'objectives', name: 'Objective Timers', detail: 'Dragon, Voidgrubs, Herald & Baron timers.' },
  { id: 'build', name: 'Next Item & Gold', detail: 'Recommended next item & gold needed.' },
  { id: 'cs', name: 'CS / min vs Target', detail: 'Live CS/min pace compared to division target.' },
  { id: 'skillOrder', name: 'Skill Order', detail: 'Highlights which ability (Q/W/E/R) to level next.' },
  { id: 'gamePlan', name: 'Lv2 Plan & Spikes', detail: 'Early Lv2 wave/route plan, macro phase & spikes.' },
  { id: 'cue', name: 'Tactical Macro Cues', detail: 'Urgent objective setup & wave alerts.' },
];

export interface OverlaySettingsSectionProps {
  draft: UserSettings;
  isTauri: boolean;
  hudLocked: boolean;
  customHudCoords: { x: number; y: number } | null;
  onOverlayPatch: (patch: OverlayPatch, persistNow?: boolean) => void;
  onToggleHudLock: () => void;
  onResetHudPosition: () => void;
  onSaveHudWidgets?: (widgets: HudWidgetMap) => void;
  onResetHudWidgets?: () => void;
}

export function OverlaySettingsSection({
  draft,
  isTauri,
  hudLocked,
  customHudCoords,
  onOverlayPatch,
  onToggleHudLock,
  onResetHudPosition,
  onSaveHudWidgets,
  onResetHudWidgets,
}: OverlaySettingsSectionProps) {
  const ids = useId();
  const cornerId = `${ids}-corner`;
  const hotkeyId = `${ids}-hotkey`;
  const monitorId = `${ids}-monitor`;
  const opacityId = `${ids}-opacity`;
  const cornerLabel = HUD_CORNERS.find((c) => c.value === draft.hudCorner)?.label ?? draft.hudCorner;
  const opacity = Math.max(70, draft.hudOpacity);
  const opacityPct = ((opacity - 70) / 30) * 100;
  const activeWidgets = sanitizeHudWidgetsClient(draft.hudWidgets ?? DEFAULT_HUD_WIDGETS);

  function toggleWidget(id: HudWidgetId) {
    const next: HudWidgetMap = {
      ...activeWidgets,
      [id]: {
        ...activeWidgets[id],
        enabled: !activeWidgets[id].enabled,
      },
    };
    onSaveHudWidgets?.(next);
  }

  return (
    <div className="space-y-3">
      <SettingsGroup
        title="Compact HUD Position & Drag Controls"
        description="Changes apply immediately in-game — no save needed."
        aside={
          hudLocked ? (
            <M3Chip tone="success" size="sm" icon={<Lock aria-hidden />} label="Locked · click-through" />
          ) : (
            <M3Chip tone="warning" size="sm" icon={<LockOpen aria-hidden />} label="Unlocked · dragging" />
          )
        }
      >
        <div className="grid items-center gap-5 px-4 py-3.5 md:grid-cols-[168px_minmax(0,1fr)_auto]">
          {/* Mini preview of HUD vs. minimap placement */}
          <div
            aria-hidden
            className="relative h-24 overflow-hidden rounded-[12px] bg-[linear-gradient(160deg,#1b2a22,#0f1712_60%,#142019)] shadow-[inset_0_0_0_1px_var(--md-sys-color-outline-variant)]"
          >
            <span
              className={cx(
                'absolute bottom-1.5 h-[38px] w-[38px] rounded bg-[#1f3b2a] shadow-[inset_0_0_0_1px_#3d6b4f]',
                (draft.minimapSide ?? 'right') === 'left' ? 'left-1.5' : 'right-1.5'
              )}
            />
            <span className="absolute bottom-1 left-1/2 -ml-7 h-2.5 w-14 rounded-[3px] bg-[#2d3b33]" />
            <span
              className={cx(
                'absolute h-[22px] w-[46px] rounded-md transition-all duration-500',
                hudLocked
                  ? 'bg-[var(--md-sys-color-primary)] opacity-90'
                  : 'bg-[var(--md-ext-warning)] shadow-[0_0_0_2px_var(--md-ext-warning),0_0_0_6px_rgba(243,192,107,0.25)]',
                customHudCoords || !hudLocked
                  ? 'bottom-11 right-[72px]'
                  : (draft.minimapSide ?? 'right') === 'left'
                    ? 'bottom-1.5 left-[50px]'
                    : 'bottom-1.5 right-[50px]'
              )}
            />
          </div>
          <div className="min-w-0">
            <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">HUD Drag Positioning</div>
            <p className="m3-body-s mt-0.5 text-[var(--md-sys-color-on-surface)] num">
              {customHudCoords
                ? `Custom position active (${customHudCoords.x}px, ${customHudCoords.y}px)`
                : `Using corner preset: ${cornerLabel}`}
            </p>
            <p className="m3-body-s m3-muted mt-1">
              Click <strong>Unlock HUD for Dragging</strong> (or use the system tray),{' '}
              <strong>left click-hold and drag</strong> the overlay anywhere on your monitor, then
              click <strong>Lock HUD Position</strong> so in-game clicks pass cleanly through.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
            <M3Button
              variant={hudLocked ? 'tonal' : 'filled'}
              size="sm"
              disabled={!isTauri}
              icon={hudLocked ? <LockOpen aria-hidden className="h-4 w-4" /> : <Lock aria-hidden className="h-4 w-4" />}
              onClick={onToggleHudLock}
              className={cx(
                !hudLocked &&
                  '!bg-[var(--md-ext-warning-container)] !text-[var(--md-ext-on-warning-container)]'
              )}
            >
              {hudLocked ? 'Unlock HUD for Dragging' : 'Lock HUD Position'}
            </M3Button>
            <M3Button
              variant="outlined"
              size="sm"
              disabled={!isTauri || !customHudCoords}
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
              onClick={onResetHudPosition}
            >
              Reset HUD Position
            </M3Button>
          </div>
        </div>

        <SettingsRow
          label="Compact HUD Corner"
          htmlFor={cornerId}
          description="Preset used when no custom drag position is saved."
        >
          <select
            id={cornerId}
            value={draft.hudCorner}
            onChange={(e) => onOverlayPatch({ hudCorner: e.target.value as HudCorner })}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-60')}
          >
            {HUD_CORNERS.map((c) => (
              <option key={c.value} value={c.value} className="bg-zinc-900">
                {c.label}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow
          label="Global Hotkey"
          htmlFor={hotkeyId}
          description="Show / hide the Compact HUD while in game."
        >
          <select
            id={hotkeyId}
            value={draft.overlayHotkey}
            onChange={(e) => onOverlayPatch({ overlayHotkey: e.target.value })}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-48')}
          >
            {HOTKEY_PRESETS.map((k) => (
              <option key={k} value={k} className="bg-zinc-900">
                {k}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Appearance">
        <SettingsRow label="HUD Scale" description="Use 125% on 1440p and 150% on high-DPI displays.">
          <M3SegmentedButton
            ariaLabel="HUD Scale"
            size="sm"
            className={SEG_CONTRAST_CLASS}
            options={HUD_SCALE_OPTIONS}
            value={`${draft.hudScale ?? 100}` as `${HudScalePercent}`}
            onChange={(value) => onOverlayPatch({ hudScale: Number(value) as HudScalePercent })}
          />
        </SettingsRow>

        <SettingsRow
          label="In-Game Minimap Side"
          description="Match your League setting so the HUD never covers the minimap."
        >
          <M3SegmentedButton<MinimapSide>
            ariaLabel="In-Game Minimap Side"
            size="sm"
            className={SEG_CONTRAST_CLASS}
            options={[
              { value: 'right', label: 'Right (Default)' },
              { value: 'left', label: 'Left (Flipped)' },
            ]}
            value={draft.minimapSide ?? 'right'}
            onChange={(value) => onOverlayPatch({ minimapSide: value })}
          />
        </SettingsRow>

        <SettingsRow
          label="HUD Monitor Target"
          htmlFor={monitorId}
          description="Where the transparent overlay is drawn."
        >
          <select
            id={monitorId}
            value={draft.hudMonitor ?? 'primary'}
            onChange={(e) => onOverlayPatch({ hudMonitor: e.target.value as HudMonitorTarget })}
            className={cx(SETTINGS_FIELD_CLASS, 'sm:w-60')}
          >
            <option value="primary" className="bg-zinc-900">
              Primary Display (League)
            </option>
            <option value="active" className="bg-zinc-900">
              Same Display as App
            </option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="HUD Opacity"
          htmlFor={opacityId}
          description="Minimum 70% keeps tips readable over Summoner's Rift."
        >
          <div className="flex min-w-[240px] items-center gap-3">
            <input
              id={opacityId}
              type="range"
              min={70}
              max={100}
              value={opacity}
              onChange={(e) => onOverlayPatch({ hudOpacity: Number(e.target.value) }, false)}
              onPointerUp={(e) => onOverlayPatch({ hudOpacity: Number(e.currentTarget.value) })}
              onKeyUp={(e) => onOverlayPatch({ hudOpacity: Number(e.currentTarget.value) })}
              style={{
                background: `linear-gradient(90deg, var(--md-sys-color-primary) 0 ${opacityPct}%, var(--md-sys-color-secondary-container) ${opacityPct}% 100%)`,
              }}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--md-sys-color-primary)]"
            />
            <output
              htmlFor={opacityId}
              className="m3-label-l w-11 text-right num text-[var(--md-sys-color-on-surface)]"
            >
              {draft.hudOpacity}%
            </output>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Modular HUD Widgets"
        description="Toggle individual widgets ON/OFF and click Unlock HUD for Dragging above to reposition each component independently."
        aside={
          onResetHudWidgets && (
            <M3Button
              size="sm"
              variant="text"
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
              onClick={onResetHudWidgets}
            >
              Reset Widget Layout
            </M3Button>
          )
        }
      >
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
          {HUD_WIDGET_TOGGLES.map((widget) => {
            const layout = activeWidgets[widget.id];
            return (
              <button
                key={widget.id}
                type="button"
                role="switch"
                aria-checked={layout.enabled}
                onClick={() => toggleWidget(widget.id)}
                className={cx(
                  'm3-focus-ring flex items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition',
                  layout.enabled
                    ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]'
                    : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface-variant)] opacity-80'
                )}
              >
                <div className="min-w-0">
                  <div className="m3-title-s truncate">{widget.name}</div>
                  <div className="m3-body-s m3-muted truncate">{widget.detail}</div>
                </div>
                <span
                  className={cx(
                    'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                    layout.enabled
                      ? 'bg-[var(--md-ext-success-container)] text-[var(--md-ext-on-success-container)]'
                      : 'bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]'
                  )}
                >
                  {layout.enabled ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Recommended In-Game League HUD Settings"
        description="Set these in the League client so the Compact HUD stays visible and click-through."
      >
        <ul className="grid gap-2 px-2 pb-2 pt-1.5 sm:grid-cols-2">
          {RECOMMENDED_LOL_HUD.map((item) => (
            <li
              key={item.setting}
              className="flex items-start gap-2.5 rounded-[12px] bg-[var(--md-sys-color-surface-container-high)] px-3 py-2.5"
            >
              {item.value === 'Optional' ? (
                <TriangleAlert aria-hidden className="mt-0.5 h-[18px] w-[18px] flex-none text-[var(--md-ext-warning)]" />
              ) : (
                <CircleCheck aria-hidden className="mt-0.5 h-[18px] w-[18px] flex-none text-[var(--md-ext-success)]" />
              )}
              <div className="min-w-0">
                <div className="m3-title-s text-[var(--md-sys-color-on-surface)]">
                  {item.setting}: <span className="text-[var(--md-ext-success)]">{item.value}</span>
                </div>
                <div className="m3-body-s m3-muted">{item.why}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="px-4 py-3">
          <SettingsNotice tone="info">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <ShieldCheck aria-hidden className="h-4 w-4 text-[var(--md-ext-success)]" />
              Riot Policy Compliant:
            </span>{' '}
            Official APIs + LCU Champ Select read/manual apply + Live Client Data (127.0.0.1:2999).
            No memory reading, no enemy cooldown tracking, and Solo/Duo anonymity enforced.
          </SettingsNotice>
        </div>
      </SettingsGroup>
    </div>
  );
}
