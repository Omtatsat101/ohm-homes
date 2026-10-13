# Om System - Ohm.Homes Operator v1 (slice 1)

Windows-local operator spine: chat-first, permission-aware, config-driven.
Spec: `docs/superpowers/specs/2026-05-13-ohm-homes-operator-v1-design.md` (+ mockups).
Master taxonomy: `C:/Users/Riket/Study/CALLING_KALKI.md`.

The `ohm.homes` Worker shell at the repo root is untouched and unrelated to this folder.

## What's built

| Path | What |
|---|---|
| `config/*.toml` | system (runtime, paths, model, tool profiles), connectors, permissions, voice, ui |
| `python-runtime/ohm_runtime/permissions.py` | Gate: `allow` / `approve` / `deny` for tool runs, outbound connectors, exports, destructive ops, messages, account changes, local model |
| `python-runtime/ohm_runtime/audit.py` | SQLite append-only audit log (UPDATE/DELETE blocked by triggers) + approval queue with expiry |
| `python-runtime/ohm_runtime/runner.py` | Tool runner: config-defined argv profiles only, `shell=False`, timeouts, every call gated + audited |
| `python-runtime/ohm_runtime/bridge.py` | File-based interface to `projects/local-assist-bridge`: reports each bundle as fresh / stale / missing from real file mtimes |
| `python-runtime/ohm_runtime/operator.py` | Chat commands (`/help /status /tools /run /bridge /bridge refresh /approvals`); free text goes to local Ollama if online, otherwise degrades visibly |
| `python-runtime/main.py` | HTTP sidecar on `127.0.0.1` only (refuses non-loopback), Host + Origin allowlist, JSON-only POSTs |
| `ui/` | Tauri 2 + React 19 + Vite + TypeScript shell, Sanctum layout, 8 nav views, Chat is the landing view |

Safety defaults:
- Every outbound connector ships `enabled = false`. Outbound is allowed only when a connector is enabled, `preauthorized = true`, and the host is in `allowed_hosts`. Otherwise `connector.unauthorized` applies (default `deny`).
- `destructive`, `export.untrusted`, `message.send`, `account.change`, `connector.unauthorized` can never be configured as `allow`; config load fails if they are.
- Unknown tools or action kinds are denied. Extra args are rejected unless the profile sets `extra_args = true`.

Sidecar endpoints: `GET /status /tools /projects /permissions /approvals /audit?limit=N /health`, `POST /chat {text}`, `POST /approvals/<id> {decision: "approve"|"reject"}`.

## Run on Windows

Requires Python 3.11+, Node 20+, Rust + the Tauri 2 Windows prerequisites (WebView2, MSVC build tools).

```pwsh
cd C:\Users\riket\OneDrive\Desktop\Organized\projects\ohm-homes\ohm-operator

# 1. Edit config\system.toml [paths] if your workspace is not ~/OneDrive/Desktop/Organized,
#    and config\connectors.toml [bridge.bundles] to match the real bundle filenames.

# 2. Sidecar
cd python-runtime
python main.py              # http://127.0.0.1:8765, DB at ..\data\operator.db

# tests
pip install -r requirements.txt
python -m pytest

# 3. UI (second terminal)
cd ..\ui
npm install
npm run tauri dev           # desktop window
npm run dev                 # or browser only, http://127.0.0.1:1420
npm run tauri build         # NSIS/MSI installer
```

If you change `runtime.port`, also update `connect-src` in `ui/src-tauri/tauri.conf.json` and set `VITE_SIDECAR_URL`.

## Stubbed / not yet built

- Bridge bundle filenames in `connectors.toml` are placeholders until checked against the real `local-assist-bridge` output. Handoff packaging and review intake are not built yet.
- Voice: the toggle is a placeholder. No STT, TTS, or Maya calls.
- No outbound connector executes anything yet. The gate decides, but no client code exists for Notion/Gmail/Maya/etc.
- Home summary, Projects status snapshots, Memory writes to Obsidian, admin config editing, tray, autostart, onboarding / 108 Om ritual, layout + mode switcher, Pretext motion.
- The Tauri app does not spawn the sidecar. Start it yourself or set it up as a login task.
- Not verified here: the Windows Tauri binary (`cargo`/`tauri build`). `tauri.conf.json` is validated against the CLI schema and `npm run build` passes.
