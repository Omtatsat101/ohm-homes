/**
 * ohm.homes — Riket's internal AI command center.
 * Serves the dashboard from /public and exposes a thin API surface.
 *
 * This is the Cloudflare Workers entry. Static-asset routes are handled
 * by the ASSETS binding (configured in wrangler.jsonc); only API routes
 * are handled here.
 *
 * Routes:
 *   GET  /api/health           — liveness probe
 *   GET  /api/version          — build metadata
 *   GET  /api/mcp/status       — pings the Make MCP toolbox endpoint
 *   *    everything else       — falls through to ASSETS (static dashboard)
 *
 * INTERNAL USE ONLY. Per project_ohm_homes.md memory: never expose
 * internal AI tools or relationship/subscription data publicly.
 */

export interface Env {
	ASSETS: Fetcher;
	// Future bindings (uncomment in wrangler.jsonc after provisioning):
	// STATE: KVNamespace;
	// DB: D1Database;
	// ASSETS_R2: R2Bucket;
	MAKE_MCP_KEY?: string; // wrangler secret put MAKE_MCP_KEY
}

const MAKE_MCP_SERVER_ID = "519c6b0b-0b43-44cb-b986-153f13c360ba";
const MAKE_MCP_REGION = "us2";

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

async function handleHealth(): Promise<Response> {
	return jsonResponse({
		ok: true,
		service: "ohm-homes",
		ts: new Date().toISOString(),
	});
}

function handleVersion(env: Env): Response {
	return jsonResponse({
		service: "ohm-homes",
		version: "0.0.1",
		hasState: typeof (env as any).STATE !== "undefined",
		hasDb: typeof (env as any).DB !== "undefined",
		hasR2: typeof (env as any).ASSETS_R2 !== "undefined",
		mcpKeyConfigured: Boolean(env.MAKE_MCP_KEY),
		makeMcpServerId: MAKE_MCP_SERVER_ID,
		makeMcpRegion: MAKE_MCP_REGION,
	});
}

async function handleMcpStatus(env: Env): Promise<Response> {
	if (!env.MAKE_MCP_KEY) {
		return jsonResponse(
			{
				ok: false,
				error: "MAKE_MCP_KEY secret not configured. Run: wrangler secret put MAKE_MCP_KEY",
			},
			412,
		);
	}
	const url = `https://${MAKE_MCP_REGION}.make.com/mcp/server/${MAKE_MCP_SERVER_ID}/t/${env.MAKE_MCP_KEY}/stateless`;
	try {
		// MCP servers respond to POST with JSON-RPC. A bare GET is enough to
		// know whether the URL is reachable + auth is recognized.
		const probe = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			signal: AbortSignal.timeout(8000),
		});
		const text = await probe.text();
		return jsonResponse({
			ok: probe.ok,
			status: probe.status,
			contentType: probe.headers.get("content-type"),
			bodyPreview: text.slice(0, 500),
			toolboxName: "Kiddie Brand Toolbox",
		});
	} catch (err: any) {
		return jsonResponse(
			{ ok: false, error: String(err?.message ?? err) },
			502,
		);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// API routes
		if (url.pathname === "/api/health") return handleHealth();
		if (url.pathname === "/api/version") return handleVersion(env);
		if (url.pathname === "/api/mcp/status") return handleMcpStatus(env);

		// Everything else → static assets (dashboard SPA)
		return env.ASSETS.fetch(request);
	},
};
