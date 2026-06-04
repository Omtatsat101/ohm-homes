# ──────────────────────────────────────────────────────────────────────────
# claude-tts.ps1 — PowerShell fallback if you don't want to install AutoHotkey.
#
# Mode: AUTO-READ on clipboard change.
#   Anytime you copy text (Ctrl+C) that looks like prose, this script reads it.
#
# Filters to avoid reading file paths / URLs / short copies you didn't mean:
#   • Must be at least 30 characters
#   • Must contain at least one space (filters out URLs and paths)
#   • Must contain a-z letters (filters out hashes / numbers)
#   • Skipped if the clipboard hasn't changed
#
# Run: open PowerShell → `pwsh ./claude-tts.ps1` (or `powershell ./claude-tts.ps1`)
# Stop: close the PowerShell window, or Ctrl+C.
# Auto-start at login: put a shortcut to this in shell:startup with target:
#   powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\path\to\claude-tts.ps1
#
# Voice quality: native Windows SAPI. Install "Natural" voices in
#   Windows Settings → Time & Language → Speech → Manage voices.
# ──────────────────────────────────────────────────────────────────────────

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Prefer a Natural voice if available
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled }
$natural = $voices | Where-Object { $_.VoiceInfo.Name -match "Natural" } | Select-Object -First 1
if ($natural) {
    $synth.SelectVoice($natural.VoiceInfo.Name)
    Write-Host ("Voice: {0}" -f $natural.VoiceInfo.Name) -ForegroundColor Green
} else {
    Write-Host ("Voice: default ({0}). Install a Natural voice for better quality." -f $synth.Voice.Name) -ForegroundColor Yellow
}

$synth.Rate = 0   # -10 .. +10
$synth.Volume = 90

function Read-IfQualified {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    if ($Text.Length -lt 30) { return $false }
    if ($Text.Length -gt 5000) { $Text = $Text.Substring(0, 5000) + " ... text truncated" }
    if ($Text -notmatch '\s') { return $false }                         # no spaces — likely URL / path / hash
    if ($Text -notmatch '[a-zA-Z]{4,}') { return $false }              # no real words

    # Clean for TTS: strip code blocks + URLs + markdown markers
    $clean = $Text
    $clean = [Regex]::Replace($clean, '(?s)```.*?```', ' . code block skipped . ')
    $clean = [Regex]::Replace($clean, '`([^`]+)`', '$1')
    $clean = [Regex]::Replace($clean, '(?m)^#{1,6}\s*', '')
    $clean = [Regex]::Replace($clean, 'https?://\S+', '[link]')
    $clean = [Regex]::Replace($clean, '\*\*([^*]+)\*\*', '$1')
    $clean = [Regex]::Replace($clean, '\*([^*]+)\*', '$1')
    $clean = [Regex]::Replace($clean, '(?m)^[-*]\s*', '')
    $clean = [Regex]::Replace($clean, '\s+', ' ').Trim()

    $synth.SpeakAsyncCancelAll() | Out-Null
    $synth.SpeakAsync($clean) | Out-Null
    Write-Host ("Reading [{0} chars]: {1}..." -f $clean.Length, $clean.Substring(0, [Math]::Min(60, $clean.Length))) -ForegroundColor Cyan
    return $true
}

Write-Host ""
Write-Host "claude-tts.ps1 running. Copy text anywhere to hear it." -ForegroundColor Green
Write-Host "  Ctrl+C in this window to stop." -ForegroundColor DarkGray
Write-Host "  Filter: text >= 30 chars, has spaces, has real words." -ForegroundColor DarkGray
Write-Host ""

$lastClip = ""
while ($true) {
    Start-Sleep -Milliseconds 350
    try {
        $clip = Get-Clipboard -Raw -ErrorAction SilentlyContinue
        if ($clip -and $clip -ne $lastClip) {
            $lastClip = $clip
            $null = Read-IfQualified -Text $clip
        }
    } catch {
        # Clipboard temporarily unavailable — just skip this tick
    }
}
