export type CoachedRole = 'jungle' | 'bottom';
export type OffRole = 'top' | 'middle' | 'utility';
export type PlayedRole = CoachedRole | OffRole;

export interface RoleCapabilities {
  champSelectPicks: boolean;
  winPlan: boolean;
  liveItemization: boolean;
  liveMacro: boolean;
  postGameGrade: boolean;
  climbBenchmarks: boolean;
  mistakeDetectors: boolean;
}

const COACHED_CAPABILITIES: RoleCapabilities = {
  champSelectPicks: true,
  winPlan: true,
  liveItemization: true,
  liveMacro: true,
  postGameGrade: true,
  climbBenchmarks: true,
  mistakeDetectors: true,
};

const OFF_ROLE_CAPABILITIES: RoleCapabilities = {
  champSelectPicks: false,
  winPlan: false,
  liveItemization: false,
  liveMacro: false,
  postGameGrade: false,
  climbBenchmarks: false,
  mistakeDetectors: false,
};

export function normalizePlayedRole(raw?: string | null): PlayedRole | null {
  if (!raw) return null;
  switch (raw.trim().toUpperCase()) {
    case 'JUNGLE':
      return 'jungle';
    case 'BOTTOM':
    case 'BOT':
    case 'ADC':
      return 'bottom';
    case 'TOP':
      return 'top';
    case 'MIDDLE':
    case 'MID':
      return 'middle';
    case 'UTILITY':
    case 'SUPPORT':
      return 'utility';
    default:
      return null;
  }
}

export function isCoachedRole(role: PlayedRole | null | undefined): role is CoachedRole {
  return role === 'jungle' || role === 'bottom';
}

export function getRoleCapabilities(role: PlayedRole | null | undefined): RoleCapabilities {
  return isCoachedRole(role) ? COACHED_CAPABILITIES : OFF_ROLE_CAPABILITIES;
}

export function formatCoachedRoleLabel(role: CoachedRole): string {
  return role === 'bottom' ? 'ADC' : 'Jungle';
}
