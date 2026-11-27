import type { JungleRoute, WardSpot } from '../types/coaching';
import type { MapSide } from '../types/riot';
import { RiftMap } from './RiftMap';

interface SummonersRiftMapProps {
  mapSide: MapSide;
  patchVersion: string;
  route?: JungleRoute | null;
  wardSpots: WardSpot[];
  compact?: boolean;
}

export function SummonersRiftMap({
  mapSide,
  patchVersion,
  route,
  wardSpots,
  compact = false,
}: SummonersRiftMapProps) {
  return (
    <RiftMap
      mode="route"
      mapSide={mapSide}
      patchVersion={patchVersion}
      route={route}
      wardSpots={wardSpots}
      compact={compact}
    />
  );
}
