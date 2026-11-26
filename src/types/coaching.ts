import type { LaneRole, MapSide } from './riot';

export type DamageProfile = 'ad' | 'ap' | 'hybrid' | 'tank';

export type ChampionClass =
  | 'bruiser'
  | 'assassin'
  | 'tank'
  | 'skirmisher'
  | 'marksman'
  | 'mage'
  | 'support';

export type PowerSpike = 'early' | 'mid' | 'late';

export type MetaTier = 'S+' | 'S' | 'A' | 'B';

export interface RunePageSpec {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  selectedPerkIds: [number, number, number, number, number, number, number, number, number];
  summaryLabels: string[];
}

export interface JungleRouteStep {
  order: number;
  campId: string;
  campName: string;
  /** Normalized Summoner's Rift coordinate [0..1000] (0,0 = top-left, 1000,1000 = bottom-right) */
  x: number;
  y: number;
  targetTime: string;
  note: string;
}

export interface JungleRoute {
  id: string;
  label: string;
  side: MapSide;
  style: 'full_clear' | 'three_camp_gank' | 'invade';
  summary: string;
  steps: JungleRouteStep[];
}

export interface JungleChampionProfile {
  championId: number;
  key: string;
  name: string;
  metaTier: MetaTier;
  metaScore: number;
  damageProfile: DamageProfile;
  championClass: ChampionClass;
  engageScore: number; // 1..10
  hardCcScore: number; // 1..10
  frontlineScore: number; // 1..10
  powerSpike: PowerSpike;
  clearSpeed: 'fast' | 'medium' | 'slow';
  hasHeavyHealing?: boolean;
  strongIntoIds: number[];
  weakIntoIds: number[];
  synergizesWithIds: number[];
  recommendedSpells: [number, number]; // [spell1Id, spell2Id]
  recommendedRunes: RunePageSpec;
  coreItemIds: number[];
  situationalItemIds: number[];
  bootItemId: number;
  fullBuildBootReplacementId: number;
  preferredFirstClear: 'full_clear' | 'three_camp_gank';
}

export interface ChampionMetaEntry {
  championId: number;
  key: string;
  name: string;
  damageProfile: DamageProfile;
  championClass: ChampionClass;
  engageScore: number;
  hardCcScore: number;
  frontlineScore: number;
  powerSpike: PowerSpike;
  hasHeavyHealing?: boolean;
  volatileLane?: boolean;
}

export type ItemTag =
  | 'anti-heal'
  | 'mr'
  | 'armor'
  | 'anti-crit'
  | 'armor-pen'
  | 'magic-pen'
  | 'tenacity'
  | 'anti-burst'
  | 'boots'
  | 'trinket'
  | 'consumable'
  | 'elixir'
  | 'full-build-swap';

export interface ItemMetadata {
  id: number;
  name: string;
  cost: number;
  tags: ItemTag[];
  shortReason: string;
  buildsFromIds?: number[];
}

export interface TeamCompAnalysis {
  adScore: number;
  apScore: number;
  engageScore: number;
  ccScore: number;
  frontlineScore: number;
  earlyPower: number;
  latePower: number;
  archetype:
    | 'Front-to-Back Teamfight'
    | 'Dive & Pick'
    | 'Early Snowball'
    | 'Scaling Siege / Control'
    | 'Skirmish & Split-Push';
  gaps: string[];
  strengths: string[];
}

export interface ChampSelectRecommendation {
  champion: JungleChampionProfile;
  totalScore: number;
  breakdown: {
    meta: number;
    teamNeed: number;
    matchup: number;
    synergy: number;
    mastery: number;
  };
  reasons: string[];
  warnings: string[];
}

export interface WardSpot {
  id: string;
  label: string;
  kind: 'stealth' | 'control' | 'deep';
  phase: 'early' | 'objective' | 'mid_late';
  x: number;
  y: number;
  timing: string;
  reason: string;
}

export interface WinConditionPlan {
  allyAnalysis: TeamCompAnalysis;
  enemyAnalysis: TeamCompAnalysis;
  primaryWinCondition: string;
  enemyWinConditionToDeny: string;
  strongSide: 'top' | 'bot' | 'mid';
  weakSide: 'top' | 'bot';
  strongSideReason: string;
  phasePlaybook: {
    early: string;
    mid: string;
    late: string;
  };
  routes: JungleRoute[];
  recommendedRouteId: string;
  wardSpots: WardSpot[];
}

export interface ObjectiveWindow {
  id: string;
  name: string;
  status: 'upcoming' | 'prep_vision' | 'live' | 'slain';
  secondsRemaining: number;
  nextSpawnFormatted: string;
  priority: 'critical' | 'high' | 'medium';
  actionText: string;
}

export interface ThreatAssessment {
  healingThreat: boolean;
  apThreat: boolean;
  adThreat: boolean;
  critThreat: boolean;
  tankThreat: boolean;
  ccThreat: boolean;
  reasons: string[];
}

export interface ItemRecommendation {
  item: ItemMetadata;
  reason: string;
  affordableNow: boolean;
  goldNeeded: number;
  affordableComponents: ItemMetadata[];
}

export interface AdaptiveBuildPlan {
  threats: ThreatAssessment;
  nextItem: ItemRecommendation | null;
  upcomingQueue: ItemRecommendation[];
  trinketAdvice: {
    item: ItemMetadata;
    reason: string;
  };
  consumableAdvice: {
    item: ItemMetadata;
    reason: string;
  }[];
  isFullBuild: boolean;
  fullBuildAlternatives: {
    replaceTarget: string;
    recommendedItem: ItemMetadata;
    reason: string;
  }[];
}

export type MacroCategory = 'clear' | 'gank' | 'invade' | 'push' | 'objective' | 'vision';

export interface MacroCue {
  id: string;
  category: MacroCategory;
  priority: 'urgent' | 'high' | 'normal';
  title: string;
  detail: string;
}

export type OverlayMode = 'compact' | 'expanded';

export type DemoScenarioId =
  | 'idle'
  | 'champ_select'
  | 'loading'
  | 'in_game_early'
  | 'in_game_mid'
  | 'in_game_full_build';

export interface UserSettings {
  riotId: string;
  region: string;
  lolInstallPath: string;
  overlayHotkey: string;
  hudOpacity: number;
  targetDivision: string;
  hasApiKey: boolean;
}

export type ActiveTab = 'champ_select' | 'win_plan' | 'live_coach' | 'climb_m2' | 'settings';

export type LaneAssignmentMap = Partial<Record<LaneRole, number>>;
