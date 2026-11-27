export interface UpdateWingetManifestsOptions {
  version: string;
  sha256: string;
  url?: string;
  manifestDir?: string;
}

export interface UpdateWingetManifestsResult {
  version: string;
  sha256: string;
  installerUrl: string;
  files: string[];
}

export function updateWingetManifests(
  options: UpdateWingetManifestsOptions
): UpdateWingetManifestsResult;
