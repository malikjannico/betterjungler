# BetterJungler Zero-Trust Riot API Proxy (Cloudflare Worker)

This optional Cloudflare Worker acts as a locked-down HTTPS relay for **BetterJungler** when distributing builds backed by a **Riot Production API Key** instead of requiring end-users to paste a personal 24-hour development key.

## Security Boundaries

1. **Client Routing Header (`X-App-Client`)**: Rejects requests missing `X-App-Client: betterjungler` with `403`. Note that `X-App-Client` is a public client-routing identifier (not secret authentication); abuse protection relies on strict host/path allowlists and edge rate limiting.
2. **GET-Only Relay**: Rejects non-`GET` methods with `405`.
3. **Strict Host Allowlist**: Only forwards to official Riot regional/platform routing hosts (`americas`, `europe`, `asia`, `sea`, `euw1`, `na1`, `kr`, etc.) and rejects any other host with `403`.
4. **Strict Path Prefix Allowlist & Traversal Guard**: Only forwards the exact Account-V1, Summoner-V4, League-V4 (entries & Ranked Solo Challenger), Champion-Mastery-V4, Match-V5, and Status-V4 prefixes required by BetterJungler, rejecting `..`, `%2e`, `\\`, and empty segments with `403`.
5. **Bounded Per-Isolate Rate Limiter**: Enforces a sliding-window cap (`60 req/min/IP` by default) per Cloudflare Worker isolate (`429` + `Retry-After`) with bounded map eviction. Note that the in-memory `Map` is per-isolate (not globally synchronized across edge POPs), and High-Elo Challenger meta refresh consumes ~15–20 requests per refresh.
6. **Server-Side Key Injection**: Injects `X-Riot-Token` from Cloudflare Worker secret `RIOT_API_KEY` at the edge; the key never touches the desktop binary or logs.

## Deployment

```powershell
cd proxy
npm install
npx wrangler secret put RIOT_API_KEY
npx wrangler deploy
```

Then paste the deployed origin-only `https://<worker>.workers.dev` URL (no path suffix) into **BetterJungler → Settings → Riot API Proxy URL (HTTPS)**.
