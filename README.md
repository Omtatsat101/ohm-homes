# ohm.homes — internal command center

Riket's internal AI command center on Cloudflare Workers. Serves the
dashboard at `ohm.homes` and exposes a thin API surface that proxies to
the Make MCP toolbox ("Kiddie Brand Toolbox"), Shopify, Gmail, etc.

**Internal use only.** Per `memory/project_ohm_homes.md`: never expose
internal AI tools or relationship/subscription data publicly.

## First deploy (10 min, all from this folder)

```pwsh
cd C:\Users\riket\OneDrive\Desktop\Organized\projects\ohm-homes

# 1. Install (one time)
npm install

# 2. Login to Cloudflare (one time, browser pops)
npx wrangler login

# 3. Push the Make MCP toolbox key as a secret (one time)
#    Paste the value from API-KEYS.env "Kiddie Brand Toolbox MCP Server API"
#    when prompted (input is hidden).
npx wrangler secret put MAKE_MCP_KEY

# 4. Deploy
npm run deploy
```

Wrangler will print the `*.workers.dev` URL — open it, you should see the
dashboard with three live status cards. `/api/health`, `/api/version`,
and `/api/mcp/status` are the JSON probes.

## Bind the custom domain

After the first deploy:

1. Cloudflare dashboard → Workers & Pages → `ohm-homes` → Settings → Triggers
2. Add Custom Domain → `ohm.homes`
3. Cloudflare auto-issues a cert. Custom domain works in ~30s.

Requires `ohm.homes` to be on Cloudflare nameservers. If it's still on
Porkbun/GoDaddy, change nameservers first (Cloudflare will tell you which two).

## Add bindings (when ready)

```pwsh
# KV for cached MCP responses + simple state
npm run kv:create
# → copy the printed id into wrangler.jsonc "kv_namespaces"

# D1 for relationship map + subscription ledger as live tables
npm run d1:create
# → copy database_id into wrangler.jsonc "d1_databases"

# R2 for product images (Gemini → Adobe → R2 → Shopify)
# Enable R2 once via dashboard (one-click), then:
npx wrangler r2 bucket create ohm-product-images
# → uncomment the r2_buckets line in wrangler.jsonc
```

After uncommenting any of those, redeploy:

```pwsh
npm run deploy
```

The dashboard's "Bindings" card will pick them up automatically.

## Files

| File | Why |
|---|---|
| `wrangler.jsonc` | Worker config + assets binding + commented future bindings |
| `package.json` | wrangler v4 + TS types + npm scripts |
| `src/index.ts` | Worker entry — 3 API routes + asset fallback |
| `public/index.html` | Dashboard shell, polls the 3 API routes |
| `.assetsignore` | Standard ignore for asset bundle |
| `.gitignore` | node_modules + wrangler state |

## What's intentionally not here yet

- Auth — internal-only by IP allowlist or Cloudflare Access (decide before adding non-public data)
- D1 schema — wait until first table is needed (relationship map vs. subscription ledger first)
- Embedding `projects/dashboard/index.html` — that lands once D1 has live data to feed it
