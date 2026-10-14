# Om System - Ohm.Homes Operator v1

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
| `python-runtime/ohm_runtime/handoff.py` | Bridge handoffs: packages request + safe-context bundle refs + selected files into `<handoff_dir>/<id>/` (`handoff.json`, `request.md`, `files/`, `reviews/`) and records review outputs (text or a review file) back into that folder |
| `python-runtime/ohm_runtime/voice.py` | Pluggable STT/TTS engines picked in `voice.toml`: `whisper_cpp` (local STT binary), `sapi` (Windows speech) and `piper` (local TTS binary), `maya` (ElevenLabs, outbound via the gate, falls back to the local engine). Engines that cannot run report `engine unavailable: ...` instead of failing silently. Voice toggle persists to `config/runtime-state.json` |
| `python-runtime/ohm_runtime/memory.py` | Reads `primer.md` and the Obsidian vault from `system.toml [paths]` (notes list/search/read, `.md` inside the vault only, `.obsidian/.trash/.git` skipped). Writes (append/create) are off by default (`[memory] writes = false`); when on, each one goes through `memory.write` (default `approve`) and is refused if it contains a value from the secrets file |
| `python-runtime/ohm_runtime/operator.py` | Chat commands (`/help /status /tools /run /bridge /bridge refresh /handoff /handoffs /review /reviews /primer /notes /note /remember /approvals`); free text goes to local Ollama if online, otherwise degrades visibly |
| `python-runtime/main.py` | HTTP sidecar on `127.0.0.1` only (refuses non-loopback), Host + Origin allowlist, JSON-only POSTs |
| `ui/` | Tauri 2 + React 19 + Vite + TypeScript shell, Sanctum layout, 8 nav views, Chat is the landing view |
| `ui/src-tauri/src/sidecar.rs` | Tauri starts `python main.py` as a plain child process (no shell, no console window, output to `data/sidecar.log`) and kills it on quit; skips spawning if something already listens on the port. The webview gets no new capability |
| `ui/src-tauri/src/main.rs` | System tray with Show / Hide / Quit |

Safety defaults:
- Every outbound connector ships `enabled = false`. Outbound is allowed only when a connector is enabled, `preauthorized = true`, and the host is in `allowed_hosts`. Otherwise `connector.unauthorized` applies (default `deny`).
- `destructive`, `export.untrusted`, `message.send`, `account.change`, `connector.unauthorized` can never be configured as `allow`; config load fails if they are.
- Bridge handoffs and reviews go through the gate (`bridge.handoff` / `bridge.review`): every selected file must resolve inside `bridge.file_roots`, not match `deny_globs` or the secrets file, and stay under the size/count limits; the handoff folder is treated as an export, so outside a trusted zone it needs approval. Every outcome is audited.
- Maya TTS is only reachable through `connectors.elevenlabs` (ships `enabled = false`, `preauthorized = true`); its key is read from the secrets file at call time and never logged; redirects are refused.
- Unknown tools or action kinds are denied. Extra args are rejected unless the profile sets `extra_args = true`.

Sidecar endpoints: `GET /status /tools /projects /permissions /approvals /audit?limit=N /health`, `GET /bridge/handoffs`, `GET /bridge/reviews?handoff=<id>`, `POST /chat {text}`, `POST /bridge/handoffs {target, request, files}`, `POST /bridge/reviews {handoff_id, reviewer, text | path}`, `GET /voice/status /voice/transcript`, `POST /voice/settings {enabled}`, `POST /voice/turn {audio_base64}` (16 kHz mono WAV, transcribe -> chat -> speak), `POST /voice/speak {text}`, `GET /memory /memory/notes?q= /memory/note?path=`, `POST /memory/notes {path, text, mode}`, `POST /approvals/<id> {decision: "approve"|"reject"}`.

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
npm run tauri dev           # desktop window; starts the sidecar itself if it is not already running
npm run dev                 # or browser only, http://127.0.0.1:1420
npm run tauri build         # NSIS/MSI installer
```

Sidecar launch settings (environment variables, read by the Tauri app): `OHM_PYTHON` (default `python`), `OHM_OPERATOR_DIR` (default: the `ohm-operator` folder the app was built from), `OHM_SIDECAR_PORT` (default `8765`). The app runs the sidecar from the checkout, so an installer build still expects this folder and Python on the machine.

If you change `runtime.port`, also update `connect-src` in `ui/src-tauri/tauri.conf.json` and set `VITE_SIDECAR_URL`.

## Stubbed / not yet built

- Bridge bundle filenames in `connectors.toml` are placeholders until checked against the real `local-assist-bridge` output. The handoff folder layout is the operator's own; `handoff_dir` defaults to `data/handoffs` and is not yet matched to any inbox the bridge itself may use. Handoffs reference bundles (path + freshness), they do not copy them, and nothing is sent to Claude/Codex automatically.
- Voice: engine paths in `voice.toml` are placeholders until whisper.cpp / piper are installed; set `tts.maya.voice_id`, add `ELEVENLABS_API_KEY` to the secrets file, and set `connectors.elevenlabs.enabled = true` to use Maya. Not verified here: real STT/TTS output and mic capture in WebView2 (tests use fake engines). No wake word; voice replies are not mirrored into the Chat view yet.
- Maya TTS is the only outbound client. The gate decides for the others, but no client code exists for Notion/Gmail/etc.
- Home summary, Projects status snapshots, automatic mirroring of bridge decisions into Obsidian, admin config editing, autostart, onboarding / 108 Om ritual, layout + mode switcher, Pretext motion.
- The sidecar is not bundled into the installer (no frozen Python); stopping it is a process kill, so no `runtime.stop` audit row is written on quit.
- Not verified here: running the Windows Tauri binary (tray, sidecar spawn). `cargo check --target x86_64-pc-windows-msvc` passes, `tauri.conf.json` is validated against the CLI schema and `npm run build` passes.
