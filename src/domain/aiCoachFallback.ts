import type { PostGameReviewReport, WinConditionPlan } from '../types/coaching';

export function synthesizeDemoPostGameDebrief(report: PostGameReviewReport): string {
  const best = report.highlights[0]?.title ?? 'Solid map presence';
  const mainFix = report.mistakes[0]?.title ?? 'Minor tempo cleanup';
  const action = report.improvements[0]?.title ?? 'Keep chaining camps into objectives';

  return [
    `Match Verdict (${report.championName} vs ${report.enemyJunglerName} — Grade ${report.grade}):`,
    `• What worked: ${best}. At 15:00 your gold diff was ${report.kpis.goldDiffAt15 >= 0 ? '+' : ''}${report.kpis.goldDiffAt15}g with ${report.kpis.objectiveSharePct}% objective share.`,
    `• Biggest leak: ${mainFix}.`,
    `• Next-game focus: ${action} — set a mental timer 60s before every Dragon/Herald/Baron spawn so you reset and arrive with a Control Ward.`,
  ].join('\n');
}

export function synthesizeDemoWinConBrief(
  plan: WinConditionPlan,
  championName: string
): string {
  return [
    `Tactical Brief for ${championName} (${plan.allyAnalysis.archetype} vs ${plan.enemyAnalysis.archetype}):`,
    `• Win through ${plan.strongSide.toUpperCase()} side while keeping ${plan.weakSide.toUpperCase()} stable.`,
    `• Core goal: ${plan.primaryWinCondition}`,
    `• Respect enemy threat: ${plan.enemyWinConditionToDeny}`,
  ].join('\n');
}
