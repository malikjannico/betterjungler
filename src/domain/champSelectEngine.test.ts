import { describe, expect, it } from 'vitest';
import {
  JUNGLE_CHAMPIONS,
  getChampionMeta,
  hydrateDdragonCatalog,
  validateRunePage,
} from '../data/jungleKnowledgePack';
import {
  analyzeTeamComposition,
  computePersonalChampStats,
  inferEnemyJunglerId,
  recommendJunglePicks,
  sanitizeChampSelectSession,
} from './champSelectEngine';
import { DEMO_HIGH_ELO_SNAPSHOT } from './postGameFixtures';
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

  it('blends High-Elo Match-V5 sample winrates into Champ Select rationale', () => {
    const recs = recommendJunglePicks({
      allyChampionIds: [58, 61, 145, 111],
      enemyChampionIds: [266, 56, 517, 222, 16],
      bannedChampionIds: [],
      highEloMeta: DEMO_HIGH_ELO_SNAPSHOT,
    });

    const sampled = recs.find((r) =>
      r.reasons.some((reason) => reason.includes('High-Elo Sample'))
    );
    expect(sampled).toBeDefined();
  });

  it('includes expanded 32-jungler roster and resolves dynamic Data Dragon metadata', () => {
    expect(JUNGLE_CHAMPIONS.length).toBeGreaterThanOrEqual(32);

    hydrateDdragonCatalog({
      patch: '16.1.1',
      championsById: {
        9999: { id: 9999, key: 'TestMage', name: 'Test Mage', tags: ['Mage'] },
      },
      itemsById: {},
    });

    const meta = getChampionMeta(9999);
    expect(meta.name).toBe('Test Mage');
    expect(meta.damageProfile).toBe('ap');
  });

  it('validates all 32 jungler rune pages contain zero removed Riot rune IDs and infers enemy jungler by Smite', () => {
    for (const champ of JUNGLE_CHAMPIONS) {
      const issues = validateRunePage(champ.recommendedRunes);
      expect(issues, `${champ.name} rune issues: ${issues.join(', ')}`).toEqual([]);
    }

    const smiteInferred = inferEnemyJunglerId([
      {
        cellId: 5,
        team: 'enemy',
        displayName: 'Enemy 1',
        championId: 86,
        assignedPosition: 'unknown',
        spell1Id: 4,
        spell2Id: 12,
        isLocalPlayer: false,
        isPartyMember: false,
        completed: true,
      },
      {
        cellId: 6,
        team: 'enemy',
        displayName: 'Enemy 2',
        championId: 64,
        assignedPosition: 'unknown',
        spell1Id: 11,
        spell2Id: 4,
        isLocalPlayer: false,
        isPartyMember: false,
        completed: true,
      },
    ]);
    expect(smiteInferred).toBe(64);

    const soloDuoHiddenInferred = inferEnemyJunglerId([
      {
        cellId: 5,
        team: 'enemy',
        displayName: 'Enemy 1',
        championId: 86, // Garen (top, not in JUNGLE_CHAMPIONS)
        assignedPosition: 'unknown',
        spell1Id: 0,
        spell2Id: 0,
        isLocalPlayer: false,
        isPartyMember: false,
        completed: true,
      },
      {
        cellId: 6,
        team: 'enemy',
        displayName: 'Enemy 2',
        championId: 234, // Viego (sole jungle pool pick)
        assignedPosition: 'unknown',
        spell1Id: 0,
        spell2Id: 0,
        isLocalPlayer: false,
        isPartyMember: false,
        completed: true,
      },
    ]);
    expect(soloDuoHiddenInferred).toBe(234);
  });

  it('weights personal rolling win rate when a jungler has at least 3 recent games', () => {
    const personalStats = computePersonalChampStats([
      { championId: 234, win: true }, // Viego: 4G 100% WR
      { championId: 234, win: true },
      { championId: 234, win: true },
      { championId: 234, win: true },
      { championId: 121, win: true }, // Kha'Zix: 2G (below >= 3 threshold)
      { championId: 121, win: true },
      { championId: 64, win: false }, // Lee Sin: 4G 0% WR (negative bias warning)
      { championId: 64, win: false },
      { championId: 64, win: false },
      { championId: 64, win: false },
    ]);

    const recs = recommendJunglePicks({
      allyChampionIds: [58, 61, 145, 111],
      enemyChampionIds: [266, 56, 517, 222, 16],
      bannedChampionIds: [],
      masteryChampionIds: [234, 121, 64],
      personalStats,
    });

    const viego = recs.find((r) => r.champion.championId === 234);
    const khazix = recs.find((r) => r.champion.championId === 121);
    const leeSin = recs.find((r) => r.champion.championId === 64);
    expect(viego?.reasons.some((r) => r.includes('Your 100% WR (4G)'))).toBe(true);
    if (khazix) {
      expect(khazix.reasons.some((r) => r.includes('Your '))).toBe(false);
    }
    if (leeSin) {
      expect(leeSin.warnings.some((w) => w.includes('Low personal WR: 0% (4G)'))).toBe(true);
    }
  });
});
