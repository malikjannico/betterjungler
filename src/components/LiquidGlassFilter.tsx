/**
 * Global non-visual SVG filters for:
 * 1) #lg-lens: Subtle refractive displacement on floating .mat-glass/.mat-lens pills & toolbars
 * 2) #rift-desat: Desaturated tactical contrast treatment for the Summoner's Rift base map
 */
export function LiquidGlassFilter() {
  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      className="pointer-events-none fixed h-0 w-0 overflow-hidden"
    >
      <defs>
        <filter
          id="lg-lens"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.012"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2.5" result="smoothNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smoothNoise"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>

        <filter id="rift-desat" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0.46" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.72" />
            <feFuncG type="linear" slope="0.74" />
            <feFuncB type="linear" slope="0.78" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
