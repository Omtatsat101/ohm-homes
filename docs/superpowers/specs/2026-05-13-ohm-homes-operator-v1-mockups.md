# Ohm.Homes Operator v1 — Mockups (Round 1)

> Calling Kalki: C:/Users/Riket/Study/CALLING_KALKI.md
> Status of this file: 1 (OmCreate)

Created: 2026-05-13
Companion to: `2026-05-13-ohm-homes-operator-v1-design.md` (status 0 — design canon)

---

## Round overview

Round 1 = static mockups only. The prototype ladder for this project:

| Round | Deliverable | Purpose |
|-------|-------------|---------|
| 1     | Static ASCII / markdown mockups (this file) | Cheapest iteration on layout + chrome direction |
| 2…N   | HTML / Vite single-page prototype           | Ongoing sprint feedback between rounds |
| Final | Tauri + React clickable shell               | Closest-to-truth before code-complete |

---

## Decisions locked from review

1. **All four layouts ship as user-selectable themes (`asana`).** The operator carries a layout switcher; the user picks the chrome that fits the moment.

   | Asana    | Strength                                  | Default for                |
   |----------|-------------------------------------------|----------------------------|
   | Sanctum  | Familiar, full-nav, scales to all 8 tabs  | App default                |
   | Operator | Three-pane, every subsystem visible       | Heavy bridge/permissions days |
   | Mandala  | Centered, ceremonial                      | First-launch ritual, festivals |
   | Ritual   | Fullscreen, voice-first                   | Morning wake, eyes-off use |

2. **Vedic intensity follows the active action mode, not the layout.** The chrome dims or rises with what you are doing.

   | Mode | Status | Chrome intensity                                       |
   |------|--------|--------------------------------------------------------|
   | 1    | Create     | Ritual-forward — Sanskrit primary, motion alive, mantra strip wide |
   | 0    | Preserve   | Dual labels — English + Sanskrit, motion dimmed       |
   | −1   | Archive    | Quiet accents — English only, Om mark in header only, no motion |

3. **Master taxonomy lives in `Calling Kalki`** at `C:/Users/Riket/Study/CALLING_KALKI.md`. Every README in the operator (and every other Riket project) links back to it.

---

## Layout 1 — Sanctum (default)

Sidebar nav + center chat + slim right status. Scales to all 8 v1 tabs.

### Sanctum in **mode 0 (Preserve)** — dual labels, the everyday morning state

```
+----------+-------------------------------------------------+
| OM  Ohm  |  Sambhasana / Chat * morning session            |
|          | ----------------------------------------------- |
| > Home   |  ~ pretext (dimmed): "namaste, riket" ~         |
|   Griha  |                                                 |
| * Chat   |  > riket                                        |
|   Sambh. |    summarize yesterday's bridge handoffs        |
| > Voice  |                                                 |
|   Vaani  |  < ohm                                          |
| > Projct |    3 handoffs * 1 pending claude review         |
|   Karya  |    [open bridge] [archive] [approve]            |
| > Tools  |                                                 |
|   Yantra |                                                 |
| > Bridge |                                                 |
|   Setu   |                                                 |
| > Memory |                                                 |
|   Smriti |                                                 |
| > Permis |                                                 |
|   Anumati|                                                 |
|          |                                                 |
| -------- |  +------------------------------+   voice (o)   |
| mode  0  |  | type or speak...             |               |
| * bridge |  +------------------------------+               |
| * ollama |                                                 |
+----------+-------------------------------------------------+
```

### Sanctum in **mode 1 (Create)** — ritual-forward, Sanskrit rises

```
+----------+-------------------------------------------------+
| OM  Ohm  |  ~~~ Sambhasana ~ srishti ~ 06:42 morning ~~~   |
|          | ----------------------------------------------- |
| Griha    |  ~~~ pretext alive: "the morning blooms" ~~~    |
| Sambh. * |                                                 |
| Vaani    |  > riket                                        |
| Karya    |    begin a new gogo-flag episode draft          |
| Yantra   |                                                 |
| Setu     |  < ohm                                          |
| Smriti   |    creating in OmCreate (1).                    |
| Anumati  |    preserved canon: red-flag character spec     |
|          |    bridge: fresh * codex: ready                 |
|          |    [draft script] [shot list] [thumbnail]       |
|          |                                                 |
|          |                                                 |
|          |                                                 |
| -------- |  +------------------------------+  voice ((o))  |
| mode  1  |  | speak or type, srashta...    |               |
| ~~~ ~~~  |  +------------------------------+               |
| OM rises |                                                 |
+----------+-------------------------------------------------+
```

### Sanctum in **mode −1 (Archive)** — quiet, English-only, audit-forward

```
+----------+-------------------------------------------------+
| Ohm      |  Chat * archive session                         |
|          | ----------------------------------------------- |
| Home     |                                                 |
| Chat *   |  > riket                                        |
| Voice    |    archive old president-orange-flag versions   |
| Projects |                                                 |
| Tools    |  < ohm                                          |
| Bridge   |    archive mode (-1).                           |
| Memory   |    7 files queued -> Kalki-6174                 |
| Permis.. |    canon preserved: red, yellow, green,         |
|          |    current president-orange-flag                |
|          |    [review queue] [confirm archive] [cancel]    |
|          |                                                 |
|          |                                                 |
|          |                                                 |
|          |                                                 |
| -------- |  +------------------------------+               |
| mode -1  |  | type...                      |               |
| audit on |  +------------------------------+               |
+----------+-------------------------------------------------+
```

---

## Layout 2 — Operator (three-pane)

Left nav + center chat + right context rail. Best when bridge, approvals, and memory all need to stay visible.

### Operator in **mode 0 (Preserve)** — default

```
+--------+----------------------------------+----------------+
| OM     | ~ wake strip * 06:42 local ~     | Today          |
| Griha  |                                  | -------------- |
| Sambh.*| > riket                          | 2 approvals    |
| Vaani  |   refresh codex bundle           | 1 export held  |
| Karya  |                                  | bridge: fresh  |
| Yantra | < ohm                            |                |
| Setu   |   bundle rebuilt * 14kb          | Projects/Karya |
| Smriti |   [view] [send to codex]         | ohm-homes      |
| Anumati|                                  | local-bridge   |
|        | > riket                          | obsidian-brain |
| ------ |   what's safe to export today?   |                |
| mode 0 |                                  | Memory/Smriti  |
| *fresh | < ohm                            | primer OK      |
|        |   2 connectors authorized...     | last sync 9m   |
|        |                                  |                |
|        | +-------------------------+ (o)  | Approvals      |
|        | | type / speak            |      | * gmail draft  |
|        | +-------------------------+      | * drive export |
+--------+----------------------------------+----------------+
```

---

## Layout 3 — Mandala (centered)

Chat sits in a centered card. Subsystem status arcs above, nav arcs below, Pretext motion runs at the foot. Use for first-launch ritual, festivals, ceremonial moments — not the daily driver.

### Mandala in **mode 1 (Create)** — first-launch / ritual onboarding

```
+------------------------------------------------------------+
|              OM   Ohm.Homes  *  Tue May 13                 |
|                                                            |
|       Bridge*   Models*   Memory*   Permissions*           |
|                                                            |
|             +--------------------------+                   |
|             |                          |                   |
|             |   namaste, riket.        |                   |
|             |                          |                   |
|             |   what shall we begin?   |                   |
|             |                          |                   |
|             +--------------------------+                   |
|                                                            |
|        Griha   Sambh.   Vaani   Karya   Yantra   ...       |
|                                                            |
|       ~~~  . pretext: 108 . om . om . om .  ~~~            |
+------------------------------------------------------------+
```

---

## Layout 4 — Ritual (fullscreen)

Wake strip on top, everything else behind Cmd+K. Voice-first. The morning meditation layout.

### Ritual in **mode 1 (Create)** — morning wake

```
+------------------------------------------------------------+
|  ~~ OM  ~  the morning is held softly  ~  bridge fresh ~~  |
|                                                            |
|                                                            |
|                                                            |
|              namaste, riket.                               |
|                                                            |
|              what shall we begin?                          |
|                                                            |
|              -------------------                           |
|                                                            |
|                                                            |
|                                                            |
|              +----------------------------+    (o) voice   |
|              |  type or speak...          |                |
|              +----------------------------+                |
|                                                            |
|              Cmd+K command palette * everything else       |
|              lives one keystroke away                      |
+------------------------------------------------------------+
```

---

## Mode + layout switcher (proposed)

Lives behind a single keybind (`Cmd+,` or `Ctrl+,`). Two axes, never coupled.

```
+------------------------------------------------------------+
|  +-------------------------------------------------+       |
|  |  Asana / Layout       |  Mode / Status          |       |
|  |  ( ) Sanctum          |  ( ) Create   ( 1 )     |       |
|  |  ( ) Operator         |  ( ) Preserve ( 0 )     |       |
|  |  ( ) Mandala          |  ( ) Archive  (-1)      |       |
|  |  ( ) Ritual           |                         |       |
|  |                                                 |       |
|  |  [ apply ]   [ remember as default ]            |       |
|  +-------------------------------------------------+       |
|                                                            |
|  layout = how the chrome arranges                          |
|  mode   = which Vedic intensity colors the chrome          |
+------------------------------------------------------------+
```

State machine:

- Layout is persistent. The operator remembers your last-used layout per day-of-week (morning vs evening preferences).
- Mode is task-scoped. A new chat session starts in mode 0 (Preserve). The user shifts to 1 or −1 explicitly, or the system proposes a shift when intent classifies that way ("archive these…" → propose −1).

---

## Open questions for Round 2

1. Does the **Mandala** layout auto-trigger on first launch every day, then fade to the user's default after the morning ritual? Or only on the literal first-ever launch?
2. Where does the mode switcher live in **Ritual** layout where everything is hidden? Voice command only, or surface a single mode glyph somewhere?
3. **Preserve mode** dual labels: shown always, or only on hover/focus? Always-on is more identity; hover-only is calmer.
4. **Mantra strip** wide in Create — does it scroll, pulse, or hold still? Pretext capability check needed.
5. Should the right-rail in **Operator** be collapsible to recover Sanctum-like horizontal space?

---

## Next round

Round 2 = HTML/Vite single-page prototype with:
- All four layouts switchable from one running app
- Live 1 / 0 / −1 mode toggle that recolors the chrome
- Stubbed chat (no LLM wired yet)
- The layout/mode switcher above, functional
- Pretext motion proof-of-concept on the wake strip

Final round (Tauri + React) only after the HTML/Vite version has been lived with for a sprint.
