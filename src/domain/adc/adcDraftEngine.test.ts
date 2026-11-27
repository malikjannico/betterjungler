import { describe, expect, it } from 'vitest';
import {
  ADC_CHAMPIONS,
  ADC_ITEM_CATALOG,
  ADC_SUPPORT_COMBO_NOTES,
  ADC_VERIFIED_PERK_IDS,
  SUPPORT_ARCHETYPES,
  findAdcChampionById,
  findAdcChampionByName,
} from '../../data/adcKnowledgePack';
import { validateRunePage } from '../../data/jungleKnowledgePack';
import {
  analyzeAdcTeamNeeds,
  computeBotMatchup,
  computeSupportSynergy,
  inferAllySupportId,
  inferEnemyBotLane,
  recommendAdcPicks,
} from './adcDraftEngine';

const requireAdc = (id: number) => {
  const adc = findAdcChampionById(id);
  if (!adc) throw new Error(`Missing ADC ${id}`);
  return adc;
};

const JINX = 222;
const KAISA = 145;
const CAITLYN = 51;
const MISS_FORTUNE = 21;
const VAYNE = 67;
const DRAVEN = 119;
const KOGMAW = 96;
const CORKI = 42;
const LULU = 117;
const LEONA = 89;
const NAUTILUS = 111;
const LUX = 99;

const VERIFIED_ADC_IDS = [
  222, 145, 51, 81, 202, 22, 21, 236, 67, 119, 498, 18, 15, 110, 523, 221, 360, 96, 29, 901, 42, 804,
];

const VERIFIED_SUPPORT_IDS = [
  412, 111, 89, 117, 267, 40, 902, 99, 43, 201, 53, 555, 526, 497, 12, 16, 235, 25, 888, 143, 432, 147,
  223, 44, 350,
];

describe('adcKnowledgePack integrity (Patch 16.23.1)', () => {
  it('contains exactly the verified ADC champion IDs, each once', () => {
    const ids = ADC_CHAMPIONS.map((c) => c.championId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual([...VERIFIED_ADC_IDS].sort((a, b) => a - b));
  });

  it('contains exactly the verified support IDs', () => {
    const ids = Object.keys(SUPPORT_ARCHETYPES).map(Number).sort((a, b) => a - b);
    expect(ids).toEqual([...VERIFIED_SUPPORT_IDS].sort((a, b) => a - b));
  });

  it('only references verified perk IDs and produces valid 9-perk pages', () => {
    for (const adc of ADC_CHAMPIONS) {
      const runes = adc.recommendedRunes;
      expect(runes.selectedPerkIds).toHaveLength(9);
      for (const perkId of runes.selectedPerkIds) {
        expect(ADC_VERIFIED_PERK_IDS.has(perkId), `${adc.name} perk ${perkId}`).toBe(true);
      }
      expect(validateRunePage(runes)).toEqual([]);
      expect(runes.selectedPerkIds.slice(6)).toEqual([5005, 5008, 5001]);
    }
  });

  it('only references catalogued items, verified boots and verified summoner spells', () => {
    for (const adc of ADC_CHAMPIONS) {
      for (const itemId of [...adc.coreItemIds, ...adc.situationalItemIds]) {
        expect(ADC_ITEM_CATALOG[itemId], `${adc.name} item ${itemId}`).toBeDefined();
      }
      expect([3006, 3009, 3158]).toContain(adc.bootItemId);
      expect([
        [7, 4],
        [21, 4],
        [1, 4],
      ]).toContainEqual(adc.recommendedSpells);
      expect(adc.level2Strength).toBeGreaterThanOrEqual(1);
      expect(adc.level2Strength).toBeLessThanOrEqual(10);
    }
  });

  it('uses verified Patch 16.23.1 item costs', () => {
    expect(ADC_ITEM_CATALOG[3032]?.cost).toBe(3000);
    expect(ADC_ITEM_CATALOG[3031]?.cost).toBe(3500);
    expect(ADC_ITEM_CATALOG[3036]?.cost).toBe(3300);
    expect(ADC_ITEM_CATALOG[3078]?.cost).toBe(3333);
    expect(ADC_ITEM_CATALOG[3140]?.cost).toBe(1300);
    expect(ADC_ITEM_CATALOG[6697]?.cost).toBe(2800);
  });

  it('keeps matchup and synergy references inside the curated pools', () => {
    const adcIds = new Set(VERIFIED_ADC_IDS);
    for (const adc of ADC_CHAMPIONS) {
      for (const id of [...adc.strongIntoIds, ...adc.weakIntoIds]) expect(adcIds.has(id)).toBe(true);
      for (const id of adc.synergizesWithIds) expect(SUPPORT_ARCHETYPES[id]).toBeDefined();
      expect(adc.strongIntoIds).not.toContain(adc.championId);
      expect(adc.strongIntoIds.some((id) => adc.weakIntoIds.includes(id))).toBe(false);
    }
    for (const key of Object.keys(ADC_SUPPORT_COMBO_NOTES)) {
      const [adcId, supportId] = key.split(':').map(Number);
      expect(requireAdc(adcId ?? 0).synergizesWithIds).toContain(supportId);
    }
  });

  it('finds champions by ID, display name and Data Dragon key', () => {
    expect(findAdcChampionById(KAISA)?.name).toBe("Kai'Sa");
    expect(findAdcChampionByName("Kai'Sa")?.championId).toBe(KAISA);
    expect(findAdcChampionByName('kaisa')?.championId).toBe(KAISA);
    expect(findAdcChampionByName('Miss Fortune')?.championId).toBe(MISS_FORTUNE);
    expect(findAdcChampionByName('MissFortune')?.championId).toBe(MISS_FORTUNE);
    expect(findAdcChampionByName("Kog'Maw")?.key).toBe('KogMaw');
    expect(findAdcChampionByName('Lee Sin')).toBeUndefined();
    expect(findAdcChampionByName('')).toBeUndefined();
  });
});

describe('support synergy', () => {
  it('rewards Hypercarry + Enchanter and penalises Bully + Enchanter', () => {
    const jinxLulu = computeSupportSynergy(requireAdc(JINX), LULU);
    const kogLulu = computeSupportSynergy(requireAdc(KOGMAW), LULU);
    const dravenLulu = computeSupportSynergy(requireAdc(DRAVEN), LULU);

    expect(jinxLulu?.affinityRank).toBe(0);
    expect(jinxLulu?.isExplicitCombo).toBe(true);
    expect(jinxLulu?.comboNote).toContain('Lulu');
    expect(jinxLulu?.points).toBe(20);
    expect(kogLulu?.points).toBe(20);
    expect(dravenLulu?.affinityRank).toBe(-1);
    expect(dravenLulu?.points).toBeLessThan(jinxLulu?.points ?? 0);
  });

  it('rewards Bully + Engage over Hypercarry + Engage', () => {
    const dravenLeona = computeSupportSynergy(requireAdc(DRAVEN), LEONA);
    const kogLeona = computeSupportSynergy(requireAdc(KOGMAW), LEONA);
    expect(dravenLeona?.points).toBe(20);
    expect(dravenLeona?.comboNote).toMatch(/Leona/);
    expect(kogLeona?.affinityRank).toBe(-1);
    expect(kogLeona?.points).toBeLessThan(dravenLeona?.points ?? 0);
  });

  it('returns null for non-support champions', () => {
    expect(computeSupportSynergy(requireAdc(JINX), 64)).toBeNull();
  });

  it('ranks Jinx above Draven with Lulu, and Draven above Kog\'Maw with Leona', () => {
    const withLulu = recommendAdcPicks({
      allyChampionIds: [LULU],
      enemyChampionIds: [],
      bannedChampionIds: [],
      limit: 22,
    });
    const rank = (recs: typeof withLulu, id: number) => recs.findIndex((r) => r.champion.championId === id);
    expect(rank(withLulu, JINX)).toBeLessThan(rank(withLulu, DRAVEN));
    expect(withLulu.find((r) => r.champion.championId === JINX)?.reasons.join(' ')).toMatch(/Combo:/);
    expect(withLulu.find((r) => r.champion.championId === DRAVEN)?.warnings.join(' ')).toMatch(
      /doesn't fit Draven/
    );

    const withLeona = recommendAdcPicks({
      allyChampionIds: [LEONA],
      enemyChampionIds: [],
      bannedChampionIds: [],
      limit: 22,
    });
    expect(rank(withLeona, DRAVEN)).toBeLessThan(rank(withLeona, KOGMAW));
    expect(withLeona.every((r) => r.supportSynergy?.supportId === LEONA)).toBe(true);
  });

  it('infers the ally support and prefers dedicated supports over flex picks', () => {
    expect(inferAllySupportId([64, LUX, LULU])).toBe(LULU);
    expect(inferAllySupportId([64, LUX])).toBe(LUX);
    expect(inferAllySupportId([LULU, LEONA])).toBeUndefined();
    expect(inferAllySupportId([64, 103])).toBeUndefined();
  });
});

describe('2v2 bot matchup & Solo/Duo anonymity labelling', () => {
  it('labels an inferred enemy duo as likely', () => {
    const duo = inferEnemyBotLane([CAITLYN, LUX, 64, 103, 266]);
    expect(duo?.adcId).toBe(CAITLYN);
    expect(duo?.supportId).toBe(LUX);
    expect(duo?.supportArchetype).toBe('poke');
    expect(duo?.confidence).toBe('likely');
    expect(duo?.label).toBe('Likely enemy bot lane: Caitlyn + Lux');
  });

  it('keeps explicit positions likely in Ranked Solo/Duo and confirmed elsewhere', () => {
    const ranked = inferEnemyBotLane([CAITLYN, LUX], {
      explicit: { adcId: CAITLYN, supportId: LUX },
      isRankedSoloDuo: true,
    });
    expect(ranked?.confidence).toBe('likely');

    const normals = inferEnemyBotLane([CAITLYN, LUX], {
      explicit: { adcId: CAITLYN, supportId: LUX },
      isRankedSoloDuo: false,
    });
    expect(normals?.confidence).toBe('confirmed');
    expect(normals?.label).toBe('Enemy bot lane: Caitlyn + Lux');
  });

  it('prefers dedicated marksmen over flex picks and refuses to guess when ambiguous', () => {
    expect(inferEnemyBotLane([CORKI, JINX])?.adcId).toBe(JINX);
    expect(inferEnemyBotLane([CORKI, 64])?.adcId).toBe(CORKI);
    expect(inferEnemyBotLane([CAITLYN, JINX, LEONA])?.adcId).toBeUndefined();
    expect(inferEnemyBotLane([CAITLYN, JINX])).toBeNull();
    expect(inferEnemyBotLane([64, 103])).toBeNull();
  });

  it('scores favored and unfavored lanes against the likely enemy duo', () => {
    const enemy = inferEnemyBotLane([KOGMAW, LULU]);
    if (!enemy) throw new Error('expected enemy duo');
    const draven = computeBotMatchup(requireAdc(DRAVEN), enemy);
    const vayne = computeBotMatchup(requireAdc(VAYNE), inferEnemyBotLane([DRAVEN, LEONA])!);

    expect(draven.versusAdc).toBe('favored');
    expect(draven.points).toBeGreaterThan(15);
    expect(draven.notes.join(' ')).toMatch(/likely enemy ADC Kog'Maw/);
    expect(vayne.versusAdc).toBe('unfavored');
    expect(vayne.points).toBeLessThan(5);
  });

  it('surfaces likely labels in recommendation reasons/warnings', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [NAUTILUS],
      enemyChampionIds: [CAITLYN, LUX],
      bannedChampionIds: [],
      limit: 22,
    });
    for (const rec of recs) {
      expect(rec.botMatchup?.enemy.confidence).toBe('likely');
    }
    const kaisa = recs.find((r) => r.champion.championId === KAISA);
    expect(kaisa?.warnings.join(' ')).toMatch(/likely enemy ADC Caitlyn/);
    const jinx = recs.find((r) => r.champion.championId === JINX);
    expect(jinx?.warnings.join(' ')).toMatch(/likely/);
  });
});

describe('recommendAdcPicks', () => {
  it('excludes banned, ally-picked, enemy-picked champions and the ally support', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [64, CORKI, LULU],
      enemyChampionIds: [MISS_FORTUNE, LEONA],
      bannedChampionIds: [CAITLYN, KAISA, 0, -1],
      limit: 22,
    });
    const ids = recs.map((r) => r.champion.championId);
    for (const id of [CAITLYN, KAISA, CORKI, MISS_FORTUNE]) expect(ids).not.toContain(id);
    expect(ids).toHaveLength(ADC_CHAMPIONS.length - 4);
  });

  it('returns top 5 by default, sorted descending, with bounded scores', () => {
    const recs = recommendAdcPicks({ allyChampionIds: [], enemyChampionIds: [], bannedChampionIds: [] });
    expect(recs).toHaveLength(5);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.totalScore).toBeGreaterThanOrEqual(recs[i]!.totalScore);
    }
    for (const rec of recs) {
      expect(rec.totalScore).toBeGreaterThanOrEqual(0);
      expect(rec.totalScore).toBeLessThanOrEqual(100);
      expect(rec.supportSynergy).toBeNull();
      expect(rec.botMatchup).toBeNull();
      expect(rec.reasons.length).toBeGreaterThan(0);
    }
  });

  it('applies signed meta tier overrides', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [],
      enemyChampionIds: [],
      bannedChampionIds: [],
      metaTierOverrides: [{ championId: CORKI, championName: 'Corki', metaTier: 'S+', metaScore: 100 }],
      limit: 1,
    });
    expect(recs[0]?.champion.championId).toBe(CORKI);
    expect(recs[0]?.breakdown.meta).toBe(30);
    expect(recs[0]?.reasons[0]).toMatch(/Signed Patch Pack S\+-tier override/);
  });

  it('blends High-Elo samples into meta points', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [],
      enemyChampionIds: [],
      bannedChampionIds: [],
      highEloMeta: {
        patch: '16.23.1',
        region: 'EUW',
        sampleMatches: 400,
        updatedAt: '2026-11-27T00:00:00Z',
        champions: [{ championId: VAYNE, games: 100, wins: 62, winRate: 62, topItemIds: [] }],
      },
      limit: 22,
    });
    const vayne = recs.find((r) => r.champion.championId === VAYNE);
    expect(vayne?.breakdown.meta).toBeGreaterThan(Math.round(((82 - 75) / 25) * 30));
    expect(vayne?.reasons.join(' ')).toMatch(/High-Elo Sample: 62% WR/);
  });

  it('rewards personal mastery with shrunk win rate', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [],
      enemyChampionIds: [],
      bannedChampionIds: [],
      masteryChampionIds: [VAYNE],
      personalStats: {
        [VAYNE]: { games: 20, wins: 15 },
        [JINX]: { games: 10, wins: 3 },
        [CAITLYN]: { games: 10, wins: 5 },
      },
      limit: 22,
    });
    const vayne = recs.find((r) => r.champion.championId === VAYNE);
    const jinx = recs.find((r) => r.champion.championId === JINX);
    expect(vayne?.breakdown.mastery).toBeGreaterThan(6);
    expect(vayne?.reasons.join(' ')).toMatch(/Your 75% WR \(20G/);
    expect(jinx?.breakdown.mastery).toBeLessThan(0);
    expect(jinx?.warnings.join(' ')).toMatch(/Low personal WR: 30%/);
  });

  it('nudges picks that support the active match focus goal', () => {
    const base = { allyChampionIds: [], enemyChampionIds: [], bannedChampionIds: [], limit: 22 };
    const neutral = recommendAdcPicks(base);
    const focused = recommendAdcPicks({ ...base, focusMetric: 'deathsPre14' });
    const mastery = (recs: typeof neutral, id: number) =>
      recs.find((r) => r.champion.championId === id)?.breakdown.mastery;

    expect(mastery(focused, CAITLYN)).toBe((mastery(neutral, CAITLYN) ?? 0) + 3);
    expect(mastery(focused, VAYNE)).toBe(mastery(neutral, VAYNE));
    expect(focused.find((r) => r.champion.championId === CAITLYN)?.reasons.join(' ')).toMatch(
      /early-deaths focus/
    );
  });
});

describe('ADC team needs', () => {
  it('flags AP-heavy allies and rewards a pure AD carry', () => {
    const needs = analyzeAdcTeamNeeds([876, 28, LULU], []);
    expect(needs.adThreats).toBe(0);
    expect(needs.apThreats).toBe(3);
    expect(needs.gaps).toContain('Needs primary AD threat');

    const recs = recommendAdcPicks({
      allyChampionIds: [876, 28, LULU],
      enemyChampionIds: [],
      bannedChampionIds: [],
      limit: 22,
    });
    expect(recs.find((r) => r.champion.championId === JINX)?.reasons).toContain(
      'Supplies the primary AD threat for an AP-heavy draft'
    );
  });

  it('prefers hybrid damage into a full-AD draft', () => {
    const recs = recommendAdcPicks({
      allyChampionIds: [234, 64, 555],
      enemyChampionIds: [],
      bannedChampionIds: [],
      limit: 22,
    });
    const kaisa = recs.find((r) => r.champion.championId === KAISA);
    const caitlyn = recs.find((r) => r.champion.championId === CAITLYN);
    expect(kaisa?.reasons).toContain('Hybrid damage softens a full-AD draft');
    expect(caitlyn?.warnings).toContain('Adds more AD to an already full-AD draft');
    expect(kaisa!.breakdown.teamNeed).toBeGreaterThan(caitlyn!.breakdown.teamNeed);
  });

  it('rewards tank-shred cores into a tanky enemy frontline', () => {
    const needs = analyzeAdcTeamNeeds([], [113, LEONA, NAUTILUS]);
    expect(needs.enemyFrontlineCount).toBeGreaterThanOrEqual(2);
    const recs = recommendAdcPicks({
      allyChampionIds: [],
      enemyChampionIds: [113, LEONA, NAUTILUS],
      bannedChampionIds: [],
      limit: 22,
    });
    expect(recs.find((r) => r.champion.championId === VAYNE)?.reasons).toContain(
      'Core build shreds the tanky enemy frontline'
    );
  });

  it('ignores unknown champions instead of guessing their damage type', () => {
    const needs = analyzeAdcTeamNeeds([99999, 88888], []);
    expect(needs.adThreats).toBe(0);
    expect(needs.apThreats).toBe(0);
    expect(needs.gaps).toEqual([]);
  });
});
