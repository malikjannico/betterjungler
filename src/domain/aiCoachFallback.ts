import type { AdcPostGameReviewReport } from './adc/adcReviewTypes';
import type { AdcWinConditionPlan } from './adc/types';
import type { PostGameReviewReport, WinConditionPlan } from '../types/coaching';

export function synthesizeDemoPostGameDebrief(report: PostGameReviewReport): string {
  const best = report.highlights[0]?.title ?? 'Solid map presence';
  const mainFix = report.mistakes[0]?.title ?? 'Minor tempo cleanup';
  const action = report.improvements[0]?.title ?? 'Keep chaining camps into objectives';

  return [
    `Match Verdict (${report.championName} vs ${report.enemyJunglerName} — Grade ${report.grade}):`,
    `• What worked: ${best}. At 15m your gold diff was ${report.kpis.goldDiffAt15 >= 0 ? '+' : ''}${report.kpis.goldDiffAt15}g with ${report.kpis.objectiveSharePct}% objective share.`,
    `• Biggest leak: ${mainFix}.`,
    `• Next-game focus: ${action} — set a clean reset timer ahead of every Dragon/Herald/Baron spawn so you recall and arrive with 1 Control Ward.`,
  ].join('\n');
}

export function synthesizeDemoAdcPostGameDebrief(report: AdcPostGameReviewReport): string {
  const best = report.highlights[0]?.title ?? 'Disciplined lane farm';
  const mainFix = report.mistakes[0]?.title ?? 'Minor positioning cleanup';
  const action = report.improvements[0]?.title ?? 'Maintain wave catch tempo into teamfights';
  const csAt10Text = report.kpis.csAt10 !== null ? ` (${report.kpis.csAt10} CS@10)` : '';
  const dmgText =
    report.kpis.damageSharePct !== null ? ` with ${report.kpis.damageSharePct}% team damage share` : '';

  return [
    `Bot Lane Verdict (${report.championName} vs ${report.laneOpponentName} — Grade ${report.grade}):`,
    `• What worked: ${best}. Hit ${report.kpis.csPerMin} CS/min${csAt10Text}${dmgText}.`,
    `• Biggest leak: ${mainFix}.`,
    `• Next-game focus: ${action} — trim side waves before rotating Mid and hold defensive positioning prior to Dragon/Baron.`,
  ].join('\n');
}

export function synthesizeDemoWinConBrief(
  plan: WinConditionPlan | AdcWinConditionPlan,
  championName: string
): string {
  if ('wavePlan' in plan) {
    return [
      `Bot Lane Brief for ${championName} (${plan.archetype} — ${plan.botMatchupSummary.verdict}):`,
      `• Level-2 Plan: ${plan.wavePlan.decision === 'push_lv2_all_in' ? 'PUSH FOR LV2' : 'CONCEDE & TRIM'} — ${plan.wavePlan.instruction}`,
      `• Core goal: ${plan.primaryWinCondition}`,
      `• Enemy threat: ${plan.enemyWinConditionToDeny}`,
    ].join('\n');
  }
  return [
    `Tactical Brief for ${championName} (${plan.allyAnalysis.archetype} vs ${plan.enemyAnalysis.archetype}):`,
    `• Win through ${plan.strongSide.toUpperCase()} side while keeping ${plan.weakSide.toUpperCase()} stable.`,
    `• Core goal: ${plan.primaryWinCondition}`,
    `• Respect enemy threat: ${plan.enemyWinConditionToDeny}`,
  ].join('\n');
}
