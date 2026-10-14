import base64
import binascii
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from .audit import AuditLog
from .config import read_secret, resolve, resolve_path
from .permissions import Action, PermissionGate

SAPI_SCRIPT = (
    "Add-Type -AssemblyName System.Speech; "
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
    "if ($env:OHM_TTS_VOICE) { $s.SelectVoice($env:OHM_TTS_VOICE) }; "
    "$s.SetOutputToWaveFile($env:OHM_TTS_OUT); "
    "$s.Speak([Console]::In.ReadToEnd()); $s.Dispose()"
)
MAX_SPEAK_CHARS = 5000


class EngineUnavailable(RuntimeError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Engine:
    name = ""

    def __init__(self, cfg: dict, settings: dict):
        self.cfg = cfg
        self.settings = settings
        self.timeout = settings.get("timeout", 60)

    def availability(self) -> tuple[bool, str]:
        return False, "not implemented"

    def _path(self, key: str) -> Path | None:
        value = self.settings.get(key)
        return resolve_path(self.cfg, value) if value else None

    def _require(self) -> None:
        ok, reason = self.availability()
        if not ok:
            raise EngineUnavailable(f"engine unavailable: {self.name}: {reason}")

    def _run(self, argv: list[str], stdin: str | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
        try:
            proc = subprocess.run(argv, input=stdin, capture_output=True, text=True, errors="replace", shell=False,
                                  timeout=self.timeout, env={**os.environ, **(env or {})})
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise EngineUnavailable(f"engine unavailable: {self.name}: {exc}") from exc
        if proc.returncode != 0:
            raise EngineUnavailable(f"engine unavailable: {self.name} exited {proc.returncode}: {proc.stderr.strip()[-300:]}")
        return proc


class BinaryModelEngine(Engine):
    def availability(self) -> tuple[bool, str]:
        binary, model = self._path("binary"), self._path("model")
        if binary is None or not (binary.is_file() or shutil.which(str(binary))):
            return False, f"binary not found: {binary}"
        if model is None or not model.is_file():
            return False, f"model not found: {model}"
        return True, "ready"


class WhisperCppSTT(BinaryModelEngine):
    name = "whisper_cpp"

    def transcribe(self, wav: bytes) -> str:
        self._require()
        with tempfile.TemporaryDirectory(prefix="ohm-stt-") as tmp:
            path = Path(tmp) / "in.wav"
            path.write_bytes(wav)
            argv = [str(self._path("binary")), "-m", str(self._path("model")), "-f", str(path), "-nt", "-np"]
            if self.settings.get("language"):
                argv += ["-l", self.settings["language"]]
            return " ".join(self._run(argv).stdout.split())


class SapiTTS(Engine):
    name = "sapi"
    mime = "audio/wav"

    def availability(self) -> tuple[bool, str]:
        if os.name != "nt":
            return False, "Windows speech (SAPI) requires Windows"
        if not shutil.which("powershell.exe"):
            return False, "powershell.exe not found"
        return True, "ready"

    def synthesize(self, text: str) -> bytes:
        self._require()
        with tempfile.TemporaryDirectory(prefix="ohm-tts-") as tmp:
            out = Path(tmp) / "out.wav"
            argv = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", SAPI_SCRIPT]
            self._run(argv, stdin=text, env={"OHM_TTS_OUT": str(out), "OHM_TTS_VOICE": self.settings.get("voice", "")})
            return out.read_bytes()


class PiperTTS(BinaryModelEngine):
    name = "piper"
    mime = "audio/wav"

    def synthesize(self, text: str) -> bytes:
        self._require()
        with tempfile.TemporaryDirectory(prefix="ohm-tts-") as tmp:
            out = Path(tmp) / "out.wav"
            self._run([str(self._path("binary")), "--model", str(self._path("model")), "--output_file", str(out)], stdin=text)
            return out.read_bytes()


class MayaTTS(Engine):
    """ElevenLabs Maya voice. Outbound, so every call is decided by the permission gate."""

    name = "maya"
    mime = "audio/mpeg"

    def __init__(self, cfg: dict, settings: dict, gate: PermissionGate):
        super().__init__(cfg, settings)
        self.gate = gate
        self.connector = settings.get("connector", "elevenlabs")
        conn = cfg.get("connectors", {}).get("connectors", {}).get(self.connector, {})
        self.host = (conn.get("allowed_hosts") or [""])[0]
        self.secret_key = conn.get("secret_key", "")

    def decision(self):
        return self.gate.decide(Action("connector.outbound", self.connector, {"host": self.host}))

    def availability(self) -> tuple[bool, str]:
        decision = self.decision()
        if not decision.allowed:
            return False, decision.reason
        if not self.settings.get("voice_id"):
            return False, "tts.maya.voice_id is not set"
        if not read_secret(self.cfg, self.secret_key):
            return False, f"{self.secret_key} not found in secrets file"
        return True, "ready"

    def post(self, url: str, body: dict, headers: dict) -> bytes:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=self.timeout) as resp:
            return resp.read()

    def synthesize(self, text: str) -> bytes:
        self._require()
        body = {"text": text, **({"model_id": self.settings["model_id"]} if self.settings.get("model_id") else {})}
        headers = {"xi-api-key": read_secret(self.cfg, self.secret_key) or "", "Content-Type": "application/json",
                   "Accept": self.mime}
        url = f"https://{self.host}/v1/text-to-speech/{self.settings['voice_id']}"
        try:
            return self.post(url, body, headers)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise EngineUnavailable(f"engine unavailable: maya: {exc}") from exc


STT_ENGINES = {"whisper_cpp": WhisperCppSTT}
LOCAL_TTS_ENGINES = {"sapi": SapiTTS, "piper": PiperTTS}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VoiceService:
    def __init__(self, cfg: dict, gate: PermissionGate, audit: AuditLog):
        self.cfg = cfg
        self.audit = audit
        voice = cfg.get("voice", {})
        self.settings = voice.get("voice", {})
        self.stt_cfg = voice.get("stt", {})
        self.tts_cfg = voice.get("tts", {})
        config_dir = cfg.get("_config_dir") or resolve(cfg, "{operator}/config")
        self.state_path = Path(config_dir) / "runtime-state.json"
        self.enabled = self._load_state().get("voice_enabled", self.settings.get("enabled", False))
        self.transcript: deque = deque(maxlen=self.settings.get("transcript_size", 50))
        self.max_audio_bytes = self.settings.get("max_audio_seconds", 120) * 16000 * 2 + 1024
        self.stt = self._engine(STT_ENGINES, self.stt_cfg)
        self.maya = MayaTTS(cfg, self.tts_cfg.get("maya", {}), gate)
        tts_engines = {**LOCAL_TTS_ENGINES, "maya": lambda c, s: self.maya}
        self.tts = self._engine(tts_engines, self.tts_cfg)
        fallback = self.tts_cfg.get("fallback")
        self.tts_fallback = self._engine(LOCAL_TTS_ENGINES, {**self.tts_cfg, "engine": fallback}) if fallback else None

    def _engine(self, registry: dict, section: dict):
        name = section.get("engine", "")
        factory = registry.get(name)
        return factory(self.cfg, section.get(name, {})) if factory else None

    def _load_state(self) -> dict:
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _describe(engine, configured: str) -> dict:
        if engine is None:
            return {"engine": configured or None, "available": False, "reason": f"engine unavailable: unknown engine {configured!r}"}
        ok, reason = engine.availability()
        return {"engine": engine.name, "available": ok, "reason": reason if ok else f"engine unavailable: {reason}"}

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "push_to_talk": self.settings.get("push_to_talk", True),
            "speak_replies": self.settings.get("speak_replies", True),
            "stt": self._describe(self.stt, self.stt_cfg.get("engine", "")),
            "tts": self._describe(self.tts, self.tts_cfg.get("engine", "")),
            "tts_fallback": self._describe(self.tts_fallback, self.tts_cfg.get("fallback", "")) if self.tts_cfg.get("fallback") else None,
        }

    def set_enabled(self, enabled: bool) -> dict:
        self.enabled = bool(enabled)
        state = {**self._load_state(), "voice_enabled": self.enabled}
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        except OSError as exc:
            self.audit.record("voice.toggle", "voice", "allow", f"error: {exc}", {"enabled": self.enabled})
            return {**self.status(), "warning": f"could not persist runtime state: {exc}"}
        self.audit.record("voice.toggle", "voice", "allow", "ok", {"enabled": self.enabled})
        return self.status()

    def note(self, role: str, text: str, engine: str | None) -> None:
        self.transcript.append({"ts": _now(), "role": role, "text": text, "engine": engine})

    def recent(self) -> list[dict]:
        return list(self.transcript)

    def transcribe(self, audio_b64: str) -> dict:
        if not self.enabled:
            return {"status": "disabled", "reason": "voice mode is off"}
        try:
            wav = base64.b64decode(audio_b64 or "", validate=True)
        except (binascii.Error, ValueError, TypeError):
            return {"status": "invalid", "reason": "audio must be base64"}
        if len(wav) > self.max_audio_bytes:
            return {"status": "invalid", "reason": "audio is too long"}
        if len(wav) < 44 or wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
            return {"status": "invalid", "reason": "audio must be a WAV file"}
        if self.stt is None:
            reason = f"engine unavailable: unknown engine {self.stt_cfg.get('engine')!r}"
            self.audit.record("voice.stt", str(self.stt_cfg.get("engine")), "allow", reason)
            return {"status": "unavailable", "reason": reason}
        try:
            text = self.stt.transcribe(wav)
        except EngineUnavailable as exc:
            self.audit.record("voice.stt", self.stt.name, "allow", str(exc))
            return {"status": "unavailable", "reason": str(exc)}
        self.audit.record("voice.stt", self.stt.name, "allow", "ok", {"bytes": len(wav), "chars": len(text)})
        self.note("riket", text, self.stt.name)
        return {"status": "ok", "text": text, "engine": self.stt.name}

    def speak(self, text: str) -> dict:
        text = (text or "").strip() if isinstance(text, str) else ""
        if not text:
            return {"status": "invalid", "reason": "text is required"}
        text = text[:MAX_SPEAK_CHARS]
        errors = []
        engines = [e for e in (self.tts, self.tts_fallback) if e is not None]
        if len(engines) == 2 and engines[0].name == engines[1].name:
            engines.pop()
        for engine in engines:
            outcome = engine.decision().outcome if engine is self.maya else "allow"
            try:
                audio = engine.synthesize(text)
            except EngineUnavailable as exc:
                self.audit.record("voice.tts", engine.name, outcome, str(exc))
                errors.append(str(exc))
                continue
            self.audit.record("voice.tts", engine.name, outcome, "ok", {"chars": len(text), "bytes": len(audio)})
            return {"status": "ok", "engine": engine.name, "mime": engine.mime,
                    "audio_base64": base64.b64encode(audio).decode(), "fallback_from": errors or None}
        if not engines:
            errors.append(f"engine unavailable: unknown engine {self.tts_cfg.get('engine')!r}")
            self.audit.record("voice.tts", str(self.tts_cfg.get("engine")), "allow", errors[0])
        return {"status": "unavailable", "reason": "; ".join(errors)}
