interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Bold filled Jungle Crest brand mark on a solid deep-navy plate.
 */
export function BrandMark({ size = 26, className = '' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <rect
        x="2.5"
        y="2.5"
        width="59"
        height="59"
        rx="14"
        fill="#0B1220"
        stroke="#1E293B"
        strokeWidth="2.5"
      />
      <polygon points="32,10 52,28 41,54 32,46 23,54 12,28" fill="#10B981" />
      <polygon points="32,16 43,29 32,42 21,29" fill="#F8FAFC" />
      <polygon points="32,23 36.5,29 32,35 27.5,29" fill="#059669" />
    </svg>
  );
}
