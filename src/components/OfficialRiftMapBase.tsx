import { useState } from 'react';
import { getOfficialMapUrl } from '../services/ddragonService';

interface OfficialRiftMapBaseProps {
  patchVersion: string;
}

/**
 * Renders Riot's official Summoner's Rift (Map 11) image inside the SVG coordinate space [0..1000],
 * falling back seamlessly to the local bundled /map11.png if offline or blocked.
 */
export function OfficialRiftMapBase({ patchVersion }: OfficialRiftMapBaseProps) {
  const [useLocalFallback, setUseLocalFallback] = useState(false);
  const href = useLocalFallback ? '/map11.png' : getOfficialMapUrl(patchVersion);

  return (
    <>
      <rect width="1000" height="1000" fill="#090d14" />
      <image
        href={href}
        x="0"
        y="0"
        width="1000"
        height="1000"
        preserveAspectRatio="xMidYMid slice"
        onError={() => {
          if (!useLocalFallback) setUseLocalFallback(true);
        }}
      />
      {/* Subtle dark scrim so white/colored tactical overlays remain razor sharp */}
      <rect width="1000" height="1000" fill="rgba(7, 10, 16, 0.28)" />
    </>
  );
}
