import type { ReactNode } from 'react';
import { cx } from './cx';

export interface M3SegmentedOption<T extends string> {
  value: T;
  label: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface M3SegmentedButtonProps<T extends string> {
  options: ReadonlyArray<M3SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the container width. */
  fullWidth?: boolean;
  className?: string;
}

/** M3 Expressive connected button group (single-select). */
export function M3SegmentedButton<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  fullWidth = false,
  className,
}: M3SegmentedButtonProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cx('m3-seg', size === 'sm' && 'm3-seg--sm', fullWidth && 'm3-seg--full', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            className="m3-seg__btn m3-state"
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
            {option.badge !== undefined && <span className="m3-seg__badge">{option.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
