import type {
  AdcArchetype,
  AdcChampionProfile,
  SupportArchetype,
} from '../../data/adcKnowledgePack';
import type {
  AdcKpiKey,
  ChampionTierOverride,
  HighEloMetaSnapshot,
  WardSpot,
} from '../../types/coaching';
import type { MapSide } from '../../types/riot';

export type {
  AdcArchetype,
  AdcChampionProfile,
  AdcDamageProfile,
  AdcRangeTier,
  AdcScalingProfile,
  SupportArchetype,
  SupportArchetypeEntry,
} from '../../data/adcKnowledgePack';

/**
 * `likely` = inferred from visible champion picks only (always the case in Ranked Solo/Duo,
 * where Riot hides enemy positions and summoner spells). `confirmed` = positions were supplied
 * explicitly outside Ranked Solo/Duo.
 */
export type BotLaneConfidence = 'likely' | 'confirmed';

export interface AdcPersonalChampRecord {
  games: number;
  wins: number;
}

export interface RecommendAdcInput {
  allyChampionIds: number[];
  enemyChampionIds: number[];
  bannedChampionIds: number[];
  /** Locked/hovered ally support. When omitted it is inferred from `allyChampionIds`. */
  allySupportId?: number;
  /**
   * Explicit enemy bot duo. Only honoured as `confirmed` when `isRankedSoloDuo === false`;
   * in Ranked Solo/Duo it is still reported as `likely`.
   */
  enemyBotLane?: { adcId?: number; supportId?: number };
  /** Defaults to `true` — the safe assumption for anonymity labelling. */
  isRankedSoloDuo?: boolean;
  masteryChampionIds?: number[];
  personalStats?: Record<number, AdcPersonalChampRecord>;
  metaTierOverrides?: ChampionTierOverride[];
  highEloMeta?: HighEloMetaSnapshot | null;
  /** Active Climb focus goal metric (e.g. `deathsPre14`); nudges picks that make the goal easier. */
  focusMetric?: AdcKpiKey | null;
  /** Number of recommendations to return (default 5). */
  limit?: number;
}

export interface InferredEnemyBotLane {
  adcId?: number;
  adcName?: string;
  supportId?: number;
  supportName?: string;
  supportArchetype?: SupportArchetype;
  confidence: BotLaneConfidence;
  /** Display label, e.g. "Likely enemy bot lane: Caitlyn + Lux". */
  label: string;
}

export interface AdcSupportSynergy {
  supportId: number;
  supportName: string;
  supportArchetype: SupportArchetype;
  /** 0..20 */
  points: number;
  /** Index in the ADC's `preferredSupports`, or -1 when the archetype is not preferred. */
  affinityRank: number;
  isExplicitCombo: boolean;
  comboNote?: string;
}

export interface AdcBotMatchupInsight {
  enemy: InferredEnemyBotLane;
  /** 0..20 */
  points: number;
  versusAdc: 'favored' | 'even' | 'unfavored' | 'unknown';
  notes: string[];
}

export interface AdcTeamNeedsAnalysis {
  adThreats: number;
  apThreats: number;
  frontlineCount: number;
  peelCount: number;
  enemyFrontlineCount: number;
  enemyDiveCount: number;
  gaps: string[];
}

export interface AdcScoreBreakdown {
  /** 0..35 */
  meta: number;
  /** 0..20 */
  supportSynergy: number;
  /** 0..20 */
  botMatchup: number;
  /** 0..15 */
  teamNeed: number;
  /** -6..+16 */
  mastery: number;
}

export interface AdcDraftRecommendation {
  champion: AdcChampionProfile;
  /** 0..100 */
  totalScore: number;
  breakdown: AdcScoreBreakdown;
  supportSynergy: AdcSupportSynergy | null;
  botMatchup: AdcBotMatchupInsight | null;
  reasons: string[];
  warnings: string[];
}

export type AdcMacroPhaseId =
  | 'laning_lv2'
  | 'plates_first_drakes'
  | 'mid_lane_rotation'
  | 'teamfight_baron_elder';

export interface MacroPhasePlan {
  id: AdcMacroPhaseId;
  order: 1 | 2 | 3 | 4;
  label: string;
  timeWindow: string;
  startSec: number;
  /** `null` = open-ended (rest of the game). */
  endSec: number | null;
  focus: string;
  actions: string[];
}

export type AdcMatchupVerdict = 'favored' | 'even' | 'unfavored' | 'unknown';

export interface AdcBotMatchupSummary {
  enemyBotLane: InferredEnemyBotLane | null;
  matchup: AdcBotMatchupInsight | null;
  verdict: AdcMatchupVerdict;
  /** Combined ally ADC+support level-2 strength minus the enemy duo's (≈ -10..+10). */
  level2Delta: number;
  summary: string;
}

export interface AdcSupportSynergyPlaybook {
  synergy: AdcSupportSynergy | null;
  supportName: string | null;
  supportArchetype: SupportArchetype | null;
  playbook: string;
  allInWindows: string[];
}

export interface AdcWavePlan {
  /** Season 2026 first minion wave spawn (0:30). */
  minionSpawnSec: number;
  level2Rule: string;
  decision: 'push_lv2_all_in' | 'concede_push_trim';
  instruction: string;
}

export interface AdcJunglerThreatTiming {
  enemyJunglerName: string;
  threatLevel: 'high' | 'medium' | 'low';
  /** Enemy strong side as seen from the bot laner. */
  likelyFirstSide: 'bot' | 'top';
  dangerWindow: { startSec: number; endSec: number; label: string };
  safeUntilSec: number;
  instruction: string;
}

export interface AdcWinConditionPlan {
  championId: number;
  championName: string;
  mapSide: MapSide;
  archetype: AdcArchetype;
  laneGamePlan: string;
  powerSpikes: Array<{ label: string; itemIds: number[]; note: string }>;
  teamfightRole: string;
  enemyBotLane: InferredEnemyBotLane | null;
  dangerChampionIds: number[];
  keyRules: string[];
  botMatchupSummary: AdcBotMatchupSummary;
  supportSynergyPlaybook: AdcSupportSynergyPlaybook;
  wavePlan: AdcWavePlan;
  enemyJunglerThreat: AdcJunglerThreatTiming;
  plateWindow: { deadlineSec: number; instruction: string };
  dragonPriority: { firstSpawnSec: number; priority: 'high' | 'medium' | 'low'; instruction: string };
  midSwap: { trigger: string; instruction: string };
  /** Exactly 4 ordered stages. */
  macroPhases: MacroPhasePlan[];
  wardSpots: WardSpot[];
  primaryWinCondition: string;
  enemyWinConditionToDeny: string;
}

export interface AdcPostGameKpi {
  key: AdcKpiKey;
  value: number;
  benchmark: number;
  lowerIsBetter: boolean;
  status: 'ahead' | 'on_track' | 'behind';
}

export interface AdcPostGameReport {
  matchId: string;
  championId: number;
  win: boolean;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  kpis: AdcPostGameKpi[];
  strengths: string[];
  improvements: string[];
  focusSuggestion?: AdcKpiKey;
}
