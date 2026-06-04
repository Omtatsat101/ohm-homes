/**
 * pipeline.ts — Application follow-up automation as a Cloudflare Worker.
 *
 * Alternative to (or coexistent with) Make.com Scenarios A and B documented in
 * riketpatel-site/scripts/make-com-followup-setup.md.
 *
 * What it does:
 *   - Receives follow-up queue inserts via POST /api/pipeline/queue-followup
 *   - Scheduled cron drains the Supabase application_followups table:
 *     for each row where status='pending' AND run_at < now(),
 *     - fetches email-templates.json from riketpatel.com
 *     - interpolates variables
 *     - posts a Slack Block Kit card with the email body included for
 *       one-click copy to Gmail compose
 *     - updates status to 'draft_created'
 *   - Receives Slack button interactions via POST /api/pipeline/slack-interact
 *     to flip status to 'sent' when Riket clicks "Mark sent" in Slack.
 *
 * Architecture choice: this Worker does NOT create Gmail drafts directly
 * (would require persistent OAuth refresh token storage). Instead it builds
 * a Gmail compose URL that prefills To/Subject/Body, and includes that URL
 * as a button in the Slack card. One click opens the draft pre-filled.
 *
 * The pipeline can run alongside the Make.com scenarios — both write to the
 * same Supabase table, but only ONE should be active at a time. To switch,
 * deactivate Scenario B in Make.com OR disable the cron trigger in wrangler.
 */

export interface PipelineEnv {
	SUPABASE_URL?: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
	SLACK_PIPELINE_WEBHOOK_URL?: string;  // Slack incoming webhook OR bot oauth (see deployment guide)
	SLACK_PIPELINE_CHANNEL?: string;      // Optional default channel; only used if bot oauth
	PIPELINE_INTERACT_SECRET?: string;    // Slack signing secret for interactivity verification
}

interface FollowupRow {
	id: string;
	slug: string;
	company: string;
	role_title: string;
	recipient_name: string | null;
	recipient_email: string | null;
	template_id: string;
	submitted_at: string;
	run_at: string;
	status: string;
	drafted_at: string | null;
	sent_at: string | null;
	gmail_draft_id: string | null;
	notes: string | null;
}

interface EmailTemplate {
	delay_hours?: number;
	label?: string;
	subject: string;
	body: string;
}

interface EmailTemplatesFile {
	schema_version: number;
	templates: Record<string, EmailTemplate>;
}

const TEMPLATES_URL = "https://riketpatel.com/data/email-templates.json";

// ── HTTP helpers ────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
}

async function supaFetch(env: PipelineEnv, path: string, init: RequestInit = {}): Promise<Response> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error("Supabase env vars not configured");
	}
	const headers = new Headers(init.headers as HeadersInit);
	headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
	headers.set("Authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
	if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
	return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
}

// ── Template interpolation ──────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
	return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), template);
}

function buildGmailComposeUrl(to: string, subject: string, body: string): string {
	const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
	return `https://mail.google.com/mail/?${params.toString()}`;
}

// ── Slack post ───────────────────────────────────────────────────────────────

async function postSlackCard(
	env: PipelineEnv,
	row: FollowupRow,
	subject: string,
	body: string,
	composeUrl: string,
): Promise<void> {
	if (!env.SLACK_PIPELINE_WEBHOOK_URL) {
		throw new Error("SLACK_PIPELINE_WEBHOOK_URL not configured");
	}
	// Slack messages have a 3000-char limit per block text. Truncate the body
	// preview if needed (the full body is still in the compose URL).
	const bodyPreview = body.length > 1800 ? body.slice(0, 1800) + "\n\n… [truncated — click 'Open in Gmail' for full]" : body;

	const blocks = [
		{ type: "header", text: { type: "plain_text", text: "📬 Follow-up draft ready", emoji: true } },
		{
			type: "section",
			fields: [
				{ type: "mrkdwn", text: `*Company:*\n${row.company}` },
				{ type: "mrkdwn", text: `*Role:*\n${row.role_title}` },
				{ type: "mrkdwn", text: `*Slug:*\n\`${row.slug}\`` },
				{ type: "mrkdwn", text: `*Template:*\n\`${row.template_id}\`` },
			],
		},
		{ type: "section", text: { type: "mrkdwn", text: `*Subject:*\n${subject}` } },
		{ type: "section", text: { type: "mrkdwn", text: `*Body (preview):*\n\`\`\`\n${bodyPreview}\n\`\`\`` } },
		{
			type: "actions",
			block_id: `pipeline_${row.id}`,
			elements: [
				{
					type: "button",
					text: { type: "plain_text", text: "✉️ Open pre-filled draft in Gmail", emoji: true },
					url: composeUrl,
					style: "primary",
				},
				{
					type: "button",
					text: { type: "plain_text", text: "📎 View materials", emoji: true },
					url: `https://riketpatel.com/resume/${row.slug}/`,
				},
				{
					type: "button",
					text: { type: "plain_text", text: "📋 Pipeline", emoji: true },
					url: "https://riketpatel.com/jobs/",
				},
				{
					type: "button",
					text: { type: "plain_text", text: "✅ Mark sent", emoji: true },
					action_id: "mark_sent",
					value: row.id,
				},
			],
		},
		{
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: `_Edit the body in Gmail to add your voice before sending. \`Mark sent\` updates the pipeline. Drafted by ohm.homes Worker._`,
				},
			],
		},
	];

	const payload = { text: `📬 Follow-up draft ready: ${row.company} — ${row.role_title}`, blocks };

	const res = await fetch(env.SLACK_PIPELINE_WEBHOOK_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Slack post failed: ${res.status} ${text}`);
	}
}

// ── Queue processing ────────────────────────────────────────────────────────

export async function processQueue(env: PipelineEnv): Promise<{ processed: number; errors: string[] }> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error("Supabase env vars not configured");
	}

	// 1. Fetch pending rows where run_at < now()
	const nowIso = new Date().toISOString();
	const url = `/application_followups?status=eq.pending&run_at=lt.${encodeURIComponent(nowIso)}&order=run_at.asc&limit=20`;
	const queueRes = await supaFetch(env, url, { method: "GET" });
	if (!queueRes.ok) throw new Error(`Supabase select failed: ${queueRes.status}`);
	const rows: FollowupRow[] = await queueRes.json();
	if (rows.length === 0) return { processed: 0, errors: [] };

	// 2. Fetch the email-templates.json (cached at the edge via Cloudflare)
	const tplRes = await fetch(TEMPLATES_URL, { cf: { cacheTtl: 300 } as any });
	if (!tplRes.ok) throw new Error(`Templates fetch failed: ${tplRes.status}`);
	const tplFile: EmailTemplatesFile = await tplRes.json();

	const errors: string[] = [];
	let processed = 0;

	for (const row of rows) {
		try {
			const template = tplFile.templates[row.template_id] || tplFile.templates["default_24h_followup"];
			if (!template) {
				errors.push(`Template ${row.template_id} not found, no fallback`);
				continue;
			}
			const vars: Record<string, string> = {
				recipient_name: row.recipient_name || "team",
				role_title: row.role_title,
				company: row.company,
				slug: row.slug,
				submitted_date: "yesterday",
			};
			const subject = interpolate(template.subject, vars);
			const body = interpolate(template.body, vars);
			const composeUrl = buildGmailComposeUrl(row.recipient_email || "", subject, body);

			await postSlackCard(env, row, subject, body, composeUrl);

			// 3. Update row: status=draft_created, drafted_at=now()
			const updateRes = await supaFetch(env, `/application_followups?id=eq.${encodeURIComponent(row.id)}`, {
				method: "PATCH",
				body: JSON.stringify({
					status: "draft_created",
					drafted_at: nowIso,
					notes: (row.notes ? row.notes + " | " : "") + `Drafted via ohm-homes Worker @ ${nowIso}`,
				}),
			});
			if (!updateRes.ok) {
				const txt = await updateRes.text();
				errors.push(`Update failed for ${row.id}: ${updateRes.status} ${txt}`);
				continue;
			}
			processed += 1;
		} catch (e) {
			errors.push(`Row ${row.id}: ${(e as Error).message}`);
		}
	}

	return { processed, errors };
}

// ── HTTP route handlers ─────────────────────────────────────────────────────

export async function handleQueueFollowup(req: Request, env: PipelineEnv): Promise<Response> {
	if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);
	let payload: any;
	try { payload = await req.json(); }
	catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

	const required = ["slug", "company", "role_title", "template_id", "submitted_at_iso"];
	for (const k of required) {
		if (!payload[k]) return jsonResponse({ error: `Missing ${k}` }, 400);
	}

	const delayHours = Number(payload.delay_hours) || 24;
	const submitted = new Date(payload.submitted_at_iso);
	if (isNaN(submitted.getTime())) return jsonResponse({ error: "Invalid submitted_at_iso" }, 400);
	const runAt = new Date(submitted.getTime() + delayHours * 3600 * 1000);
	const id = `${payload.slug}__${payload.template_id}__${payload.submitted_at_iso}`;

	const row = {
		id,
		slug: payload.slug,
		company: payload.company,
		role_title: payload.role_title,
		recipient_name: payload.recipient_name || null,
		recipient_email: payload.recipient_email || null,
		template_id: payload.template_id,
		submitted_at: submitted.toISOString(),
		run_at: runAt.toISOString(),
		status: "pending",
	};

	const res = await supaFetch(env, "/application_followups", {
		method: "POST",
		headers: { Prefer: "resolution=merge-duplicates" } as HeadersInit,
		body: JSON.stringify(row),
	});
	if (!res.ok) {
		const txt = await res.text();
		return jsonResponse({ error: "Insert failed", supabase: txt, status: res.status }, 500);
	}
	return jsonResponse({ queued: true, id, run_at: runAt.toISOString() });
}

export async function handleProcessQueue(req: Request, env: PipelineEnv): Promise<Response> {
	if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ error: "POST or GET" }, 405);
	const result = await processQueue(env);
	return jsonResponse({ ok: true, ...result });
}

// Slack signing secret verification.
// Slack signs every interactivity request with HMAC-SHA256 of `v0:{ts}:{body}` using
// the signing secret. Reject if mismatch or timestamp older than 5 minutes (replay defense).
async function verifySlackSignature(
	req: Request,
	rawBody: string,
	signingSecret: string,
): Promise<{ ok: boolean; reason?: string }> {
	const ts = req.headers.get("x-slack-request-timestamp");
	const sig = req.headers.get("x-slack-signature");
	if (!ts || !sig) return { ok: false, reason: "missing signature headers" };

	const tsNum = parseInt(ts, 10);
	if (isNaN(tsNum)) return { ok: false, reason: "bad ts" };
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - tsNum) > 300) return { ok: false, reason: "timestamp too old (replay defense)" };

	const baseString = `v0:${ts}:${rawBody}`;
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(signingSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(baseString));
	const hexBytes = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
	const expected = `v0=${hexBytes}`;
	// Constant-time compare
	if (expected.length !== sig.length) return { ok: false, reason: "signature length mismatch" };
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
	if (diff !== 0) return { ok: false, reason: "signature mismatch" };
	return { ok: true };
}

export async function handleSlackInteract(req: Request, env: PipelineEnv): Promise<Response> {
	if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

	// Read raw body once for signature verification + form parsing
	const rawBody = await req.text();

	if (env.PIPELINE_INTERACT_SECRET) {
		const verify = await verifySlackSignature(req, rawBody, env.PIPELINE_INTERACT_SECRET);
		if (!verify.ok) {
			console.warn(`[slack interact] signature verify failed: ${verify.reason}`);
			return jsonResponse({ error: "Signature verification failed", reason: verify.reason }, 401);
		}
	} else {
		console.warn("[slack interact] PIPELINE_INTERACT_SECRET not set — accepting unsigned requests");
	}

	// Slack sends interactivity as application/x-www-form-urlencoded with a payload field
	const params = new URLSearchParams(rawBody);
	const payloadStr = params.get("payload");
	if (!payloadStr) return jsonResponse({ error: "No payload" }, 400);

	let payload: any;
	try { payload = JSON.parse(payloadStr); } catch { return jsonResponse({ error: "Bad JSON" }, 400); }

	const action = payload.actions?.[0];
	if (action?.action_id === "mark_sent") {
		const rowId = action.value;
		const nowIso = new Date().toISOString();
		const res = await supaFetch(env, `/application_followups?id=eq.${encodeURIComponent(rowId)}`, {
			method: "PATCH",
			body: JSON.stringify({ status: "sent", sent_at: nowIso }),
		});
		if (!res.ok) {
			const txt = await res.text();
			return jsonResponse({ error: "Update failed", supabase: txt }, 500);
		}
		// Slack accepts a "response_action" or a replacement message
		return jsonResponse({
			replace_original: false,
			response_type: "ephemeral",
			text: `✅ Marked \`${rowId}\` as sent.`,
		});
	}

	return jsonResponse({ ignored: true, action: action?.action_id });
}

// ── 7-day check-in auto-queue ──────────────────────────────────────────────
//
// For each application_followups row where:
//   - status = 'sent' (Riket clicked Mark sent, so the first follow-up went)
//   - sent_at < (now - 7 days)
//   - no later row for the same slug with template_id = 'default_7d_checkin' exists
// Queue a new row with template_id = 'default_7d_checkin' and run_at = now()
// so the next processQueue picks it up and posts a Slack card.
//
// Runs once per day. Avoids re-queueing if the check-in was already sent.

export async function enqueueCheckins(env: PipelineEnv): Promise<{ queued: number; errors: string[] }> {
	if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error("Supabase env vars not configured");
	}
	const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
	const nowIso = new Date().toISOString();

	// Find sent rows older than 7 days
	const sentRes = await supaFetch(
		env,
		`/application_followups?status=eq.sent&sent_at=lt.${encodeURIComponent(sevenDaysAgoIso)}&select=id,slug,company,role_title,recipient_name,recipient_email,submitted_at&limit=20`,
		{ method: "GET" },
	);
	if (!sentRes.ok) throw new Error(`Supabase sent-rows fetch failed: ${sentRes.status}`);
	const sentRows: Partial<FollowupRow>[] = await sentRes.json();
	if (sentRows.length === 0) return { queued: 0, errors: [] };

	const errors: string[] = [];
	let queued = 0;

	for (const row of sentRows) {
		try {
			if (!row.slug) continue;
			// Skip if a 7d check-in already exists for this slug
			const checkRes = await supaFetch(
				env,
				`/application_followups?slug=eq.${encodeURIComponent(row.slug)}&template_id=eq.default_7d_checkin&limit=1&select=id`,
				{ method: "GET" },
			);
			if (!checkRes.ok) {
				errors.push(`Dedup check failed for ${row.slug}: ${checkRes.status}`);
				continue;
			}
			const existing = await checkRes.json();
			if (Array.isArray(existing) && existing.length > 0) continue;

			// Queue new check-in row
			const newId = `${row.slug}__default_7d_checkin__${nowIso}`;
			const newRow = {
				id: newId,
				slug: row.slug,
				company: row.company,
				role_title: row.role_title,
				recipient_name: row.recipient_name,
				recipient_email: row.recipient_email,
				template_id: "default_7d_checkin",
				submitted_at: row.submitted_at, // preserve original submission for narrative consistency
				run_at: nowIso,                  // immediately eligible
				status: "pending",
				notes: "Auto-queued 7-day check-in by ohm-homes Worker",
			};
			const insertRes = await supaFetch(env, "/application_followups", {
				method: "POST",
				headers: { Prefer: "resolution=merge-duplicates" } as HeadersInit,
				body: JSON.stringify(newRow),
			});
			if (!insertRes.ok) {
				errors.push(`Insert failed for ${row.slug}: ${insertRes.status}`);
				continue;
			}
			queued += 1;
		} catch (e) {
			errors.push(`Slug ${row.slug}: ${(e as Error).message}`);
		}
	}

	return { queued, errors };
}

export async function handleEnqueueCheckins(req: Request, env: PipelineEnv): Promise<Response> {
	if (req.method !== "POST" && req.method !== "GET") return jsonResponse({ error: "POST or GET" }, 405);
	const result = await enqueueCheckins(env);
	return jsonResponse({ ok: true, ...result });
}

// ── Scheduled (cron) handler ────────────────────────────────────────────────
//
// Two crons fire scheduledPipeline:
//   - "*/30 * * * *" (every 30 min) — drains the pending queue
//   - "15 9 * * *"   (daily at 09:15 UTC) — auto-queues 7-day check-ins
// We branch on the cron expression to pick the right job.

export async function scheduledPipeline(
	env: PipelineEnv,
	_ctx: ExecutionContext,
	cron?: string,
): Promise<void> {
	try {
		// Daily check-in cron
		if (cron && cron.startsWith("15 9")) {
			const result = await enqueueCheckins(env);
			console.log(`[pipeline cron daily] check-ins queued=${result.queued} errors=${result.errors.length}`);
			result.errors.forEach((e) => console.error(`[pipeline cron daily] ${e}`));
			return;
		}
		// Default: 30-min queue processor
		const result = await processQueue(env);
		console.log(`[pipeline cron] processed=${result.processed} errors=${result.errors.length}`);
		if (result.errors.length > 0) {
			result.errors.forEach((e) => console.error(`[pipeline cron] ${e}`));
		}
	} catch (e) {
		console.error(`[pipeline cron] fatal: ${(e as Error).message}`);
	}
}
