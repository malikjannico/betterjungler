export interface Env {
  RIOT_API_KEY: string;
  ALLOWED_CLIENT?: string;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface ProxyHandlerOptions {
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  rateMap?: Map<string, RateLimitEntry>;
  maxRequestsPerWindow?: number;
  windowMs?: number;
  maxRateMapEntries?: number;
}

export const ALLOWED_ROUTING_HOSTS = new Set<string>([
  'americas',
  'europe',
  'asia',
  'sea',
  'euw1',
  'eun1',
  'na1',
  'kr',
  'jp1',
  'br1',
  'la1',
  'la2',
  'oc1',
  'tr1',
  'ru',
  'ph2',
  'sg2',
  'th2',
  'tw2',
  'vn2',
  'me1',
]);

export const ALLOWED_PATH_PREFIXES = [
  '/riot/account/v1/accounts/by-riot-id/',
  '/lol/summoner/v4/summoners/by-puuid/',
  '/lol/league/v4/entries/by-summoner/',
  '/lol/league/v4/entries/by-puuid/',
  '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5',
  '/lol/champion-mastery/v4/champion-masteries/by-puuid/',
  '/lol/match/v5/matches/by-puuid/',
  '/lol/match/v5/matches/',
  '/lol/status/v4/platform-data',
] as const;

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_MAX_MAP_ENTRIES = 10_000;
const sharedRateMap = new Map<string, RateLimitEntry>();

function jsonError(status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(extraHeaders ?? {}),
    },
  });
}

function hasUnsafePathSequence(rawPath: string): boolean {
  const lower = rawPath.toLowerCase();
  if (rawPath.includes('..') || rawPath.includes('\\') || lower.includes('%2e') || lower.includes('%5c')) {
    return true;
  }
  try {
    const decoded = decodeURIComponent(rawPath);
    if (decoded.includes('..') || decoded.includes('\\')) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function evictRateMapIfNeeded(
  rateMap: Map<string, RateLimitEntry>,
  now: number,
  maxEntries: number
): void {
  if (rateMap.size < maxEntries) return;
  for (const [key, entry] of rateMap) {
    if (entry.resetAt <= now) {
      rateMap.delete(key);
    }
  }
  while (rateMap.size >= maxEntries) {
    const oldestKey = rateMap.keys().next().value;
    if (oldestKey === undefined) break;
    rateMap.delete(oldestKey);
  }
}

export async function handleRiotProxyRequest(
  request: Request,
  env: Env,
  options: ProxyHandlerOptions = {}
): Promise<Response> {
  const expectedClient = env.ALLOWED_CLIENT ?? 'betterjungler';
  if (request.headers.get('X-App-Client') !== expectedClient) {
    return jsonError(403, 'Forbidden: invalid or missing X-App-Client header');
  }

  if (request.method !== 'GET') {
    return jsonError(405, 'Method Not Allowed', { Allow: 'GET' });
  }

  const reqUrl = new URL(request.url);
  if (hasUnsafePathSequence(request.url) || hasUnsafePathSequence(reqUrl.pathname)) {
    return jsonError(403, 'Forbidden: unsafe path sequence');
  }

  const trimmedPath = reqUrl.pathname.replace(/^\/+/, '');
  const slashIdx = trimmedPath.indexOf('/');
  if (slashIdx <= 0) {
    return jsonError(403, 'Forbidden: missing routing host or Riot API path');
  }

  const routingHost = trimmedPath.slice(0, slashIdx).toLowerCase();
  const riotPath = trimmedPath.slice(slashIdx);
  if (!routingHost || !riotPath || riotPath === '/') {
    return jsonError(403, 'Forbidden: empty routing host or Riot API path');
  }

  if (!ALLOWED_ROUTING_HOSTS.has(routingHost)) {
    return jsonError(403, 'Forbidden: unsupported Riot routing host');
  }

  const pathAllowed = ALLOWED_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? riotPath.startsWith(prefix) : riotPath === prefix
  );
  if (!pathAllowed) {
    return jsonError(403, 'Forbidden: Riot API path is not allowlisted');
  }

  const now = (options.nowFn ?? Date.now)();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS;
  const maxMapEntries = options.maxRateMapEntries ?? DEFAULT_MAX_MAP_ENTRIES;
  const rateMap = options.rateMap ?? sharedRateMap;

  const clientIp =
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';

  const existing = rateMap.get(clientIp);
  if (!existing || existing.resetAt <= now) {
    if (!existing) {
      evictRateMapIfNeeded(rateMap, now, maxMapEntries);
    }
    rateMap.set(clientIp, { count: 1, resetAt: now + windowMs });
  } else {
    existing.count += 1;
    if (existing.count > maxRequests) {
      const retryAfterSecs = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return jsonError(429, 'Too Many Requests', {
        'Retry-After': String(retryAfterSecs),
      });
    }
  }

  if (!env.RIOT_API_KEY?.trim()) {
    return jsonError(500, 'Proxy misconfigured: missing RIOT_API_KEY secret');
  }

  const upstreamUrl = `https://${routingHost}.api.riotgames.com${riotPath}${reqUrl.search}`;
  const fetchFn = options.fetchFn ?? fetch;
  const upstreamResp = await fetchFn(upstreamUrl, {
    method: 'GET',
    headers: {
      'X-Riot-Token': env.RIOT_API_KEY.trim(),
      Accept: 'application/json',
    },
  });

  const headers = new Headers();
  headers.set('Content-Type', upstreamResp.headers.get('Content-Type') ?? 'application/json');
  headers.set('Cache-Control', 'no-store');
  const retryAfter = upstreamResp.headers.get('Retry-After');
  if (retryAfter) headers.set('Retry-After', retryAfter);
  const appRateCount = upstreamResp.headers.get('X-App-Rate-Limit-Count');
  if (appRateCount) headers.set('X-App-Rate-Limit-Count', appRateCount);
  const methodRateCount = upstreamResp.headers.get('X-Method-Rate-Limit-Count');
  if (methodRateCount) headers.set('X-Method-Rate-Limit-Count', methodRateCount);

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRiotProxyRequest(request, env);
  },
};
