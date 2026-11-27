import { describe, expect, it } from 'vitest';
import { DEMO_POST_GAME_MATCHES } from './postGameFixtures';
import { deriveSessionContext } from './sessionContext';

const BASE_SETTINGS = {
  hasApiKey: false,
  riotApiProxyUrl: '',
  riotId: '',
  targetDivision: 'PLATINUM IV',
};

describe('sessionContext', () => {
  it('enforces honest empty states across all coaching views on fresh idle boot', () => {
    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: null,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.source).toBe('live');
    expect(ctx.playerChampionName).toBeNull();
    expect(ctx.resolvedMapSide).toBeNull();
    expect(ctx.champSelect).toEqual({ status: 'empty', reason: 'not_in_champ_select' });
    expect(ctx.winPlan).toEqual({ status: 'empty', reason: 'no_completed_draft' });
    expect(ctx.liveCoach).toEqual({ status: 'empty', reason: 'no_live_match' });
    expect(ctx.postGame).toEqual({ status: 'empty', reason: 'no_account' });
    expect(ctx.climb.accountReady).toBe(false);
    expect(ctx.climb.matches).toEqual([]);
  });

  it('keeps Win Plan gated during incomplete champ select and unlocks once all 10 picks lock', () => {
    const champSelectCtx = deriveSessionContext({
      demoScenario: 'champ_select',
      liveState: null,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(champSelectCtx.source).toBe('simulated');
    expect(champSelectCtx.champSelect.status).toBe('ready');
    expect(champSelectCtx.winPlan).toEqual({
      status: 'empty',
      reason: 'draft_in_progress',
      progress: { locked: 9, total: 10 },
    });

    const loadingCtx = deriveSessionContext({
      demoScenario: 'loading',
      liveState: null,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });
    expect(loadingCtx.winPlan.status).toBe('ready');
    if (loadingCtx.winPlan.status === 'ready') {
      expect(loadingCtx.winPlan.data.championName).toBe('Amumu');
      expect(loadingCtx.winPlan.data.plan.routes).toHaveLength(4);
    }
    expect(loadingCtx.liveCoach).toEqual({ status: 'empty', reason: 'loading_match' });
  });

  it('activates Post-Game and Live Coach gates properly with real matches', () => {
    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: null,
      settings: { ...BASE_SETTINGS, hasApiKey: true, riotId: 'Jungler#EUW' },
      summonerProfile: {
        riotId: 'Jungler#EUW',
        puuid: 'puuid-real',
        region: 'EUW1',
        summonerLevel: 120,
        tier: 'GOLD',
        rank: 'II',
        leaguePoints: 40,
        wins: 10,
        losses: 8,
        topMasteryChampionIds: [234],
      },
      matches: [DEMO_POST_GAME_MATCHES[0]!],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.postGame.status).toBe('ready');
    expect(ctx.climb.accountReady).toBe(true);
    expect(ctx.climb.matchesReady).toBe(true);
  });

  it('keeps Win Plan empty when in-game lacks any role data instead of inventing bot strong side', () => {
    const emptyLive = {
      phase: 'in_game' as const,
      gameflowPhase: 'InProgress',
      canInstallUpdate: false,
      lcuConnected: true,
      liveClientConnected: true,
      champSelect: null,
      liveGame: {
        activePlayer: {
          summonerName: 'You',
          level: 1,
          currentGold: 500,
          championStats: {
            attackDamage: 70,
            abilityPower: 0,
            armor: 30,
            magicResist: 30,
            currentHealth: 600,
            maxHealth: 600,
            moveSpeed: 340,
          },
        },
        allPlayers: [
          {
            summonerName: 'You',
            championName: 'Zyra',
            team: 'ORDER' as const,
            position: '',
            level: 1,
            isDead: false,
            respawnTimer: 0,
            items: [],
            scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
          },
        ],
        events: { Events: [] },
        gameData: { gameMode: 'CLASSIC', gameTime: 60, mapName: 'Map11', mapNumber: 11 },
      },
      summonerProfile: null,
      patchVersion: '16.23.1',
    };

    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: emptyLive,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.liveCoach.status).toBe('ready');
    expect(ctx.winPlan).toEqual({ status: 'empty', reason: 'no_completed_draft' });
  });

  it('excludes off-role (ADC/Top/Mid/Support) matches from Climb jungle summaries while retaining Post-Game display', () => {
    const jgMatch = { ...DEMO_POST_GAME_MATCHES[0]!, role: 'JUNGLE' };
    const adcMatch = {
      ...DEMO_POST_GAME_MATCHES[1]!,
      matchId: 'EUW1_ADC_OFFROLE',
      role: 'BOTTOM',
    };
    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: null,
      settings: { ...BASE_SETTINGS, hasApiKey: true, riotId: 'Jungler#EUW' },
      summonerProfile: null,
      matches: [jgMatch, adcMatch],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.postGame.status).toBe('ready');
    if (ctx.postGame.status === 'ready') {
      expect(ctx.postGame.data.matches).toHaveLength(2);
    }
    expect(ctx.climb.jungleMatches).toHaveLength(1);
    expect(ctx.climb.summaries).toHaveLength(1);
    expect(ctx.climb.offRoleExcludedCount).toBe(1);
  });

  it('suppresses jungle/ADC items and macro cues during Top/Mid/Support off-role live games, showing global objectives only', () => {
    const topLive = {
      phase: 'in_game' as const,
      gameflowPhase: 'InProgress',
      canInstallUpdate: false,
      lcuConnected: true,
      liveClientConnected: true,
      champSelect: null,
      liveGame: {
        activePlayer: {
          summonerName: 'TopPlayer',
          level: 11,
          currentGold: 1350,
          championStats: {
            attackDamage: 185,
            abilityPower: 0,
            armor: 82,
            magicResist: 52,
            currentHealth: 1950,
            maxHealth: 1950,
            moveSpeed: 365,
          },
        },
        allPlayers: [
          {
            summonerName: 'TopPlayer',
            championName: 'Aatrox',
            team: 'ORDER' as const,
            position: 'TOP',
            level: 11,
            isDead: false,
            respawnTimer: 0,
            items: [],
            scores: { kills: 3, deaths: 1, assists: 2, creepScore: 140, wardScore: 8 },
            summonerSpells: {
              summonerSpellOne: { displayName: 'Teleport' },
              summonerSpellTwo: { displayName: 'Flash' },
            },
          },
          {
            summonerName: 'EnemyTop',
            championName: 'Darius',
            team: 'CHAOS' as const,
            position: 'TOP',
            level: 12,
            isDead: false,
            respawnTimer: 0,
            items: [{ itemID: 6610, displayName: 'Sundered Sky', count: 1, slot: 0, price: 3100 }],
            scores: { kills: 4, deaths: 2, assists: 1, creepScore: 145, wardScore: 7 },
          },
        ],
        events: { Events: [] },
        gameData: { gameMode: 'CLASSIC', gameTime: 650, mapName: 'Map11', mapNumber: 11 },
      },
      summonerProfile: null,
      patchVersion: '16.23.1',
    };

    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: topLive,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.livePlayedRole).toBe('off_role');
    expect(ctx.liveCoach.status).toBe('ready');
    if (ctx.liveCoach.status === 'ready') {
      expect(ctx.liveCoach.data.playedRole).toBe('off_role');
      expect(ctx.liveCoach.data.isJungleRole).toBe(false);
      expect(ctx.liveCoach.data.buildPlan).toBeNull();
      expect(ctx.liveCoach.data.macroCues).toEqual([]);
      expect(ctx.liveCoach.data.objectives.length).toBeGreaterThan(0);
      expect(ctx.liveCoach.data.objectives.some((o) => o.id === 'atakhan')).toBe(false);
    }
  });

  it('auto-detects ADC in live Bot lane matches, serving ADC items (never Chempunk) and ADC macro cues', () => {
    const adcLive = {
      phase: 'in_game' as const,
      gameflowPhase: 'InProgress',
      canInstallUpdate: false,
      lcuConnected: true,
      liveClientConnected: true,
      champSelect: null,
      liveGame: {
        activePlayer: {
          summonerName: 'AdcPlayer',
          level: 11,
          currentGold: 1350,
          championStats: {
            attackDamage: 185,
            abilityPower: 0,
            armor: 52,
            magicResist: 42,
            currentHealth: 1450,
            maxHealth: 1450,
            moveSpeed: 375,
          },
        },
        allPlayers: [
          {
            summonerName: 'AdcPlayer',
            championName: 'Jinx',
            team: 'ORDER' as const,
            position: 'BOTTOM',
            level: 11,
            isDead: false,
            respawnTimer: 0,
            items: [],
            scores: { kills: 3, deaths: 1, assists: 4, creepScore: 140, wardScore: 8 },
            summonerSpells: {
              summonerSpellOne: { displayName: 'Heal' },
              summonerSpellTwo: { displayName: 'Flash' },
            },
          },
          {
            summonerName: 'EnemyTop',
            championName: 'Aatrox',
            team: 'CHAOS' as const,
            position: 'TOP',
            level: 12,
            isDead: false,
            respawnTimer: 0,
            items: [{ itemID: 6610, displayName: 'Sundered Sky', count: 1, slot: 0, price: 3100 }],
            scores: { kills: 5, deaths: 1, assists: 2, creepScore: 150, wardScore: 9 },
          },
        ],
        events: { Events: [] },
        gameData: { gameMode: 'CLASSIC', gameTime: 650, mapName: 'Map11', mapNumber: 11 },
      },
      summonerProfile: null,
      patchVersion: '16.23.1',
    };

    const ctx = deriveSessionContext({
      demoScenario: 'idle',
      liveState: adcLive,
      settings: BASE_SETTINGS,
      summonerProfile: null,
      matches: [],
      lpHistory: [],
      highEloMeta: null,
    });

    expect(ctx.activeRole).toBe('bottom');
    expect(ctx.livePlayedRole).toBe('bottom');
    expect(ctx.liveCoach.status).toBe('ready');
    if (ctx.liveCoach.status === 'ready') {
      expect(ctx.liveCoach.data.playedRole).toBe('bottom');
      expect(ctx.liveCoach.data.isJungleRole).toBe(false);
      expect(ctx.liveCoach.data.buildPlan).not.toBeNull();
      expect(ctx.liveCoach.data.buildPlan?.nextItem?.item.id).not.toBe(6609);
      expect(ctx.liveCoach.data.macroCues.length).toBeGreaterThan(0);
      expect(ctx.liveCoach.data.objectives.length).toBeGreaterThan(0);
    }
  });
});
