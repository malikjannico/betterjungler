import { useState } from 'react';
import { Crosshair, Trees } from 'lucide-react';
import { saveSettings } from '../../services/tauriBridge';
import type { CoachedRole, UserSettings } from '../../types/coaching';
import { M3Chip, M3SegmentedButton, type M3SegmentedOption } from '../m3';
import {
  SEG_CONTRAST_CLASS,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSwitch,
  type SettingsNotifier,
} from './AccountSettingsSection';

type PrimaryRoleOption = CoachedRole | 'top' | 'mid' | 'support';
type SecondaryRoleOption = CoachedRole | 'none';

export const ROLE_LABELS: Record<CoachedRole, string> = {
  jungle: 'Jungle',
  bottom: 'ADC',
};

const COMING_LATER = 'Coming later · Global objectives only in live HUD';

const PRIMARY_OPTIONS: ReadonlyArray<M3SegmentedOption<PrimaryRoleOption>> = [
  { value: 'jungle', label: 'Jungle', icon: <Trees aria-hidden /> },
  { value: 'bottom', label: 'ADC', icon: <Crosshair aria-hidden /> },
  { value: 'top', label: 'Top', disabled: true, title: COMING_LATER },
  { value: 'mid', label: 'Mid', disabled: true, title: COMING_LATER },
  { value: 'support', label: 'Support', disabled: true, title: COMING_LATER },
];

/** Category-list summary, e.g. "Jungle Primary · ADC Secondary". */
export function describeRoles(settings: UserSettings): string {
  const primary = settings.primaryRole ?? 'jungle';
  const secondary = settings.secondaryRole;
  const base = `${ROLE_LABELS[primary]} Primary`;
  return secondary && secondary !== primary ? `${base} · ${ROLE_LABELS[secondary]} Secondary` : base;
}

export interface RolesSettingsSectionProps {
  settings: UserSettings;
  notify: SettingsNotifier;
  onSettingsChanged: (next: UserSettings) => void;
}

export function RolesSettingsSection({ settings, notify, onSettingsChanged }: RolesSettingsSectionProps) {
  const [saving, setSaving] = useState(false);
  const primaryRole: CoachedRole = settings.primaryRole ?? 'jungle';
  const secondaryRole: CoachedRole | undefined =
    settings.secondaryRole && settings.secondaryRole !== primaryRole ? settings.secondaryRole : undefined;
  const autoDetectRole = settings.autoDetectRole !== false;

  /** Role choices apply instantly (like overlay prefs); optimistic with rollback on failure. */
  function persist(patch: {
    primaryRole: CoachedRole;
    secondaryRole: CoachedRole | undefined;
    autoDetectRole: boolean;
  }) {
    const previous = settings;
    const next: UserSettings = { ...settings, ...patch };
    notify.clear();
    setSaving(true);
    onSettingsChanged(next);
    void saveSettings(next)
      .then(() => {
        notify.status('Role preferences saved.');
      })
      .catch((err) => {
        onSettingsChanged(previous);
        notify.error(err instanceof Error ? err.message : 'Failed to save role preferences.');
      })
      .finally(() => setSaving(false));
  }

  const secondaryOptions: ReadonlyArray<M3SegmentedOption<SecondaryRoleOption>> = [
    { value: 'none', label: 'None' },
    {
      value: 'jungle',
      label: 'Jungle',
      icon: <Trees aria-hidden />,
      disabled: primaryRole === 'jungle',
      title: primaryRole === 'jungle' ? 'Already your primary role' : undefined,
    },
    {
      value: 'bottom',
      label: 'ADC',
      icon: <Crosshair aria-hidden />,
      disabled: primaryRole === 'bottom',
      title: primaryRole === 'bottom' ? 'Already your primary role' : undefined,
    },
  ];

  return (
    <div className="space-y-3">
      <SettingsGroup
        title="Coached Roles"
        description="BetterJungler deep-coaches Jungle and ADC. Changes apply instantly."
        aside={
          <M3Chip
            tone="primary"
            size="sm"
            label={saving ? 'Saving…' : describeRoles({ ...settings, secondaryRole })}
          />
        }
      >
        <SettingsRow
          label="Primary Role"
          description="Default coaching pack, KPIs and benchmarks."
          stacked
        >
          <M3SegmentedButton<PrimaryRoleOption>
            ariaLabel="Primary Role"
            options={PRIMARY_OPTIONS}
            value={primaryRole}
            className={SEG_CONTRAST_CLASS}
            onChange={(value) => {
              if (value !== 'jungle' && value !== 'bottom') return;
              // Picking the current secondary as primary swaps the two.
              const nextSecondary =
                secondaryRole === value ? primaryRole : secondaryRole;
              persist({ primaryRole: value, secondaryRole: nextSecondary, autoDetectRole });
            }}
          />
          <p className="m3-body-s m3-muted">
            Top, Mid &amp; Support: {COMING_LATER}.
          </p>
        </SettingsRow>

        <SettingsRow
          label="Secondary Role"
          description="Used when you are filled or swap roles in Champ Select."
          stacked
        >
          <M3SegmentedButton<SecondaryRoleOption>
            ariaLabel="Secondary Role"
            options={secondaryOptions}
            value={secondaryRole ?? 'none'}
            className={SEG_CONTRAST_CLASS}
            onChange={(value) =>
              persist({
                primaryRole,
                secondaryRole: value === 'none' ? undefined : value,
                autoDetectRole,
              })
            }
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Detection">
        <SettingsRow
          label="Auto-detect role from Champ Select & Live Game"
          description="Reads your assigned position via the LCU / Live Client Data and switches the coaching pack automatically. Off-role games fall back to global objective tips."
        >
          <SettingsSwitch
            ariaLabel="Auto-detect role from Champ Select & Live Game"
            checked={autoDetectRole}
            onChange={(next) => persist({ primaryRole, secondaryRole, autoDetectRole: next })}
          />
        </SettingsRow>
        {!autoDetectRole && (
          <div className="px-2 pb-2">
            <SettingsNotice tone="info">
              Manual mode: the {ROLE_LABELS[primaryRole]} coaching pack is used for every game
              until you switch roles here.
            </SettingsNotice>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
