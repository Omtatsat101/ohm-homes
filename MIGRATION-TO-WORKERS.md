# ohm.homes — current state + Workers migration path

## Where ohm.homes lives right now (2026-05-14)

| Layer | Lives at | What it serves |
|---|---|---|
| **Domain DNS** | wherever Porkbun points it → GitHub Pages | `ohm.homes` resolves to GitHub Pages |
| **Live site** | [`Omtatsat101/ohm-homes`](https://github.com/Omtatsat101/ohm-homes) — GH Pages | `index.html` (old real-estate single-pager) + `admin/index.html` (the new admin module) |
| **Workers scaffold (local, not deployed)** | `projects/ohm-homes/` on disk | Full Cloudflare Workers project ready to migrate to when you're ready |

So **`ohm.homes/admin/` works right now**. It's static HTML with a courtesy password gate; it serves from the same GH Pages instance that's been hosting the old real-estate page for months. No infrastructure change needed.

## What the local Workers scaffold is for

The folder at `projects/ohm-homes/` (Cloudflare Workers project) is the **future-state** ohm.homes — the one that:

- Has real auth via Cloudflare Workers env vars (not a client-side password)
- Talks to the Make MCP toolbox via the `MAKE_MCP_KEY` secret
- Has the URL-paste card builder via a server-side OG-metadata resolver
- Can read/write Supabase tables for the content CMS
- Replaces the old real-estate consumer site entirely

It's not deployed yet because deploy requires `npx wrangler login` (browser OAuth) which I can't run from my sandbox.

## To migrate to Workers (when you're ready, ~15 min)

This is what happens when you decide to flip from "GH Pages static" to "Cloudflare Workers":

### 1. Deploy the Workers project from your machine

```pwsh
cd C:\Users\riket\OneDrive\Desktop\Organized\projects\ohm-homes

npm install
npx wrangler login                        # browser OAuth pops; sign in to Cloudflare
npx wrangler secret put MAKE_MCP_KEY      # paste value from API-KEYS.env
npm run deploy
```

Wrangler prints a `*.workers.dev` URL. Visit it — you should see the dashboard shell at `/` and the admin gate at `/admin/`.

### 2. Move ohm.homes DNS from Porkbun → Cloudflare

If `ohm.homes` is still on Porkbun:

- Cloudflare dashboard → Add a Site → enter `ohm.homes` → free plan
- Cloudflare gives you two nameservers (e.g. `tia.ns.cloudflare.com`, `walt.ns.cloudflare.com`)
- In Porkbun, change the domain's nameservers to those two
- Wait 10-30 minutes for propagation

### 3. Bind the custom domain to the Worker

Cloudflare dashboard → Workers & Pages → `ohm-homes` → Settings → Triggers → Add Custom Domain → `ohm.homes` → save.

Cloudflare auto-issues a TLS cert and the new Worker handles all traffic.

### 4. Archive the old GH Pages repo

Once the Worker is serving traffic, the old `Omtatsat101/ohm-homes` GH Pages repo is dead weight. You can:

- Keep it (no harm — it's just unreferenced)
- Force-push the Workers scaffold to it (clean replacement) — but make sure DNS is OFF GH Pages before this
- Archive it via GitHub UI

I'd archive it. The Workers project on disk is the source of truth from then on.

## What the new ohm.homes will gain over the static admin

| Feature | Static admin (now) | Workers admin (after migration) |
|---|---|---|
| **Auth** | Password in client-side JS — anyone with view-source can read it | Server-side check via Workers env var; real auth |
| **URL-paste card builder** | Not possible (CORS blocks fetching remote OG metadata in browser) | Edge Function fetches server-side, returns parsed metadata |
| **Image upload** | Not possible (no place to write) | Supabase Storage bucket via authenticated Worker |
| **Inline content editing** | Not possible (would need a backend) | Reads/writes Supabase `site_content` table |
| **Make MCP toolbox actions** | Not possible | Worker proxies to `MAKE_MCP_KEY` server-side |
| **Subscription ledger view** | Not possible | Reads from Supabase or local D1 |
| **Visit counter, traffic insights** | GA4 only | Cloudflare Workers logs + analytics |

## When to migrate

Migrate when you're ready to use the URL-paste / content-editing features. Until then, the static admin at `ohm.homes/admin/` covers the deep-link-to-GitHub-editor use case, which is 80% of the value.
