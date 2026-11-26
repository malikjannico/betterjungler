import { useState } from 'react';
import { getOfficialMapUrl } from '../services/ddragonService';

interface OfficialRiftMapBaseProps {
  patchVersion: string;
}

/**
 * Renders Riot's official Summoner's Rift (Map 11) image inside SVG [0..1000],
 * applying #rift-desat contrast attenuation and offline /map11.png fallback.
 */
export function OfficialRiftMapBase({ patchVersion }: OfficialRiftMapBaseProps) {
  const [useLocalFallback, setUseLocalFallback] = useState(false);
  const href = useLocalFallback ? '/map11.png' : getOfficialMapUrl(patchVersion);

  return (
    <>
      <rect width="1000" height="1000" fill="#080b11" />
      <image
        href={href}
        x="0"
        y="0"
        width="1000"
        height="1000"
        preserveAspectRatio="xMidYMid slice"
        filter="url(#rift-desat)"
        onError={() => {
          if (!useLocalFallback) setUseLocalFallback(true);
        }}
      />
      <rect width="1000" height="1000" fill="rgba(7, 10, 16, 0.22)" />
    </>
  );
}
