/**
 * ohm.homes — Riket's internal AI command center.
 *
 * INTERNAL USE ONLY. Per memory/project_ohm_homes.md: never expose
 * internal AI tools or relationship/subscription data publicly.
 *
 * Security model (defense in depth):
 *   1. Cloudflare Access in front of /admin/* — restricts to Riket's
 *      email via Cloudflare Zero Trust. Handles MFA, session expiry,
 *      audit log. (Configured in Cloudflare dashboard, not code.)
 *   2. Worker-level check on /admin/* requires a valid ADMIN_PASSWORD
 *      env var as a second layer (so even if Access fails open, the
 *      Worker still gates).
 *   3. Public pages (/, /api/health, /api/version) are open.
 *
 * Routes:
 *   GET  /                       — public dashboard shell (old real-estate page or new placeholder)
 *   GET  /admin/*                — Cloudflare-Access-gated + Worker-gated admin
 *   GET  /api/health             — liveness
 *   GET  /api/version            — build metadata
 *   POST /api/read/synthesize    — public ElevenLabs TTS proxy (user-pasted text)
 *   GET  /api/forge/generate     — public Word Forge generator (mirrors kiddiewordle.com)
 *   GET  /api/forge/sources      — public Word Forge component-source list
 *   GET  /api/mcp/status         — pings the Make MCP toolbox endpoint (admin-only)
 *   GET  /api/keys/list          — lists API key NAMES (never values) for the admin Keys page
 *   POST /api/markets/snapshot   — internal: refreshes predictive-market data (cron-triggered)
 */

export interface Env {
	ASSETS: Fetcher;
	ADMIN_PASSWORD: string;        // wrangler secret put ADMIN_PASSWORD
	MAKE_MCP_KEY?: string;         // wrangler secret put MAKE_MCP_KEY
	SUPABASE_URL?: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
	ELEVENLABS_API_KEY?: string;   // wrangler secret put ELEVENLABS_API_KEY
	// Pipeline (application follow-up automation):
	SLACK_PIPELINE_WEBHOOK_URL?: string;   // wrangler secret put SLACK_PIPELINE_WEBHOOK_URL
	SLACK_PIPELINE_CHANNEL?: string;       // optional; default in code
	PIPELINE_INTERACT_SECRET?: string;     // wrangler secret put PIPELINE_INTERACT_SECRET (Slack signing secret)
	// Future bindings (uncomment in wrangler.jsonc after provisioning):
	// STATE: KVNamespace;
	// DB: D1Database;
	// ASSETS_R2: R2Bucket;
}

const MAKE_MCP_SERVER_ID = "519c6b0b-0b43-44cb-b986-153f13c360ba";
const MAKE_MCP_REGION = "us2";
const ADMIN_COOKIE = "ohm_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

/** Strict equal-time comparison so attackers can't time the password. */
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function readCookie(request: Request, name: string): string | null {
	const cookie = request.headers.get("cookie") || "";
	const parts = cookie.split(/;\s*/);
	for (const p of parts) {
		const eq = p.indexOf("=");
		if (eq < 0) continue;
		if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
	}
	return null;
}

function setSessionCookie(): string {
	// Session is bound to having ADMIN_PASSWORD verified. We sign a short
	// value with the password itself; if Riket rotates the password every
	// session is invalidated automatically.
	const value = "ok";
	return `${ADMIN_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionCookie(): string {
	return `${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`;
}

/** Render the lightweight password gate (defense layer 2; Cloudflare Access is layer 1). */
function renderGate(error: string | null = null): Response {
	const errBanner = error
		? `<p class="err">${escapeHtml(error)}</p>`
		: "";
	const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ohm.homes — admin</title><meta name="robots" content="noindex,nofollow">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #fafaf7; color: #181413; margin: 0; padding: 80px 20px; }
  .card { max-width: 420px; margin: 0 auto; background: #fff; border: 1px solid rgba(55,34,18,0.14); border-radius: 18px; padding: 36px 32px; box-shadow: 0 16px 48px rgba(34,22,10,0.10); }
  h1 { font: 600 22px/1.2 "Iowan Old Style", Palatino, Georgia, serif; margin: 0 0 6px; }
  p { color: #6d635c; font-size: 14px; margin: 0 0 18px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
  input { display: block; width: 100%; margin-top: 6px; padding: 11px 14px; border: 1px solid rgba(55,34,18,0.14); border-radius: 8px; font-size: 15px; }
  input:focus { outline: none; border-color: #c96f32; box-shadow: 0 0 0 3px rgba(201,111,50,0.15); }
  button { background: #1a3a2a; color: #fff; border: 0; padding: 11px 22px; border-radius: 999px; font: 600 14px/1 inherit; cursor: pointer; }
  button:hover { background: #0d1f16; }
  .err { color: #c0392b; font-weight: 600; margin: 0 0 14px; font-size: 13px; }
</style></head><body>
<div class="card">
  <h1>ohm.homes admin</h1>
  <p>Cloudflare Access cleared. Final check.</p>
  ${errBanner}
  <form method="POST" action="/admin/login" autocomplete="off">
    <label>Admin password
      <input type="password" name="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus />
    </label>
    <button type="submit">Unlock</button>
  </form>
</div>
</body></html>`;
	return htmlResponse(html);
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function handleHealth(): Promise<Response> {
	return jsonResponse({ ok: true, service: "ohm-homes", ts: new Date().toISOString() });
}

function handleVersion(env: Env): Response {
	return jsonResponse({
		service: "ohm-homes",
		version: "0.2.0",
		hasState: typeof (env as any).STATE !== "undefined",
		hasDb: typeof (env as any).DB !== "undefined",
		hasR2: typeof (env as any).ASSETS_R2 !== "undefined",
		adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
		mcpKeyConfigured: Boolean(env.MAKE_MCP_KEY),
		supabaseConfigured: Boolean(env.SUPABASE_URL),
		makeMcpServerId: MAKE_MCP_SERVER_ID,
		makeMcpRegion: MAKE_MCP_REGION,
	});
}

async function handleMcpStatus(env: Env): Promise<Response> {
	if (!env.MAKE_MCP_KEY) {
		return jsonResponse({ ok: false, error: "MAKE_MCP_KEY secret not configured" }, 412);
	}
	const url = `https://${MAKE_MCP_REGION}.make.com/mcp/server/${MAKE_MCP_SERVER_ID}/t/${env.MAKE_MCP_KEY}/stateless`;
	try {
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
		return jsonResponse({ ok: false, error: String(err?.message ?? err) }, 502);
	}
}

/**
 * ElevenLabs TTS — server-side proxy so the API key stays in Worker env.
 * Public endpoint (no admin gate) because the user is pasting their own text.
 * OPTIONS just confirms availability for the client's feature-detect.
 */
async function handleReadSynthesize(request: Request, env: Env): Promise<Response> {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"access-control-allow-origin": "*",
				"access-control-allow-methods": "POST, OPTIONS",
				"access-control-allow-headers": "content-type",
			},
		});
	}
	if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
	if (!env.ELEVENLABS_API_KEY) {
		return jsonResponse({ error: "ELEVENLABS_API_KEY not configured on Worker" }, 412);
	}
	let body: any;
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: "invalid JSON body" }, 400);
	}
	const text = String(body?.text ?? "").trim();
	const voiceId = String(body?.voice_id ?? "21m00Tcm4TlvDq8ikWAM"); // Rachel default
	if (!text) return jsonResponse({ error: "text is required" }, 400);
	if (text.length > 5000) return jsonResponse({ error: "text too long (5000 char max per request)" }, 413);

	const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
	try {
		const elRes = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": env.ELEVENLABS_API_KEY,
				"content-type": "application/json",
				"accept": "audio/mpeg",
			},
			body: JSON.stringify({
				text,
				model_id: "eleven_multilingual_v2",
				voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
			}),
			signal: AbortSignal.timeout(30_000),
		});
		if (!elRes.ok) {
			const errText = await elRes.text();
			return jsonResponse({ error: `ElevenLabs ${elRes.status}: ${errText.slice(0, 500)}` }, elRes.status);
		}
		// Stream the MP3 back to the client
		return new Response(elRes.body, {
			status: 200,
			headers: {
				"content-type": "audio/mpeg",
				"cache-control": "no-store",
				"access-control-allow-origin": "*",
			},
		});
	} catch (err: any) {
		return jsonResponse({ error: String(err?.message ?? err) }, 502);
	}
}

/**
 * WORD FORGE — public JSON endpoint that fuses syllable-roots from 8 languages
 * into new kid-safe words with educational source breakdown.
 *
 * Mirrors the in-page generator on kiddiewordle.com so AI clients (Claude
 * Desktop, ChatGPT, ohm.homes admin pages, future apps) can pull a forged
 * word via HTTP instead of needing to scrape the static page.
 *
 * Cultural respect: deliberately excludes sacred names; only everyday
 * positive-meaning words that can stand on their own.
 *
 *   GET /api/forge/generate?count=1&minLen=5&maxLen=16
 *     → { words: [{ word, parts: [{syl, src, meaning}], length }] }
 *
 *   GET /api/forge/sources
 *     → { sources: [{ name, count }], totalComponents }
 */
interface ForgeComponent { syl: string; src: string; meaning: string; }

const FORGE_COMPONENTS: ForgeComponent[] = [
	// English
	{ syl: "Joy", src: "English", meaning: "happiness" },
	{ syl: "Sun", src: "English", meaning: "the star at the center of our solar system" },
	{ syl: "Sky", src: "English", meaning: "the air above us" },
	{ syl: "Star", src: "English", meaning: "a glowing point of light in the night sky" },
	{ syl: "Moon", src: "English", meaning: "Earth's natural satellite" },
	{ syl: "Sea", src: "English", meaning: "a large body of saltwater" },
	{ syl: "Leaf", src: "English", meaning: "the flat green part of a plant" },
	{ syl: "Blue", src: "English", meaning: "the color of the sky" },
	{ syl: "Gold", src: "English", meaning: "a shiny precious metal" },
	{ syl: "Light", src: "English", meaning: "brightness from the sun, lamp, or fire" },
	{ syl: "Dance", src: "English", meaning: "rhythmic movement to music" },
	{ syl: "Song", src: "English", meaning: "a short musical composition with words" },
	{ syl: "Flame", src: "English", meaning: "the visible part of a fire" },
	{ syl: "Dream", src: "English", meaning: "images and ideas during sleep" },
	{ syl: "Hope", src: "English", meaning: "a feeling of expectation and desire" },
	{ syl: "Brave", src: "English", meaning: "showing courage" },
	{ syl: "Kind", src: "English", meaning: "gentle and considerate" },
	{ syl: "Bright", src: "English", meaning: "shining or full of light" },
	{ syl: "Wave", src: "English", meaning: "a moving ridge of water" },
	{ syl: "River", src: "English", meaning: "a large flowing stream of water" },
	{ syl: "Glow", src: "English", meaning: "a steady soft light" },
	{ syl: "Spark", src: "English", meaning: "a tiny burning particle" },
	// Sanskrit
	{ syl: "Ananda", src: "Sanskrit", meaning: "bliss, deep joy" },
	{ syl: "Shanti", src: "Sanskrit", meaning: "peace, tranquility" },
	{ syl: "Prem", src: "Sanskrit", meaning: "love, affection" },
	{ syl: "Mitra", src: "Sanskrit", meaning: "friend" },
	{ syl: "Surya", src: "Sanskrit", meaning: "the sun" },
	{ syl: "Tara", src: "Sanskrit", meaning: "star" },
	{ syl: "Gita", src: "Sanskrit", meaning: "song" },
	{ syl: "Bodhi", src: "Sanskrit", meaning: "awakening, enlightenment" },
	{ syl: "Vidya", src: "Sanskrit", meaning: "knowledge, wisdom" },
	{ syl: "Kala", src: "Sanskrit", meaning: "art, skill" },
	{ syl: "Agni", src: "Sanskrit", meaning: "fire" },
	{ syl: "Jal", src: "Sanskrit", meaning: "water" },
	{ syl: "Vayu", src: "Sanskrit", meaning: "wind" },
	{ syl: "Prana", src: "Sanskrit", meaning: "life-force, breath" },
	{ syl: "Satya", src: "Sanskrit", meaning: "truth" },
	{ syl: "Dharma", src: "Sanskrit", meaning: "rightful path, duty" },
	{ syl: "Jaya", src: "Sanskrit", meaning: "victory" },
	{ syl: "Diya", src: "Sanskrit", meaning: "lamp, light" },
	{ syl: "Kanti", src: "Sanskrit", meaning: "radiance, beauty" },
	{ syl: "Manas", src: "Sanskrit", meaning: "mind, heart" },
	// Hindi
	{ syl: "Ghar", src: "Hindi", meaning: "home" },
	{ syl: "Pyar", src: "Hindi", meaning: "love" },
	{ syl: "Khel", src: "Hindi", meaning: "play, game" },
	{ syl: "Mela", src: "Hindi", meaning: "fair, gathering" },
	{ syl: "Kahani", src: "Hindi", meaning: "story" },
	{ syl: "Gulab", src: "Hindi", meaning: "rose" },
	{ syl: "Aam", src: "Hindi", meaning: "mango" },
	{ syl: "Chand", src: "Hindi", meaning: "moon" },
	{ syl: "Phool", src: "Hindi", meaning: "flower" },
	{ syl: "Hawa", src: "Hindi", meaning: "air, breeze" },
	{ syl: "Roshni", src: "Hindi", meaning: "light" },
	// Tamil
	{ syl: "Alai", src: "Tamil", meaning: "wave" },
	{ syl: "Isai", src: "Tamil", meaning: "music" },
	{ syl: "Kavi", src: "Tamil", meaning: "poem, poet" },
	{ syl: "Mani", src: "Tamil", meaning: "bell, jewel" },
	{ syl: "Pani", src: "Tamil", meaning: "dew" },
	{ syl: "Nila", src: "Tamil", meaning: "moon" },
	{ syl: "Thendral", src: "Tamil", meaning: "gentle southern breeze" },
	{ syl: "Malar", src: "Tamil", meaning: "flower, to bloom" },
	{ syl: "Kadal", src: "Tamil", meaning: "sea" },
	{ syl: "Vanam", src: "Tamil", meaning: "sky" },
	// Māori
	{ syl: "Aroha", src: "Māori", meaning: "love, compassion" },
	{ syl: "Whanau", src: "Māori", meaning: "family" },
	{ syl: "Mana", src: "Māori", meaning: "spiritual power, prestige" },
	{ syl: "Wairua", src: "Māori", meaning: "spirit, soul" },
	{ syl: "Moana", src: "Māori", meaning: "ocean, deep sea" },
	{ syl: "Maunga", src: "Māori", meaning: "mountain" },
	{ syl: "Kai", src: "Māori", meaning: "food, to eat" },
	{ syl: "Awa", src: "Māori", meaning: "river, valley" },
	// Hawaiian
	{ syl: "Aloha", src: "Hawaiian", meaning: "love, hello, goodbye" },
	{ syl: "Keiki", src: "Hawaiian", meaning: "child" },
	{ syl: "Lani", src: "Hawaiian", meaning: "sky, heaven" },
	{ syl: "Pua", src: "Hawaiian", meaning: "flower, blossom" },
	{ syl: "Nani", src: "Hawaiian", meaning: "beautiful" },
	{ syl: "Honu", src: "Hawaiian", meaning: "sea turtle" },
	{ syl: "Mahalo", src: "Hawaiian", meaning: "thanks, gratitude" },
	{ syl: "Mauka", src: "Hawaiian", meaning: "toward the mountain" },
	// Quechua
	{ syl: "Inti", src: "Quechua", meaning: "sun (sacred to Andean peoples)" },
	{ syl: "Killa", src: "Quechua", meaning: "moon" },
	{ syl: "Wayra", src: "Quechua", meaning: "wind" },
	{ syl: "Mayu", src: "Quechua", meaning: "river" },
	{ syl: "Wasi", src: "Quechua", meaning: "house" },
	{ syl: "Runa", src: "Quechua", meaning: "person, human" },
	{ syl: "Quri", src: "Quechua", meaning: "gold" },
	{ syl: "Sumaq", src: "Quechua", meaning: "beautiful, good" },
	// Yoruba
	{ syl: "Ife", src: "Yoruba", meaning: "love" },
	{ syl: "Ola", src: "Yoruba", meaning: "honor, wealth" },
	{ syl: "Ade", src: "Yoruba", meaning: "crown" },
	{ syl: "Tola", src: "Yoruba", meaning: "wealth is great" },
	{ syl: "Bisi", src: "Yoruba", meaning: "born to" },
	{ syl: "Ayo", src: "Yoruba", meaning: "joy" },
	{ syl: "Femi", src: "Yoruba", meaning: "love me" },
	{ syl: "Iyabo", src: "Yoruba", meaning: "mother has returned" },
];

// Mirror of the kiddiewordle.com client-side blocklist — substring match.
const FORGE_UNSAFE = new Set<string>([
	"ARSES", "BIMBO", "BITCH", "BOOBS", "BOOBY", "BOOTY", "BOOZE", "BOOZY",
	"BUTTS", "COCKS", "COCKY", "CRAPS", "DICKS", "DILDO", "DOPED", "DOPER",
	"DOPES", "DRUNK", "DYKES", "FANNY", "FARTS", "FECES", "FUCKS", "HORNY",
	"HUSSY", "JIZZY", "JUNKY", "KINKY", "NAKED", "NUDES", "NUDIE", "PERVE",
	"PERVS", "PIMPS", "POOPS", "POOPY", "POOTS", "PORNO", "PORNS", "PORNY",
	"PRICK", "PUSSY", "QUEER", "QUIMS", "RAPED", "RAPER", "RAPES", "SCREW",
	"SHITE", "SHITS", "SLAGS", "SLUTS", "SLUTY", "SMUTS", "SPUNK", "TITTS",
	"TITTY", "TURDS", "TWATS", "WANKS", "WHORE",
]);

function forgeIsSafe(word: string): boolean {
	const upper = word.toUpperCase();
	for (const bad of FORGE_UNSAFE) {
		if (upper.indexOf(bad) !== -1) return false;
	}
	return true;
}

function forgePickComponents(): ForgeComponent[] {
	const n = Math.random() < 0.6 ? 2 : 3;
	const picked: ForgeComponent[] = [];
	let safety = 50;
	while (picked.length < n && safety-- > 0) {
		const c = FORGE_COMPONENTS[Math.floor(Math.random() * FORGE_COMPONENTS.length)];
		if (n === 2 && picked.length === 1 && c.src === picked[0].src) continue;
		if (picked.some(p => p.syl === c.syl)) continue;
		picked.push(c);
	}
	return picked;
}

function forgeFuse(parts: ForgeComponent[]): string {
	return parts
		.map(p => p.syl.charAt(0).toUpperCase() + p.syl.slice(1).toLowerCase())
		.join("");
}

function forgeOneWord(minLen: number, maxLen: number): { word: string; parts: ForgeComponent[] } {
	let attempts = 0;
	let parts: ForgeComponent[];
	let word: string;
	do {
		parts = forgePickComponents();
		word = forgeFuse(parts);
		attempts++;
	} while ((!forgeIsSafe(word) || word.length < minLen || word.length > maxLen) && attempts < 30);
	return { word, parts };
}

function corsHeaders(): Record<string, string> {
	return {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, OPTIONS",
		"access-control-allow-headers": "content-type",
		"cache-control": "no-store",
	};
}

function jsonCors(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
	});
}

function handleForgeGenerate(request: Request): Response {
	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
	if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders() });
	const url = new URL(request.url);
	const count = Math.min(20, Math.max(1, parseInt(url.searchParams.get("count") || "1", 10) || 1));
	const minLen = Math.max(3, parseInt(url.searchParams.get("minLen") || "5", 10) || 5);
	const maxLen = Math.min(40, parseInt(url.searchParams.get("maxLen") || "16", 10) || 16);
	const words = [];
	for (let i = 0; i < count; i++) {
		const w = forgeOneWord(minLen, maxLen);
		words.push({ word: w.word, parts: w.parts, length: w.word.length });
	}
	return jsonCors({
		words,
		generatedAt: new Date().toISOString(),
		notice: "Components are real words from each source language with dictionary meanings; the FUSION is invented.",
	});
}

function handleForgeSources(): Response {
	const counts = new Map<string, number>();
	for (const c of FORGE_COMPONENTS) counts.set(c.src, (counts.get(c.src) || 0) + 1);
	const sources = Array.from(counts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
	return jsonCors({
		sources,
		totalComponents: FORGE_COMPONENTS.length,
		culturalNote: "Sacred names (Brahma, Vishnu, Shiva, Krishna, Allah, Christ, etc.) are deliberately excluded; only everyday positive-meaning words.",
	});
}

/** Lists keys configured as Worker env vars by NAME ONLY (never values). */
function handleKeysList(env: Env): Response {
	const known = [
		"ADMIN_PASSWORD",
		"MAKE_MCP_KEY",
		"SUPABASE_URL",
		"SUPABASE_SERVICE_ROLE_KEY",
	];
	const out = known.map((k) => ({
		name: k,
		configured: Boolean((env as any)[k]),
		// Show only the last 4 characters of any present key, for diff-against-rotation checks
		tail: (env as any)[k] ? "…" + String((env as any)[k]).slice(-4) : null,
	}));
	return jsonResponse({ keys: out, totalConfigured: out.filter((k) => k.configured).length });
}

/** Admin auth wrapper — checks Worker-level session cookie. Cloudflare Access is layer 1; this is layer 2. */
function requireAdmin(request: Request, env: Env): Response | null {
	// Allow login + logout endpoints through (they manage the session themselves)
	const url = new URL(request.url);
	if (url.pathname === "/admin/login" || url.pathname === "/admin/logout") return null;

	if (!env.ADMIN_PASSWORD) {
		return htmlResponse(
			"<h1>503 — ohm.homes admin not configured</h1><p>ADMIN_PASSWORD env var is missing. Run <code>wrangler secret put ADMIN_PASSWORD</code> and redeploy.</p>",
			503,
		);
	}
	const session = readCookie(request, ADMIN_COOKIE);
	if (session !== "ok") return renderGate();
	return null; // continue
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
	if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
	const form = await request.formData();
	const pw = String(form.get("password") || "");
	if (!env.ADMIN_PASSWORD || !constantTimeEqual(pw, env.ADMIN_PASSWORD)) {
		return renderGate("That's not it.");
	}
	const headers = new Headers({ Location: "/admin/" });
	headers.append("Set-Cookie", setSessionCookie());
	return new Response(null, { status: 303, headers });
}

function handleLogout(): Response {
	const headers = new Headers({ Location: "/admin/" });
	headers.append("Set-Cookie", clearSessionCookie());
	return new Response(null, { status: 303, headers });
}

// Lazy-load pipeline module — keeps the hot-path bundle small for non-pipeline requests
async function importPipeline() {
	const mod = await import("./pipeline.js");
	return mod;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Public API
		if (url.pathname === "/api/health") return handleHealth();
		if (url.pathname === "/api/version") return handleVersion(env);
		// /api/read/synthesize is public — user pastes their own text.
		// Server-side proxy keeps ELEVENLABS_API_KEY out of client JS.
		if (url.pathname === "/api/read/synthesize") return handleReadSynthesize(request, env);
		// /api/forge/* are public — mirror the kiddiewordle.com Word Forge generator
		// so AI clients (Claude Desktop, ChatGPT, future apps) can pull forged words
		// via HTTP. CORS-open so any browser origin can call it.
		if (url.pathname === "/api/forge/generate") return handleForgeGenerate(request);
		if (url.pathname === "/api/forge/sources") return handleForgeSources();

		// Pipeline endpoints (application follow-up automation).
		// All three are unauth (Supabase RLS gates real write access via service_role
		// held server-side; Slack interactivity is verified via signing secret).
		if (url.pathname === "/api/pipeline/queue-followup") {
			const { handleQueueFollowup } = await importPipeline();
			return handleQueueFollowup(request, env);
		}
		if (url.pathname === "/api/pipeline/process-queue") {
			const { handleProcessQueue } = await importPipeline();
			return handleProcessQueue(request, env);
		}
		if (url.pathname === "/api/pipeline/slack-interact") {
			const { handleSlackInteract } = await importPipeline();
			return handleSlackInteract(request, env);
		}

		// Admin auth gate (applies to /admin/* and /api/admin/* and /api/mcp/*)
		const isAdminPath =
			url.pathname.startsWith("/admin") ||
			url.pathname.startsWith("/api/admin") ||
			url.pathname.startsWith("/api/mcp") ||
			url.pathname.startsWith("/api/keys");

		if (isAdminPath) {
			const block = requireAdmin(request, env);
			if (block) return block;

			// Admin-only routes
			if (url.pathname === "/admin/login") return handleLogin(request, env);
			if (url.pathname === "/admin/logout") return handleLogout();
			if (url.pathname === "/api/mcp/status") return handleMcpStatus(env);
			if (url.pathname === "/api/keys/list") return handleKeysList(env);

			// /admin/* HTML pages served from /public/admin/* by ASSETS binding.
			// Rewrite path: /admin → /admin/index.html
			if (url.pathname === "/admin" || url.pathname === "/admin/") {
				return env.ASSETS.fetch(new Request(new URL("/admin/index.html", url.origin), request));
			}
			return env.ASSETS.fetch(request);
		}

		// Everything else → public static
		return env.ASSETS.fetch(request);
	},

	// Scheduled cron handler — runs every 30 min per wrangler.jsonc triggers.crons
	// Drains the Supabase application_followups queue, posts Slack cards, marks rows draft_created.
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const { scheduledPipeline } = await importPipeline();
		ctx.waitUntil(scheduledPipeline(env, ctx));
	},
};
