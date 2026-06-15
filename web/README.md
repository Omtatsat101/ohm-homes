# ohm.homes — web

Next.js 14 (App Router) front-end for **ohm.homes**, a real-estate maps
experience: browse listings on a map, filter, and find your next home. Built to
mirror the proven `projects/flipwala-vibeflippers/web/` layout (Next 14 +
Supabase SSR + OpenNext on Cloudflare Workers).

> **This is a NEW front-end, not the existing command-center.** See
> [Relationship to the command-center Worker](#relationship-to-the-existing-ohmhomes-command-center-worker)
> below. Nothing in the parent `projects/ohm-homes/` Worker was modified.

---

## Architecture

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 14, App Router, TypeScript | `app/` server components, `@/...` path alias |
| Styling | Tailwind CSS | Real-estate palette as CSS vars in `app/globals.css` |
| Icons | lucide-react | |
| Auth / data | Supabase (SSR) | `lib/supabase/{server,client}.ts`, env-driven |
| Listings | **Pluggable source** | `lib/listings-source.ts` — mock now, real feed later |
| Map | Placeholder → **Mapbox** | `components/map-placeholder.tsx`, no script today |
| Deploy | OpenNext → Cloudflare Workers | `open-next.config.ts`, `wrangler.jsonc` |

### Layout

```
web/
├── app/
│   ├── globals.css          # Tailwind + RE palette (forest/sand/charcoal CSS vars)
│   ├── layout.tsx           # root layout, metadata "ohm.homes — find your next home"
│   ├── page.tsx             # hero + map placeholder + featured listings grid
│   └── listings/page.tsx    # full listings + map (server component)
├── components/
│   ├── listing-card.tsx     # presentational card
│   └── map-placeholder.tsx  # styled "Map of listings — Mapbox provider TBD"
├── lib/
│   ├── listings-source.ts   # getListings() — PLUGGABLE adapter seam
│   ├── roles.ts             # RE personas + roleDestination()
│   └── supabase/{server,client}.ts
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json            # "@/*" path alias
├── open-next.config.ts
├── wrangler.jsonc           # name: ohm-homes-web
└── package.json             # name: ohm-homes-web
```

### Scripts

```bash
npm run dev          # next dev
npm run build        # next build
npm run start        # next start
npm run lint         # next lint
npm run type-check   # tsc --noEmit
npm run cf:build     # opennextjs-cloudflare build
npm run cf:deploy    # opennextjs-cloudflare deploy
npm run cf:preview   # opennextjs-cloudflare preview
```

> Dependencies are not installed yet — run `npm install` in `web/` before the
> first dev/build.

---

## Real-estate personas

`lib/roles.ts` is the single source of truth for who logs in and where they
land. Mirrors the FWVF persona model, retargeted to real estate.

| Role | Lands at | For |
| --- | --- | --- |
| **Buyer** | `/listings` | Search homes, save favorites |
| **Seller** | `/sell` | List a property, reach buyers |
| **Agent** | `/agent/dashboard` | Manage listings, leads, tours |
| **Investor** | `/investor/dashboard` | Cap rates, comps, deal analysis |
| **Admin** | `/admin` | Ops, moderation, settings |

`roleDestination(role)` resolves the post-login redirect (falls back to
`/listings`).

---

## Pluggable listing source

The entire UI imports only `getListings()` and the `Listing` type from
`lib/listings-source.ts`. Pages never know where data comes from — that
indirection **is** the adapter seam.

- **Today:** `getListings()` returns 6 mock listings. No external API is called.
- **Tomorrow:** branch the `ACTIVE_SOURCE` switch in `lib/listings-source.ts` to
  a real adapter that maps the provider payload into `Listing[]`. Keep the mock
  path as a fallback when credentials are absent.

### Chosen data stack (pending MLS membership + tokens)

- **SimplyRETS** — primary RESO-compliant MLS/IDX feed. Requires brokerage **MLS
  membership** and vendor credentials (`SIMPLYRETS_API_KEY` / secret). This is
  the intended production source.
- **RentCast** — interim REST API for listings/AVM data so the site can launch
  with real (non-MLS) data while MLS membership is pending (`RENTCAST_API_KEY`).
- **RESO Web API** — direct board Web API where available.

### Chosen map stack

- **Mapbox GL JS** — the chosen map provider. `components/map-placeholder.tsx`
  renders a styled, script-free stand-in today; swap its body for a real map
  once `NEXT_PUBLIC_MAPBOX_TOKEN` is configured. `next.config.mjs` already
  allow-lists `images.unsplash.com` for mock photos; add real image-CDN hosts to
  `remotePatterns` when wiring a feed.

---

## Supabase

`lib/supabase/server.ts` and `client.ts` follow the FWVF pattern and are fully
**env-driven**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; `wrangler secret put`, never in
  `wrangler.jsonc`)

> ohm.homes/web will get its **OWN** Supabase project. Do **not** reuse the FWVF
> project. The `vars` block in `wrangler.jsonc` is intentionally blank — fill it
> in after creating the ohm.homes Supabase project.

Per the data-sovereignty rule, captured user fields belong in Supabase only.

---

## Planned: port the FWVF self-improving loop

The FlipWala+VibeFlippers app runs a self-improving feedback loop. The plan is to
**port it here** once the front-end stabilizes:

1. **Feedback** — in-app widget captures user/agent feedback.
2. **Backlog** — feedback is normalized into a backlog store (Supabase / Notion).
3. **AI triage** — an agent classifies, dedupes, and prioritizes backlog items.
4. **Notifications** — owners are pinged on new high-signal items.
5. **Digest** — a periodic (cron) summary of what came in and what shipped.

This is **not yet wired** in ohm.homes/web — it is the next infra step after the
listings UI and real data source are live.

---

## Relationship to the existing ohm.homes command-center Worker

The parent folder `projects/ohm-homes/` already contains a **live Cloudflare
Worker** (the ohm.homes command-center): `src/index.ts`, `src/pipeline.ts`,
`public/`, `index.html`, `/admin/`, `/read/`, its own `wrangler.jsonc` with
crons, the `ohm.homes` CNAME, and a git remote.

- This `web/` project is a **sibling** front-end. It has its own `package.json`,
  `wrangler.jsonc` (Worker name `ohm-homes-web`), and deploy pipeline.
- The command-center Worker was **left fully untouched** by this scaffold.
- **Integration is a later step.** Options to evaluate at cutover: route a path
  prefix from one Worker to the other, run the front-end on a subdomain, or have
  the command-center hand off to `ohm-homes-web`. Until that is planned, the new
  Worker is **not** pointed at the `ohm.homes` apex.
