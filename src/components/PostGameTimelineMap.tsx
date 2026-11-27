import { useState } from 'react';
import type { NormalizedMapPoint, TimelineMapMarker } from '../types/coaching';
import { RiftMap } from './RiftMap';

interface PostGameTimelineMapProps {
  durationSeconds: number;
  patchVersion: string;
  pathPoints: NormalizedMapPoint[];
  enemyPathPoints?: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
  activeSecond?: number;
  onChangeSecond?: (second: number) => void;
}

export function PostGameTimelineMap({
  durationSeconds,
  patchVersion,
  pathPoints,
  enemyPathPoints,
  markers,
  activeSecond,
  onChangeSecond,
}: PostGameTimelineMapProps) {
  const [internalSecond, setInternalSecond] = useState<number>(durationSeconds);

  const effectiveSecond = activeSecond ?? internalSecond;
  const handleSecondChange = onChangeSecond ?? setInternalSecond;

  return (
    <RiftMap
      mode="replay"
      durationSeconds={durationSeconds}
      patchVersion={patchVersion}
      pathPoints={pathPoints}
      enemyPathPoints={enemyPathPoints}
      markers={markers}
      activeSecond={effectiveSecond}
      onChangeSecond={handleSecondChange}
    />
  );
}
