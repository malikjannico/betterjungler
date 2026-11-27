import { describe, expect, it } from 'vitest';
import { synthesizeDemoPostGameDebrief } from './aiCoachFallback';
import { validateGroundedAiResponse } from './aiFactValidator';
import { DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import { analyzePostGameMatch } from './postGameReviewEngine';

describe('aiFactValidator', () => {
  it('accepts grounded coaching summaries and rejects hallucinated stats', () => {
    const context = JSON.stringify({
      championName: 'Viego',
      durationSeconds: 1825,
      grade: 'B',
      kpis: {
        csPerMin: 6.4,
        goldDiffAt15: -320,
        objectiveSharePct: 50,
        preObjectiveDeaths: 1,
      },
    });

    const grounded =
      '**1.** Keep clearing toward bot side: your 6.4 CS/min held steady through 30:25.\n' +
      '**10.** Rotate into 50% objective setups without dying down 320g (-320g) — keep 1 Control Ward ready.';
    expect(validateGroundedAiResponse(context, grounded)).toEqual({
      valid: true,
      ungroundedTokens: [],
    });

    const hallucinated =
      '1. Your **9.8 CS/min** crushed the 78.4% benchmark while gaining +1,450g and 2k gold before **22:15** (~1,000 bonus).';
    const res = validateGroundedAiResponse(context, hallucinated);
    expect(res.valid).toBe(false);
    expect(res.ungroundedTokens.length).toBeGreaterThanOrEqual(5);

    // Reject flipped-sign deltas (+320g or **+320g** vs -320) and near-rounding decimal fabrications (5.9 vs 6.4)
    const subtleHallucination = 'Your +320g lead came with **5.9** CS/min and 2,500g total.';
    const subtleRes = validateGroundedAiResponse(context, subtleHallucination);
    expect(subtleRes.valid).toBe(false);
    expect(subtleRes.ungroundedTokens).toEqual(expect.arrayContaining(['+320g', '5.9', '2500g']));
  });

  it('closes bypasses on line-leading decimals, MM:SS overflow, and cross-unit false positives while allowing valid scaling', () => {
    const winConContext = JSON.stringify({
      championName: 'Viego',
      durationSeconds: 3735,
      keyLevels: [4, 6, 11, 16],
      kpis: {
        csPerMin: 6.4,
        goldDiffAt15: 1825,
        objectiveSharePct: 50,
        visionNegDelta: -3.22,
      },
      objectiveSpawnsSec: {
        scuttle: 210,
        dragon: 300,
        herald: 840,
        baron: 1500,
      },
      totalGold: 1234567,
    });

    // Valid unit scaling, HH:MM:SS, multi-digit bold/underscore markers, negative decimal tolerance, glued IDs
    const validText = [
      '**10.** At 15m your 1.8k gold lead paired cleanly with Herald at 14m and Baron at 25 minutes.',
      '__4.__ Past S14 / patch16.23, 1:02:15 (total 1,234,567) keeps vision near 3.2.',
    ].join('\n');
    expect(validateGroundedAiResponse(winConContext, validText)).toEqual({
      valid: true,
      ungroundedTokens: [],
    });

    // Reject line-leading decimals (`9.2`, `**500.2**`, `9.*2`)
    expect(validateGroundedAiResponse(winConContext, '9.2 CS/min was strong.').valid).toBe(false);
    expect(validateGroundedAiResponse(winConContext, '**500.2** CS/min was strong.').valid).toBe(false);
    expect(validateGroundedAiResponse(winConContext, '9.*2 CS/min').valid).toBe(false);

    // Reject cross-unit & integer-rounding false positives (`6k gold` vs 6.4 CS/min, `50g` vs 50%, plain `6` vs 6.4)
    expect(validateGroundedAiResponse(winConContext, 'Push a 6k gold lead.').valid).toBe(false);
    expect(validateGroundedAiResponse(winConContext, 'Save 50g for components.').valid).toBe(false);
    expect(
      validateGroundedAiResponse(
        JSON.stringify({ kpis: { csPerMin: 6.4 } }),
        'Hit 6 CS/min.'
      ).valid
    ).toBe(false);

    // Reject MM:SS overflow (`29:85` or `0:1825`) and malformed double-colon timestamps (`12::30`)
    const overflowCtx = JSON.stringify({ durationSeconds: 1825 });
    expect(validateGroundedAiResponse(overflowCtx, 'Ended at 29:85.').valid).toBe(false);
    expect(validateGroundedAiResponse(overflowCtx, 'Ended at 0:1825.').valid).toBe(false);
    expect(validateGroundedAiResponse(JSON.stringify({ durationSeconds: 43230 }), 'Ended at 12::30.').valid).toBe(false);

    // Reject cross-unit count hallucinations (`6 kills` vs `keyLevels: [4, 6]`, `1825 CS` vs `durationSeconds: 1825`)
    expect(validateGroundedAiResponse(winConContext, 'Secured 6 kills early.').valid).toBe(false);
    expect(validateGroundedAiResponse(overflowCtx, 'Farmed 1825 CS total.').valid).toBe(false);

    // Unicode minus `−320g` normalizes cleanly and enforces sign; single-asterisk `*10.*` strips cleanly
    const signedCtx = JSON.stringify({ kpis: { goldDiffAt15: -320, csPerMin: 6.4 } });
    expect(validateGroundedAiResponse(signedCtx, '*10.* Down −320g at 6.4 CS/min.').valid).toBe(true);
    expect(
      validateGroundedAiResponse(
        JSON.stringify({ kpis: { goldDiffAt15: 320 } }),
        'Down −320g early.'
      ).valid
    ).toBe(false);
  });

  it('validates demo post-game fallback debrief against the exported review context', () => {
    const report = analyzePostGameMatch(DEMO_POST_GAME_MATCHES[1]!, 'PLATINUM IV');
    const context = JSON.stringify({
      champion: report.championName,
      duration: `${Math.floor(report.durationSeconds / 60)}:${String(report.durationSeconds % 60).padStart(2, '0')}`,
      grade: report.grade,
      kpis: report.kpis,
      highlights: report.highlights.map((h) => h.title),
      mistakes: report.mistakes.map((m) => m.title),
      improvements: report.improvements.map((imp) => imp.title),
    });
    const fallbackText = synthesizeDemoPostGameDebrief(report);
    const check = validateGroundedAiResponse(context, fallbackText);
    expect(check).toEqual({ valid: true, ungroundedTokens: [] });
  });
});
