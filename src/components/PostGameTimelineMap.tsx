import { useState } from 'react';
import type { NormalizedMapPoint, TimelineMapMarker } from '../types/coaching';
import { RiftMap } from './RiftMap';

interface PostGameTimelineMapProps {
  durationSeconds: number;
  patchVersion: string;
  pathPoints: NormalizedMapPoint[];
  enemyPathPoints?: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
  activeMinute?: number;
  onChangeMinute?: (minute: number) => void;
}

export function PostGameTimelineMap({
  durationSeconds,
  patchVersion,
  pathPoints,
  enemyPathPoints,
  markers,
  activeMinute,
  onChangeMinute,
}: PostGameTimelineMapProps) {
  const maxMinute = Math.max(1, Math.ceil(durationSeconds / 60));
  const [internalMinute, setInternalMinute] = useState<number>(maxMinute);

  const effectiveMinute = activeMinute ?? internalMinute;
  const handleMinuteChange = onChangeMinute ?? setInternalMinute;

  return (
    <RiftMap
      mode="replay"
      durationSeconds={durationSeconds}
      patchVersion={patchVersion}
      pathPoints={pathPoints}
      enemyPathPoints={enemyPathPoints}
      markers={markers}
      activeMinute={effectiveMinute}
      onChangeMinute={handleMinuteChange}
    />
  );
}
