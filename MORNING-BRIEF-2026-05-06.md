# Morning Brief — 2026-05-06

**You said "go serve / goodnight" at the end of a Tier-1 wiring sprint.** Here's what I did overnight without your hand on the keyboard, and what's queued for first thing in the morning.

## ✅ Shipped overnight (no clicks needed)

1. **Cloudflare account probed.** Account `2294a5e3…` is live, set as active. Current state: 0 KV namespaces, 0 D1 dbs, 0 Workers, R2 not yet enabled. Greenfield — perfect time to ship the scaffold.
2. **Adobe Express MCP initialized.** Routing/tool docs pulled, ready to call image tools (background remove, generative expand, etc.) once you give it a file picker click.
3. **Cloudflare migration guide saved.** `migrate_pages_to_workers_guide` retrieved — only relevant if/when you migrate the existing static sites; for ohm.homes I built the Worker fresh.
4. **`projects/ohm-homes/` scaffold built.** 7 files, ~250 lines. Cloudflare Worker that:
   - Serves a dashboard at `/`
   - Exposes `/api/health`, `/api/version`, `/api/mcp/status`
   - The MCP status route hits your Make "Kiddie Brand Toolbox" with JSON-RPC `tools/list` and surfaces what comes back
   - Static-asset binding ready for the existing `projects/dashboard/index.html` to be moved/embedded later

## ⏳ Needs your click (first 15 min when you wake up)

Order matters — top first.

| # | Action | Why | Time |
|---|---|---|---|
| 1 | **`cd projects/ohm-homes && npm install && npx wrangler login`** | Bootstrap the Worker — login pops a browser tab | 3 min |
| 2 | **`npx wrangler secret put MAKE_MCP_KEY`** then paste the Kiddie Brand Toolbox key from `API-KEYS.env` | So `/api/mcp/status` works on first deploy | 30s |
| 3 | **`npm run deploy`** | First deploy → you get a `*.workers.dev` URL → open it → all 3 status cards should go green | 1 min |
| 4 | **Cloudflare dashboard → bind `ohm.homes` custom domain** to the new Worker | Live at the actual URL | 2 min (assumes domain is on Cloudflare nameservers; otherwise that's another step) |
| 5 | **Authenticate Shopify MCP** in Claude Desktop → Connectors | Replaces the 11 Make-wrapped Shopify tools with the official, faster path. No timeout, GraphQL, bulk ops. | 2 min |
| 6 | **OAuth Klaviyo** | Unblocks the KS welcome email flow that's been sitting 6+ days | 2 min |
| 7 | **Enable R2** in Cloudflare dashboard (one-click) so we can `wrangler r2 bucket create ohm-product-images` later | Sets up the Gemini → Adobe → R2 → Shopify image pipeline | 30s |

## 🐛 Bugs flagged for follow-up (not urgent)

- **`ks_search_orders` and `ks_search_products` (when variants:true)** Make tools throw `INVALID_VARIABLE: nVariants of type Int! was provided invalid value`. I patched `ks_search_products` to `variants:false` earlier; `ks_search_orders` still has the issue (and `tools_update` API was returning 500 last try). Either retry tools_update in the morning, or rebuild via the official Shopify MCP from item #5 above and retire the buggy Make ones.

## 📊 Last validated state (no overnight surprises)

- KiddieWordle deploy: **live** at kiddiewordle.com (commit `57ad481`, all 11 markers verified)
- Make MCP toolbox: **18 tools live**, server `519c6b0b-…`, key in `API-KEYS.env`
- Subscription ledger + relationship map: live in `projects/analysis/`

## 🎯 Decision queue (no rush, but soon)

- **Notion vs HubSpot** for promoting the relationship map into a live DB. Recommended Notion (already paid via your existing membership, AI Ops Hub already exists).
- **Mural refund chargeback** — last touched 4/10, decision needed by ~4/30 if you want to dispute through Mercury.
- **Notion subscription** — auto-charges 4/29 unless you cancel. Decide today.

Sleep well. Everything will be here when you're back. 🌙
