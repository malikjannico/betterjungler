import { describe, expect, it, vi } from 'vitest';
import {
  handleRiotProxyRequest,
  type Env,
  type RateLimitEntry,
} from '../../proxy/src/index';

const TEST_ENV: Env = {
  RIOT_API_KEY: 'RGAPI-secret-server-key',
  ALLOWED_CLIENT: 'betterjungler',
};

function makeRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {}
): Request {
  const headers = new Headers(init.headers ?? {});
  if (!('X-App-Client' in (init.headers ?? {}))) {
    headers.set('X-App-Client', 'betterjungler');
  }
  return new Request(`https://proxy.example.workers.dev${path}`, {
    method: init.method ?? 'GET',
    headers,
  });
}

describe('Cloudflare Worker Riot API Proxy', () => {
  it('enforces X-App-Client header and GET-only method', async () => {
    const rateMap = new Map<string, RateLimitEntry>();
    const fetchSpy = vi.fn();

    const noHeaderReq = new Request('https://proxy.example.workers.dev/euw1/lol/status/v4/platform-data');
    const missingHeaderRes = await handleRiotProxyRequest(noHeaderReq, TEST_ENV, {
      fetchFn: fetchSpy,
      rateMap,
    });
    expect(missingHeaderRes.status).toBe(403);

    const wrongHeaderRes = await handleRiotProxyRequest(
      makeRequest('/euw1/lol/status/v4/platform-data', {
        headers: { 'X-App-Client': 'other-app' },
      }),
      TEST_ENV,
      { fetchFn: fetchSpy, rateMap }
    );
    expect(wrongHeaderRes.status).toBe(403);

    const postRes = await handleRiotProxyRequest(
      makeRequest('/euw1/lol/status/v4/platform-data', { method: 'POST' }),
      TEST_ENV,
      { fetchFn: fetchSpy, rateMap }
    );
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get('Allow')).toBe('GET');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects disallowed hosts, disallowed path prefixes, empty paths, and traversal attempts', async () => {
    const rateMap = new Map<string, RateLimitEntry>();
    const fetchSpy = vi.fn();

    const badPaths = [
      '/',
      '/euw1',
      '/euw1/',
      '/evil/lol/status/v4/platform-data',
      '/euw1/lol/clash/v1/tournaments',
      '/euw1/lol/match/v5/../status/v4/platform-data',
      '/euw1/lol/status/%2e%2e/platform-data',
      '/euw1/lol/status/v4%5cplatform-data',
      '/euw1/lol/status/v4/platform-data/extra',
      '/euw1/lol/league/v4/challengerleagues/by-queue/RANKED_FLEX_SR',
    ];

    for (const p of badPaths) {
      const res = await handleRiotProxyRequest(makeRequest(p), TEST_ENV, {
        fetchFn: fetchSpy,
        rateMap,
      });
      expect(res.status).toBe(403);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows Ranked Solo Challenger and Champion Mastery endpoints via proxy', async () => {
    const rateMap = new Map<string, RateLimitEntry>();
    const fetchSpy = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const challengerRes = await handleRiotProxyRequest(
      makeRequest('/euw1/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5'),
      TEST_ENV,
      { fetchFn: fetchSpy, rateMap }
    );
    expect(challengerRes.status).toBe(200);

    const masteryRes = await handleRiotProxyRequest(
      makeRequest('/euw1/lol/champion-mastery/v4/champion-masteries/by-puuid/abc-123/top?count=8'),
      TEST_ENV,
      { fetchFn: fetchSpy, rateMap }
    );
    expect(masteryRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('relays valid allowlisted requests with server-side X-Riot-Token and never leaks the key', async () => {
    const rateMap = new Map<string, RateLimitEntry>();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'EUW1' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-App-Rate-Limit-Count': '1:1,1:120',
        },
      })
    );

    const res = await handleRiotProxyRequest(
      makeRequest('/europe/lol/match/v5/matches/by-puuid/abc-123/ids?queue=420&start=0&count=5'),
      TEST_ENV,
      { fetchFn: fetchSpy, rateMap }
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = fetchSpy.mock.calls[0]!;
    expect(targetUrl).toBe(
      'https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc-123/ids?queue=420&start=0&count=5'
    );
    const sentHeaders = init.headers as Record<string, string>;
    expect(sentHeaders['X-Riot-Token']).toBe('RGAPI-secret-server-key');
    const bodyText = await res.text();
    expect(bodyText).not.toContain('RGAPI-secret-server-key');
    expect(res.headers.get('X-App-Rate-Limit-Count')).toBe('1:1,1:120');
  });

  it('enforces bounded per-IP sliding-window rate limiting and evicts stale/overflow entries', async () => {
    const rateMap = new Map<string, RateLimitEntry>();
    let now = 1_000_000;
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    for (let i = 0; i < 2; i += 1) {
      const okRes = await handleRiotProxyRequest(
        makeRequest('/euw1/lol/status/v4/platform-data', {
          headers: { 'X-App-Client': 'betterjungler', 'CF-Connecting-IP': '1.2.3.4' },
        }),
        TEST_ENV,
        {
          fetchFn: fetchSpy,
          nowFn: () => now,
          rateMap,
          maxRequestsPerWindow: 2,
          windowMs: 10_000,
          maxRateMapEntries: 2,
        }
      );
      expect(okRes.status).toBe(200);
    }

    const limitedRes = await handleRiotProxyRequest(
      makeRequest('/euw1/lol/status/v4/platform-data', {
        headers: { 'X-App-Client': 'betterjungler', 'CF-Connecting-IP': '1.2.3.4' },
      }),
      TEST_ENV,
      {
        fetchFn: fetchSpy,
        nowFn: () => now,
        rateMap,
        maxRequestsPerWindow: 2,
        windowMs: 10_000,
        maxRateMapEntries: 2,
      }
    );
    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers.get('Retry-After')).toBe('10');

    // Fill second IP and trigger bounded eviction on third IP
    await handleRiotProxyRequest(
      makeRequest('/euw1/lol/status/v4/platform-data', {
        headers: { 'X-App-Client': 'betterjungler', 'CF-Connecting-IP': '5.6.7.8' },
      }),
      TEST_ENV,
      {
        fetchFn: fetchSpy,
        nowFn: () => now,
        rateMap,
        maxRequestsPerWindow: 2,
        windowMs: 10_000,
        maxRateMapEntries: 2,
      }
    );
    expect(rateMap.size).toBe(2);

    now += 10_001;
    await handleRiotProxyRequest(
      makeRequest('/euw1/lol/status/v4/platform-data', {
        headers: { 'X-App-Client': 'betterjungler', 'CF-Connecting-IP': '9.9.9.9' },
      }),
      TEST_ENV,
      {
        fetchFn: fetchSpy,
        nowFn: () => now,
        rateMap,
        maxRequestsPerWindow: 2,
        windowMs: 10_000,
        maxRateMapEntries: 2,
      }
    );
    expect(rateMap.size).toBeLessThanOrEqual(2);
  });
});
