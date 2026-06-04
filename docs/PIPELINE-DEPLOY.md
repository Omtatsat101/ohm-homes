# Pipeline Worker — Deployment Guide

The Cloudflare Worker alternative to Make.com Scenarios A and B. Same outcome (Slack ping with pre-filled Gmail compose link when an application is ready for follow-up) without the Make UI work or Make data-store quota issues.

**Status:** code written, secrets + deploy pending.

---

## What this Worker does

1. `POST /api/pipeline/queue-followup` — receives the same payload format as the Make webhook, inserts a row into Supabase `application_followups`. Drop-in replacement for the Make webhook.
2. `scheduled()` cron — runs every 30 min, drains the queue:
   - SELECTs pending rows where `run_at < now()`
   - Fetches `email-templates.json` from `riketpatel.com` (edge-cached 5 min)
   - Interpolates `{recipient_name}`, `{role_title}`, `{company}`, `{slug}`, `{submitted_date}`
   - Posts a Slack Block Kit card with the email body inline AND a button linking to `https://mail.google.com/mail/?view=cm&...` (Gmail compose with prefilled To/Subject/Body)
   - Includes a "✅ Mark sent" button that hits `/api/pipeline/slack-interact`
   - UPDATEs the row: `status='draft_created'`, `drafted_at=now()`
3. `POST /api/pipeline/slack-interact` — Slack interactivity receiver. When Riket clicks "Mark sent" in the Slack card, flips the row's status to `sent` and `sent_at=now()`.

### Key architectural choice

This Worker **does not create Gmail drafts directly** — instead it builds a `mail.google.com/mail/?view=cm&...` URL that opens Gmail compose with everything pre-filled. One click → editable draft in your inbox. No OAuth refresh-token storage. No Gmail API. Same outcome.

---

## Required secrets

Three new secrets to set via `wrangler secret put` in the `ohm-homes` directory:

| Secret | Value | Where to get it |
|---|---|---|
| `SUPABASE_URL` | `https://doxmbwizpsyqruyrmffs.supabase.co` | Already set, or use `wrangler secret put SUPABASE_URL` if not |
| `SUPABASE_SERVICE_ROLE_KEY` | from `projects/API-KEYS.env → SUPABASE_SERVICE_ROLE_KEY` | The same key you'd configure in Make's Supabase connection |
| `SLACK_PIPELINE_WEBHOOK_URL` | Slack incoming webhook URL | See step 1 below |
| `PIPELINE_INTERACT_SECRET` | Slack signing secret | See step 2 below (only needed for "Mark sent" button) |

---

## Step 1 — Create the Slack webhook

Two options. Pick one.

### Option A: Slack incoming webhook (simplest, 3 min)

1. Go to https://api.slack.com/apps → your existing app (Pipeline Bot) or **Create New App** → From scratch
2. Add the **Incoming Webhooks** feature
3. **Activate** the toggle
4. Click **Add New Webhook to Workspace**, select your target channel (`#applications-pipeline` or wherever)
5. Copy the URL (looks like `https://hooks.slack.com/services/T.../B.../...`)
6. Run: `cd projects/ohm-homes && wrangler secret put SLACK_PIPELINE_WEBHOOK_URL` and paste

**Downside of Option A:** the "Mark sent" button won't work (incoming webhooks don't support interactivity). Skip Step 2 if you go this route — Riket marks status manually via chat.

### Option B: Bot OAuth token (5 extra min, enables Mark-sent button)

1. In your Pipeline Bot app, go to **OAuth & Permissions**
2. Scopes already added (from previous setup): `chat:write`, `chat:write.customize`, `channels:read`
3. Install to workspace, copy Bot User OAuth Token (`xoxb-...`)
4. The Worker needs a small change to post via `chat.postMessage` instead of webhook URL. Set the bot token instead: `wrangler secret put SLACK_PIPELINE_WEBHOOK_URL` and paste the token, OR rename to `SLACK_BOT_TOKEN` and update the Worker code.

For v1, Option A is fine. Add interactivity later.

---

## Step 2 — (Optional) Slack interactivity for Mark-sent button

Only needed if you want the "✅ Mark sent" button in the Slack card to work.

1. In your Pipeline Bot app, go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to On
3. **Request URL:** `https://ohm.homes/api/pipeline/slack-interact` (once the custom domain is bound) or your `*.workers.dev` URL during testing
4. Save changes
5. Go to **Basic Information** → copy the **Signing Secret**
6. Run: `wrangler secret put PIPELINE_INTERACT_SECRET` and paste

(Future enhancement: the current `handleSlackInteract` accepts the payload but doesn't yet verify the signing secret. That's a TODO before going production-grade. For private use it's fine — the worst case is someone forges a "Mark sent" call, which only flips a status flag.)

---

## Step 3 — Deploy

```bash
cd projects/ohm-homes
npm install
wrangler deploy
```

After deploy:
- Worker URL is shown in the output, something like `https://ohm-homes.<account>.workers.dev`
- Custom domain `ohm.homes` is bound separately in Cloudflare dashboard (see wrangler.jsonc comment)
- Cron trigger fires automatically every 30 min — no further setup needed

---

## Step 4 — Wire the riketpatel.com side

Two options for how `applications.json → status: submitted` translates into a queued follow-up:

### Option A: Hit the Worker endpoint (recommended once Worker is live)

Update `riketpatel-site/config.js`:

```js
MAKE_FOLLOWUP_WEBHOOK_URL: "https://ohm.homes/api/pipeline/queue-followup",
```

(Or use the workers.dev URL during testing.)

The `queue-followup.mjs` helper script auto-uses this URL. No other changes needed.

### Option B: Keep both Worker AND Make active

Both endpoints write to the same Supabase table with the same `id` format (`{slug}__{template}__{submitted_at}`) and Supabase's `Prefer: resolution=merge-duplicates` handles dedup. Whichever fires first wins.

**Recommended:** start with Option A (Worker only), retire the Make.com setup, simpler operationally.

---

## Step 5 — Test end-to-end

```bash
curl -X POST "https://ohm-homes.<account>.workers.dev/api/pipeline/queue-followup" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test",
    "company": "Test Co",
    "role_title": "Test Role",
    "recipient_name": "Test team",
    "recipient_email": "riketpatel+test@gmail.com",
    "template_id": "default_24h_followup",
    "submitted_at_iso": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "delay_hours": 0
  }'
```

`delay_hours: 0` → row is immediately eligible. Wait up to 30 min for the cron to fire, then check:
- Supabase `application_followups` table: row should exist with `status='draft_created'`
- Slack channel: Block Kit card should be posted
- Click "Open pre-filled draft in Gmail" → Gmail compose should open with To/Subject/Body filled
- (If Option B Slack setup done) Click "Mark sent" → row's `status` flips to `sent`

To force the cron to run immediately for testing:

```bash
curl -X POST "https://ohm-homes.<account>.workers.dev/api/pipeline/process-queue"
```

This bypasses the cron schedule and runs the queue processor on-demand.

---

## Operational notes

- **Worker observability is enabled** (`observability.enabled: true` in wrangler.jsonc). Logs visible in Cloudflare dashboard.
- **Cron runs every 30 min.** Avg latency from `submitted_at + delay_hours` to Slack card is 0-30 min. Tighter cadence available; edit `triggers.crons` (`*/15 * * * *` for 15-min).
- **Templates fetched from riketpatel.com per run** (edge-cached 5 min). Edit `data/email-templates.json` in the site repo + push → Worker picks up the change within 5 min.
- **No Make.com dependency** once this is live. The Make webhook can stay (write-only, dormant) or be deleted via the Hooks API.
- **No Gmail OAuth state to manage.** Pre-filled compose URLs are stateless.
- **PII in the Slack channel:** the recipient email is in the Gmail compose URL (visible as a button URL). If you want it hidden, restrict who's in the Slack channel.

---

## Switching back to Make.com (if needed)

If the Worker has issues:

1. Empty the cron triggers in `wrangler.jsonc` and redeploy: `"crons": []`
2. Activate Make.com Scenario B (the one that drains the queue)
3. The Make scenario reads from the same Supabase table, so no data loss

You can also run BOTH simultaneously briefly during a migration — Supabase's primary-key dedup handles double-processing safely (the second one would no-op because the row is no longer in `pending` status).

---

## Future enhancements (in priority order)

1. **Verify Slack signing secret** in `handleSlackInteract` — currently accepts unsigned requests. Trivial fix, just hash the request body with `PIPELINE_INTERACT_SECRET` per the [Slack docs](https://api.slack.com/authentication/verifying-requests-from-slack).
2. **7-day check-in auto-queue** — after a row's status sits at `sent` for 7 days, automatically insert a new row with `template_id='default_7d_checkin'`. Daily cron, separate scenario.
3. **Gmail outcome detection** — separate scheduled handler scans `riketpatel@gmail.com` via Gmail API (OAuth refresh token required) for incoming messages matching application patterns, auto-updates `applications.json` status.
4. **Dashboard write-back** — `/jobs/` dashboard reads from `application_followups_admin` view (already created) and shows follow-up state inline with each application card.
