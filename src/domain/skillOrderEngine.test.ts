import { describe, expect, it } from 'vitest';
import { computeSkillOrderAdvice } from './skillOrderEngine';

describe('skillOrderEngine', () => {
  it('follows level 1-3 basic unlocks before maximizing primary skill (KaiSa & Lee Sin)', () => {
    const lv1 = computeSkillOrderAdvice("Kai'Sa", 1, {
      Q: { abilityLevel: 0 },
      W: { abilityLevel: 0 },
      E: { abilityLevel: 0 },
      R: { abilityLevel: 0 },
    });
    expect(lv1.nextSkill).toBe('Q');
    expect(lv1.unspentPoints).toBe(1);
    expect(lv1.promptLabel).toBe('LEVEL Q NOW');
    expect(lv1.maxOrderLabel).toBe('R > Q > E > W');

    const lv2 = computeSkillOrderAdvice("Kai'Sa", 2, {
      Q: { abilityLevel: 1 },
      W: { abilityLevel: 0 },
      E: { abilityLevel: 0 },
      R: { abilityLevel: 0 },
    });
    expect(lv2.nextSkill).toBe('W');
    expect(lv2.unspentPoints).toBe(1);

    const lv3 = computeSkillOrderAdvice('Lee Sin', 3, {
      Q: { abilityLevel: 1 },
      W: { abilityLevel: 1 },
      E: { abilityLevel: 0 },
      R: { abilityLevel: 0 },
    });
    expect(lv3.nextSkill).toBe('E');
    expect(lv3.maxOrderLabel).toBe('R > Q > W > E');
  });

  it('prioritizes R at levels 6, 11, and 16 and falls back to secondary when primary hits rank cap', () => {
    const lv6 = computeSkillOrderAdvice('Jinx', 6, {
      Q: { abilityLevel: 3 },
      W: { abilityLevel: 1 },
      E: { abilityLevel: 1 },
      R: { abilityLevel: 0 },
    });
    expect(lv6.nextSkill).toBe('R');
    expect(lv6.unspentPoints).toBe(1);

    // At level 8 (with Q already at rank 4 = cap for level 8), next legal point goes to secondary W!
    const lv8 = computeSkillOrderAdvice('Jinx', 8, {
      Q: { abilityLevel: 4 },
      W: { abilityLevel: 1 },
      E: { abilityLevel: 1 },
      R: { abilityLevel: 1 },
    });
    expect(lv8.nextSkill).toBe('W');

    // When 0 unspent points, previews the next level-up cleanly
    const spent = computeSkillOrderAdvice('Jinx', 9, {
      Q: { abilityLevel: 5 },
      W: { abilityLevel: 2 },
      E: { abilityLevel: 1 },
      R: { abilityLevel: 1 },
    });
    expect(spent.unspentPoints).toBe(0);
    expect(spent.nextSkill).toBe('W');
    expect(spent.promptLabel).toBe('NEXT: W');
  });

  it('returns MAXED at level 18 with all 18 points allocated', () => {
    const maxed = computeSkillOrderAdvice('Viego', 18, {
      Q: { abilityLevel: 5 },
      W: { abilityLevel: 5 },
      E: { abilityLevel: 5 },
      R: { abilityLevel: 3 },
    });
    expect(maxed.nextSkill).toBeNull();
    expect(maxed.unspentPoints).toBe(0);
    expect(maxed.promptLabel).toBe('MAXED');
  });
});
