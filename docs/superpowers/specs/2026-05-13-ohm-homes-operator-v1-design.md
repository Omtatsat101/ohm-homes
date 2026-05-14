# Ohm.Homes Operator v1 Design

Created: 2026-05-13

## Goal

Build `Ohm.Homes` as a Windows-local operator that centralizes Riket's local workspace, tools, memory, Claude/Codex bridge, and approved cloud connectors.

The app should:
- start locally on Windows
- open in chat mode each morning
- support both text and voice, with voice as the preferred mode after setup
- observe, preserve, create, archive, and execute local tasks
- never let data leave the machine unless the connector/action is pre-authorized or explicitly confirmed
- keep the existing `ohm.homes` website shell intact as a lightweight remote/status surface

## Existing context

The design intentionally builds on:
- `projects/ohm-homes/` — current Cloudflare Worker shell
- `projects/local-assist-bridge/` — local-safe Claude/Codex bridge
- `projects/obsidian/Riket-Common-Brain/` — durable memory vault
- `primer.md` — active continuity
- `projects/API-KEYS.env` — canonical local key registry

The design does **not** treat archived or leaked proprietary code as an approved source base.

## Product shape

`Ohm.Homes` is a two-part system:

1. `Windows desktop operator`
   - the real control plane
   - owns voice, chat, tools, bridge, permissions, audit, and local execution

2. `ohm.homes web shell`
   - remains a thin Cloudflare Worker dashboard
   - exposes health/status APIs
   - can later surface approved summaries from the desktop operator
   - is not the primary execution brain

## Recommended stack

### Desktop shell

- `Tauri 2.x`
- `React 19.x`
- `Vite`
- `TypeScript`

Why:
- strong Windows-native boundary
- modern UI stack
- fast local iteration
- better security posture than a browser-only shell pretending to be a desktop app

### Local runtime

- `Python` sidecar service
- `SQLite` for local state/audit
- `Ollama` for default local model routing
- local Windows automation via PowerShell/process execution

Why:
- best fit for local voice, local model use, existing Python scripts, and tool orchestration

### Voice

- local STT first
- local TTS fallback
- ElevenLabs `Maya` as pre-authorized outbound voice/TTS path when configured

### Typography / motion layer

- `@chenglou/pretext`

Why:
- gives the interface a digital, living text layer without pushing decorative logic into business-critical controls

## Core principles

1. `Local-first`
   - local files, local memory, local tools, local models first

2. `Permission-visible`
   - every network leave, export, destructive action, and privileged control path is visible and policy-bound

3. `Bridge-native`
   - Claude and Codex coordination must reuse the existing local bridge instead of inventing a new parallel assistant system

4. `Config-driven`
   - behavior can be changed by local files, admin module controls, or future operator edits

5. `Reversible by default`
   - archive and soft actions before hard deletion where possible

## Subsystems

## 1. Desktop shell

Responsibilities:
- main window
- system tray
- startup behavior
- window state
- local IPC between UI and Python runtime

First-launch behavior:
- show onboarding
- ask for key local paths if missing
- run first-launch ritual
- optionally chant `Om` 108 times once, then mark onboarding complete

Daily-launch behavior:
- open directly to chat
- show bridge status, model status, pending tasks, and approvals

## 2. Voice system

Responsibilities:
- mic input
- push-to-talk and wake flow
- transcript display
- TTS output
- mode switching between voice and chat

Day-one behavior:
- app opens in chat first
- voice can be enabled immediately
- local wake-word or local trigger path can be refined later without blocking the initial operator

Voice routing:
- local STT default
- local or Maya TTS depending on config
- if voice cannot complete an action safely, the app asks in voice and mirrors the question in chat

## 3. Permission and export gate

Responsibilities:
- outbound connector policy
- export approvals
- destructive action gating
- privileged tool gating

Policy model:
- `pre-authorized` connectors may make known outbound calls
- `always-confirm` for:
  - file export outside trusted zones
  - sending messages/emails/posts
  - account changes
  - deleting production data
  - destructive filesystem actions

Every sensitive action is written to the audit log.

## 4. Local tool runner

Responsibilities:
- run approved shell commands
- launch local apps
- open folders/files
- run local scripts
- inspect local project state

Constraints:
- tool profiles are defined in config
- dangerous actions require explicit permission class
- actions are logged with timestamp, target, and result

## 5. Connector/plugin layer

Responsibilities:
- unify local and cloud tools behind one operator view
- expose connector health and permission state
- route approved leaves

Initial connector classes:
- local file system
- local shell
- browser automation
- local bridge bundle generator
- Obsidian memory
- Notion task mirror
- Gmail/Calendar/Drive only if authorized in the environment
- Shopify/Make only if approved and configured

Important rule:
- no connector should bypass the permission/export model

## 6. Memory, archive, and observer layer

Responsibilities:
- read `primer.md`
- read/write durable memory to Obsidian
- store local run history and audit entries
- store resumable operator state
- support archive vs delete policies

State classes:
- `continuity` — current active state, from `primer.md`
- `durable memory` — Obsidian vault
- `runtime state` — app-managed JSON/SQLite
- `audit log` — append-only local records

## 7. ohm.homes bridge

Responsibilities:
- keep the current Worker shell alive
- report local-operator-safe status outward if configured
- provide simple read-only or approval-safe dashboards later

Non-goal for v1:
- moving core operator execution into the cloud shell

## Collaboration model: Claude + Codex via bridge

The operator should treat Claude and Codex as two collaborators coordinated through the existing local bridge.

Responsibilities:
- refresh local-safe context bundles using `build-safe-context.ps1`
- expose latest Claude and Codex bundles
- package handoffs
- record review outputs
- mirror durable decisions back into Obsidian and task state

The operator should not pretend Claude is a hidden unrestricted local daemon.
It should support file-based, bridge-based collaboration cleanly.

## Configuration model

Editable local config should be the main control surface.

Recommended files:
- `config/system.toml`
- `config/connectors.toml`
- `config/permissions.toml`
- `config/voice.toml`
- `config/ui.toml`
- `config/runtime-state.json`

Admin module behavior:
- reads the same config files
- writes validated updates back to disk
- asks for confirmation before security-sensitive changes

Secrets:
- read from `projects/API-KEYS.env`
- never mirror raw secrets into Obsidian or portable config exports

## UI model

Primary navigation:
- `Home`
- `Chat`
- `Voice`
- `Projects`
- `Tools`
- `Bridge`
- `Memory`
- `Permissions`

### Home

Shows:
- morning summary
- active sprint
- model health
- bridge health
- pending approvals
- recent tasks

### Chat

Primary command surface.
This is the morning landing page.

### Voice

Mic, TTS, transcript, wake settings, and ritual settings.

### Projects

Quick-open for local projects, status snapshots, recent edits, and task linkage.

### Tools

Shell/file/app/browser actions and reusable macros.

### Bridge

Claude/Codex context refresh, handoff packaging, review intake.

### Memory

Primer, durable notes, audit summaries, and session continuity.

### Permissions

Connector approvals, export history, and destructive-action policy.

## Visual direction

The app should feel:
- digital
- modern
- intentional
- Vedic-influenced without becoming costume UI

How the Vedic layer appears:
- naming
- optional rituals
- typography/motion accents
- symbolic labels and modes

How it should **not** appear:
- breaking accessibility
- forcing Sanskrit labels into critical controls
- making the operator harder to use

`Pretext` should power the living text layer:
- wake strip
- command composer header
- status transitions
- first-launch ritual sequences
- optional future mascot/text interactions

## Data flow

### Command flow

1. user speaks or types
2. runtime classifies intent
3. policy engine decides local-only vs connector vs approval-needed
4. tool/connector executes or asks for confirmation
5. result returns to chat/voice
6. audit log records outcome
7. durable state updates if needed

### Bridge flow

1. user asks for Claude/Codex collaboration
2. bridge bundle refreshes if stale
3. handoff package is created
4. output is stored locally
5. key decisions sync to memory/task layer

## Error handling

The operator must degrade visibly, not silently.

Examples:
- if Ollama is offline, show local-model unavailable and offer chat-only/manual mode
- if Maya is not reachable, fall back to local TTS
- if a connector is unauthorized, show blocked state and required next step
- if a destructive command is requested without permission, deny and explain why

## Testing strategy

### Manual acceptance

- morning launch opens to chat
- bridge refresh works
- primer and Obsidian paths resolve
- shell commands run through the approved path
- unauthorized network leaves are blocked
- pre-authorized leaves execute and log
- voice toggle works
- first-launch ritual runs once only

### Technical checks

- config validation
- permission-policy tests
- IPC contract tests between Tauri and Python runtime
- bridge packaging tests
- audit-log write tests

## Non-goals for v1

- perfect autonomous wake-word stack
- every connector in the ecosystem
- public release polish
- replacing the `ohm.homes` Worker shell
- full cloud orchestration

## Recommendation

Ship v1 as a working local operator spine:
- chat-first
- voice-capable
- bridge-native
- permission-aware
- config-driven

Then add motion, mascot-style interactions, richer Pretext choreography, and broader connector depth after the control plane is stable.
