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

export type JungleRouteStage =
  | 'clear_1'
  | 'clear_2'
  | 'objective_sync'
  | 'late_baron';

export interface JungleRoute {
  id: string;
  label: string;
  side: MapSide;
  stage: JungleRouteStage;
  stageLabel: string;
  timeWindow: string;
  whyThisClear: string;
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

export interface EnemyJunglePlaybook {
  enemyChampionName: string;
  expectedStart: string;
  wardTarget115: string;
  invadeRisk: 'low' | 'medium' | 'high';
  counterPlan: string;
}

export interface LaneGankabilityRow {
  lane: 'top' | 'middle' | 'bottom';
  allyLabel: string;
  enemyLabel: string;
  priorityScore: number;
  verdict: 'Strong Side' | 'Playable' | 'Weak Side';
  tip: string;
}

export interface SmiteTierStatus {
  tierName: 'Base' | 'Unleashed' | 'Primal';
  damage: 600 | 900 | 1200;
  estimatedStacksRemaining: number;
  note: string;
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
  enemyJunglePlaybook: EnemyJunglePlaybook;
  laneGankability: LaneGankabilityRow[];
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

export type AiProvider = 'off' | 'gemini' | 'openai' | 'ollama';

export type HudCorner =
  | 'beside-minimap'
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export type OverlayHotkeyPreset = 'Alt+J' | 'Alt+B' | 'Ctrl+Shift+J' | 'F8';
export type HudScalePercent = 100 | 125 | 150;
export type HudMonitorTarget = 'primary' | 'active';
export type MinimapSide = 'right' | 'left';

export interface AiCoachConfig {
  provider: AiProvider;
  model: string;
  endpoint: string;
  hasApiKey: boolean;
}

export interface UserSettings {
  riotId: string;
  region: string;
  lolInstallPath: string;
  overlayHotkey: OverlayHotkeyPreset | string;
  hudCorner: HudCorner;
  hudOpacity: number;
  hudScale?: HudScalePercent;
  hudMonitor?: HudMonitorTarget;
  minimapSide?: MinimapSide;
  windowWidth?: number | null;
  windowHeight?: number | null;
  windowX?: number | null;
  windowY?: number | null;
  targetDivision: string;
  hasApiKey: boolean;
  aiCoach: AiCoachConfig;
}

export interface LpHistoryPoint {
  timestamp: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  absoluteLp: number;
  win: boolean;
  matchId?: string;
}

export interface DdragonChampionLite {
  id: number;
  key: string;
  name: string;
  tags: string[];
}

export interface DdragonItemLite {
  id: number;
  name: string;
  cost: number;
}

export interface DdragonHydratedCatalog {
  patch: string;
  championsById: Record<number, DdragonChampionLite>;
  itemsById: Record<number, DdragonItemLite>;
}

export type ActiveTab =
  | 'champ_select'
  | 'win_plan'
  | 'live_coach'
  | 'post_game'
  | 'climb_goals'
  | 'settings';

export type LaneAssignmentMap = Partial<Record<LaneRole, number>>;

export interface NormalizedMapPoint {
  minute: number;
  x: number;
  y: number;
}

export type TimelineMarkerKind =
  | 'kill'
  | 'death'
  | 'pre_obj_death'
  | 'assist'
  | 'ward'
  | 'control_ward'
  | 'objective';

export interface TimelineMapMarker {
  id: string;
  minute: number;
  timestampSec: number;
  kind: TimelineMarkerKind;
  x: number;
  y: number;
  label: string;
  detail: string;
}

export interface ReviewFinding {
  id: string;
  category: 'farming' | 'pathing' | 'objectives' | 'vision' | 'fighting';
  title: string;
  detail: string;
  timestampSec?: number;
  severity: 'positive' | 'mistake' | 'action';
}

export interface PostGameKpis {
  csPerMin: number;
  csAt4: number;
  csAt5?: number;
  csAt10?: number;
  goldDiffAt10: number;
  goldDiffAt15: number;
  xpDiffAt15: number;
  visionPerMin: number;
  controlWardsBought: number;
  objectiveSharePct: number;
  killParticipationPct: number;
  earlyDeaths: number;
  preObjectiveDeaths: number;
}

export interface PostGameReviewReport {
  matchId: string;
  championName: string;
  enemyJunglerName: string;
  win: boolean;
  durationSeconds: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  kpis: PostGameKpis;
  highlights: ReviewFinding[];
  mistakes: ReviewFinding[];
  improvements: ReviewFinding[];
  pathPoints: NormalizedMapPoint[];
  enemyPathPoints: NormalizedMapPoint[];
  markers: TimelineMapMarker[];
}

export type DivisionTier =
  | 'IRON'
  | 'BRONZE'
  | 'SILVER'
  | 'GOLD'
  | 'PLATINUM'
  | 'EMERALD'
  | 'DIAMOND'
  | 'MASTER';

export type JungleKpiKey =
  | 'csPerMin'
  | 'goldDiffAt15'
  | 'objectiveSharePct'
  | 'preObjectiveDeaths'
  | 'visionPerMin'
  | 'killParticipationPct';

export interface DivisionBenchmarkComparison {
  metric: JungleKpiKey;
  label: string;
  unit: string;
  currentValue: number;
  targetValue: number;
  lowerIsBetter: boolean;
  status: 'on_track' | 'close' | 'bottleneck';
  gapText: string;
  progressPct: number;
}

export interface ClimbGoal {
  id: string;
  targetDivision: string;
  metric: JungleKpiKey;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  lowerIsBetter: boolean;
  status: 'active' | 'completed';
  source: 'auto' | 'custom';
  createdAt: string;
  isFocusGoal?: boolean;
}

export interface HighEloChampStat {
  championId: number;
  games: number;
  wins: number;
  winRate: number;
  topItemIds: number[];
}

export interface HighEloMetaSnapshot {
  patch: string;
  region: string;
  sampleMatches: number;
  updatedAt: string;
  champions: HighEloChampStat[];
}

export interface ApiKeyHealthStatus {
  status: 'valid' | 'missing' | 'expired' | 'rate_limited' | 'offline';
  message: string;
  checkedAt: string;
}

export interface AppMetaInfo {
  version: string;
  commitSha: string;
  logDir: string;
}

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string | null;
  body?: string | null;
  date?: string | null;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: Array<{ title: string; items: string[] }>;
}
