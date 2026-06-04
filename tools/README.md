# claude-tts — read Claude's responses aloud anywhere on Windows

> Two small tools, one job: read text aloud from any window — Claude Desktop, Claude Code terminal, Edge, Outlook, anything.

## Pick one

| | **AutoHotkey** (recommended) | **PowerShell** (no install) |
|---|---|---|
| Trigger | Hotkey: `Ctrl+Shift+H` to read selection, `Ctrl+Shift+R` to read clipboard | Automatic on every clipboard copy |
| Setup | Install AutoHotkey v2 (~1 min) | Built-in |
| Control | Pause / resume / speed up / down / stop | Stop by closing PowerShell window |
| Reads everything you copy? | No — only on hotkey | Yes — anything >30 chars with spaces and letters |
| Best when | You want precise control, don't want random file paths read | You want zero install and don't mind auto-reading |

I'd start with **AutoHotkey**. The hotkey model is much less annoying than auto-read-on-every-copy.

---

## Option 1 — AutoHotkey (recommended)

### Install AutoHotkey v2 once

```pwsh
winget install AutoHotkey.AutoHotkey
```

Or download from <https://www.autohotkey.com/> (pick v2, not v1).

### Run the script

Double-click `claude-tts.ahk`. A green **H** icon appears in your system tray. The script is running.

### Use it anywhere

| Action | Hotkey |
|---|---|
| **Read selected text** (anywhere — Claude Desktop, terminal, Edge, anywhere) | `Ctrl+Shift+H` |
| Read current clipboard | `Ctrl+Shift+R` |
| Stop reading | `Ctrl+Shift+S` |
| Pause / resume | `Ctrl+Shift+P` |
| Slower | `Ctrl+Shift+,` (comma) |
| Faster | `Ctrl+Shift+.` (period) |

Most common flow: highlight Claude's response with the mouse → press `Ctrl+Shift+H` → it reads.

### Make it auto-start at login

1. Press `Win+R`, type `shell:startup`, hit Enter
2. Drag a shortcut to `claude-tts.ahk` into that folder
3. Done — runs on every login

### Stop it

Right-click the tray H icon → Exit. Or `Ctrl+Shift+S` to stop current reading without exiting.

---

## Option 2 — PowerShell (no install)

### Run

```pwsh
powershell -ExecutionPolicy Bypass -File C:\Users\riket\OneDrive\Desktop\Organized\projects\ohm-homes\tools\claude-tts.ps1
```

Keep that window open. Any time you copy text that looks like prose (more than 30 characters, contains spaces and real words), it reads it.

### Stop

`Ctrl+C` in that PowerShell window, or close the window.

### Auto-start

Drop a shortcut into `shell:startup` with target:

```
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\path\to\claude-tts.ps1
```

The `-WindowStyle Hidden` keeps the console out of your way.

---

## Get a better voice (works for both)

Default Windows SAPI voices are okay. The "Natural" voices are much better — Aria, Guy, Jenny, Sonia, Tony.

1. **Windows Settings → Time & language → Speech → Manage voices**
2. Click **Add** → pick a "Natural" voice (e.g., **Microsoft Aria Natural**)
3. Download (~50 MB each)
4. Both scripts will auto-prefer a Natural voice on next launch

There are ~20 Natural English voices. Aria and Guy are the most natural-sounding to most ears.

---

## When you'd want to upgrade beyond Windows SAPI

These two scripts use Microsoft's local TTS. It's free, offline, fast — and "good enough." For ElevenLabs-quality voices, the path is:

- Deploy the ohm.homes Cloudflare Worker (see `OHM-HOMES-SECURITY-LOCKDOWN.md`)
- Add the `/api/read/synthesize` endpoint to the Worker (already coded — `src/index.ts`)
- Set `ELEVENLABS_API_KEY` as a Worker secret
- The `https://ohm.homes/read/` page then uses ElevenLabs voices

That's a 15-minute setup, but only buys you better voice quality. For everyday "read me Claude's response," local SAPI through these scripts is plenty.

---

## Notes

- **What gets cleaned before reading:** triple-backtick code blocks (skipped entirely), inline code (backticks stripped), markdown headers, URLs (read as "[link]"), bold/italic markers, bullet markers, repeated whitespace.
- **What's not handled:** non-English text. If you paste a chunk that's heavily Hindi or Gujarati, the English voice will mispronounce. Pick a matching voice in Windows Settings for that.
- **Volume:** controlled via Windows volume mixer like any other app. The synth itself is at 90% by default — adjust in the `.ps1` if needed.
- **Privacy:** all text-to-speech happens locally on your machine. No external API call. No data leaves your computer.
