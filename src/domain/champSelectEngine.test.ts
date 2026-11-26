import { describe, expect, it } from 'vitest';
import {
  analyzeTeamComposition,
  recommendJunglePicks,
  sanitizeChampSelectSession,
} from './champSelectEngine';
import { DEMO_CHAMP_SELECT } from './simulationFixtures';

describe('champSelectEngine', () => {
  it('enforces Ranked Solo/Duo anonymity masking for non-local/non-party players', () => {
    const sanitized = sanitizeChampSelectSession(DEMO_CHAMP_SELECT);
    expect(sanitized.myTeam[0]?.displayName).toBe('Ally 1');
    expect(sanitized.myTeam[1]?.displayName).toBe('Ally 2');
    expect(sanitized.myTeam[3]?.displayName).toBe('You (Jungler)');
    expect(sanitized.theirTeam[0]?.displayName).toBe('Enemy 1');
    expect(sanitized.theirTeam[4]?.displayName).toBe('Enemy 5');
  });

  it('detects full-AD team composition gaps', () => {
    // Renekton (58), Yasuo (157), Jinx (222), Pyke (555) -> 0 AP
    const analysis = analyzeTeamComposition([58, 157, 222, 555]);
    expect(analysis.apScore).toBe(0);
    expect(analysis.gaps).toContain('Needs AP threat (full AD risk)');
  });

  it('excludes banned/picked champions and prioritizes AP/frontline when allies are full AD', () => {
    const recs = recommendJunglePicks({
      allyChampionIds: [58, 157, 222, 555], // Full AD, low frontline
      enemyChampionIds: [266, 234, 517, 51, 16],
      bannedChampionIds: [876, 64], // Lillia & Lee Sin banned
      enemyJunglerId: 234, // Viego
      masteryChampionIds: [32], // Amumu mastery
    });

    expect(recs.length).toBe(5);
    const ids = recs.map((r) => r.champion.championId);
    expect(ids).not.toContain(234);
    expect(ids).not.toContain(876);
    expect(ids).not.toContain(64);
    // Amumu (32) fills AP, frontline, engage, CC, counters Viego, and matches mastery
    expect(recs[0]?.champion.championId).toBe(32);
  });
});
