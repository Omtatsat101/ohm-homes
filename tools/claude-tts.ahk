; ──────────────────────────────────────────────────────────────────────────
; claude-tts.ahk — global TTS hotkeys for any window on Windows.
;
; Designed for reading Claude responses in:
;   • Claude Desktop app
;   • Claude Code terminal (any terminal: cmd.exe, PowerShell, Windows Terminal)
;   • Any text source — emails, PDFs, web pages, contracts
;
; Hotkeys:
;   Ctrl+Shift+R  → read the CURRENT CLIPBOARD aloud
;   Ctrl+Shift+H  → copy the SELECTED text and read it (one-shot)
;   Ctrl+Shift+S  → stop / cancel any reading in progress
;   Ctrl+Shift+P  → pause / resume current reading
;   Ctrl+Shift+,  → slower (decrease rate by 1, range -10..+10)
;   Ctrl+Shift+.  → faster (increase rate by 1)
;
; Uses native Windows SAPI voices. To change voice quality:
;   Windows Settings → Time & Language → Speech → Manage voices → install
;   "Natural" voices (Microsoft Aria Natural, Guy Natural, Jenny Natural, etc.)
;
; Requires AutoHotkey v2. Install: https://www.autohotkey.com/  (or `winget install AutoHotkey.AutoHotkey`)
;
; Run: double-click this file. A green H icon appears in the system tray.
;      Right-click the H icon → Exit, to stop.
; Auto-start at login: put a shortcut in shell:startup
; ──────────────────────────────────────────────────────────────────────────

#Requires AutoHotkey v2.0
#SingleInstance Force

; Initialize the SAPI voice once
voice := ComObject("SAPI.SpVoice")
voice.Rate := 0  ; -10 .. +10

; Find a Natural voice if available, fall back to default
tokens := voice.GetVoices()
selected := false
Loop tokens.Count {
    name := tokens.Item(A_Index - 1).GetDescription()
    if InStr(name, "Natural") {
        voice.Voice := tokens.Item(A_Index - 1)
        selected := true
        TrayTip("claude-tts", "Voice: " name, 0x1)
        break
    }
}
if !selected
    TrayTip("claude-tts", "Using default voice. Install a 'Natural' voice in Windows Settings for better quality.", 0x1)

A_IconTip := "claude-tts — Ctrl+Shift+R reads clipboard"

; ── Hotkeys ────────────────────────────────────────────────────────────────

; Ctrl+Shift+R — read current clipboard
^+r::ReadClipboard()

; Ctrl+Shift+H — copy selection, then read
^+h::ReadSelection()

; Ctrl+Shift+S — stop
^+s:: {
    global voice
    voice.Speak("", 2)  ; SVSFlagsAsync | SVSFPurgeBeforeSpeak — purges queue
}

; Ctrl+Shift+P — pause / resume
isPaused := false
^+p:: {
    global voice, isPaused
    if isPaused {
        voice.Resume()
        isPaused := false
    } else {
        voice.Pause()
        isPaused := true
    }
}

; Ctrl+Shift+, — slower
^+,:: {
    global voice
    voice.Rate := Max(voice.Rate - 1, -10)
    TrayTip("claude-tts", "Rate: " voice.Rate, 0x1)
}

; Ctrl+Shift+. — faster
^+.:: {
    global voice
    voice.Rate := Min(voice.Rate + 1, 10)
    TrayTip("claude-tts", "Rate: " voice.Rate, 0x1)
}

; ── Helpers ────────────────────────────────────────────────────────────────

ReadClipboard() {
    global voice
    text := A_Clipboard
    if (StrLen(text) < 2) {
        TrayTip("claude-tts", "Clipboard is empty.", 0x2)
        return
    }
    text := CleanForTTS(text)
    voice.Speak("", 2)  ; cancel anything in progress
    voice.Speak(text, 1) ; SVSFlagsAsync = 1
}

ReadSelection() {
    global voice
    ; Save clipboard, copy selection, read, restore
    saved := A_Clipboard
    A_Clipboard := ""
    Send "^c"
    if !ClipWait(0.8) {
        A_Clipboard := saved
        TrayTip("claude-tts", "Nothing was selected.", 0x2)
        return
    }
    text := A_Clipboard
    A_Clipboard := saved  ; restore so you don't lose your original clipboard
    text := CleanForTTS(text)
    voice.Speak("", 2)
    voice.Speak(text, 1)
}

; Strip / soften content that doesn't read well aloud
CleanForTTS(text) {
    ; Remove triple-backtick code blocks (skip them entirely)
    text := RegExReplace(text, "s)``````.*?``````", " . [code block skipped] . ")
    ; Inline code → just say it normally without backticks
    text := RegExReplace(text, "``([^``]+)``", "$1")
    ; Markdown headers ##, ###, etc → just the text
    text := RegExReplace(text, "(?m)^#{1,6}\s*", "")
    ; Strip URLs that aren't going to read meaningfully
    text := RegExReplace(text, "https?://\S+", "[link]")
    ; Markdown bold/italic markers
    text := RegExReplace(text, "\*\*([^*]+)\*\*", "$1")
    text := RegExReplace(text, "\*([^*]+)\*", "$1")
    ; Bullet markers
    text := RegExReplace(text, "(?m)^[-*]\s*", "")
    ; Collapse multiple whitespace
    text := RegExReplace(text, "\s+", " ")
    return Trim(text)
}
