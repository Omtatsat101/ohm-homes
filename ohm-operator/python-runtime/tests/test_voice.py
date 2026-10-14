import base64
import io
import os
import wave

import pytest

from ohm_runtime import voice
from ohm_runtime.operator import Operator


class FakeSTT(voice.Engine):
    name = "fake_stt"

    def availability(self):
        return True, "ready"

    def transcribe(self, wav):
        return self.settings.get("say", "/help")


class FakeTTS(voice.Engine):
    name = "fake_tts"
    mime = "audio/wav"

    def availability(self):
        return True, "ready"

    def synthesize(self, text):
        return b"RIFF" + text.encode()


def wav_b64(seconds=0.1):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\0\0" * int(16000 * seconds))
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def fake_engines(monkeypatch):
    monkeypatch.setitem(voice.STT_ENGINES, "fake_stt", FakeSTT)
    monkeypatch.setitem(voice.LOCAL_TTS_ENGINES, "fake_tts", FakeTTS)


def voice_cfg(cfg, stt="fake_stt", tts="fake_tts", fallback="fake_tts", enabled=True):
    cfg["voice"] = {
        "voice": {"enabled": enabled, "push_to_talk": True},
        "stt": {"engine": stt, "whisper_cpp": {"binary": "/nonexistent/whisper", "model": "/nonexistent/m.bin"}},
        "tts": {"engine": tts, "fallback": fallback, "maya": {"connector": "maya", "voice_id": "v1"}},
    }
    cfg["connectors"]["connectors"]["maya"]["secret_key"] = "ELEVENLABS_API_KEY"
    return cfg


def test_real_engines_report_unavailable_cleanly(cfg, tmp_path):
    op = Operator(voice_cfg(cfg, stt="whisper_cpp", tts="sapi", fallback="piper"), tmp_path / "op.db")
    st = op.voice.status()
    assert st["stt"]["available"] is False and st["stt"]["reason"].startswith("engine unavailable")
    if os.name != "nt":
        assert st["tts"]["available"] is False and "Windows" in st["tts"]["reason"]
    assert st["tts_fallback"]["available"] is False
    result = op.voice.transcribe(wav_b64())
    assert result["status"] == "unavailable" and "whisper_cpp" in result["reason"]
    if os.name != "nt":
        spoken = op.voice.speak("hello")
        assert spoken["status"] == "unavailable" and "sapi" in spoken["reason"] and "piper" in spoken["reason"]


def test_unknown_engine(cfg, tmp_path):
    op = Operator(voice_cfg(cfg, stt="nope", tts="nope", fallback=""), tmp_path / "op.db")
    assert "unknown engine" in op.voice.status()["stt"]["reason"]
    assert op.voice.transcribe(wav_b64())["status"] == "unavailable"
    assert op.voice.speak("hi")["status"] == "unavailable"


def test_voice_turn_with_fake_engines(cfg, tmp_path, fake_engines):
    op = Operator(voice_cfg(cfg), tmp_path / "op.db")
    result = op.voice_turn(wav_b64())
    assert result["status"] == "ok" and result["text"] == "/help"
    assert "Commands" in result["reply"]["reply"]
    assert result["speech"]["engine"] == "fake_tts"
    assert base64.b64decode(result["speech"]["audio_base64"]).startswith(b"RIFF")
    assert [t["role"] for t in op.voice.recent()] == ["riket", "ohm"]
    actions = {a["action"] for a in op.audit.recent(10)}
    assert {"voice.stt", "voice.tts"} <= actions


def test_voice_rejects_bad_audio_and_disabled(cfg, tmp_path, fake_engines):
    op = Operator(voice_cfg(cfg), tmp_path / "op.db")
    assert op.voice.transcribe("not base64!")["status"] == "invalid"
    assert op.voice.transcribe(base64.b64encode(b"x" * 100).decode())["status"] == "invalid"
    op.voice.max_audio_bytes = 10
    assert op.voice.transcribe(wav_b64())["reason"] == "audio is too long"
    off = Operator(voice_cfg(cfg, enabled=False), tmp_path / "off.db")
    assert off.voice_turn(wav_b64())["status"] == "disabled"


def test_toggle_persists_runtime_state(cfg, tmp_path, fake_engines):
    op = Operator(voice_cfg(cfg, enabled=False), tmp_path / "op.db")
    assert op.voice.set_enabled(True)["enabled"] is True
    again = Operator(voice_cfg(cfg, enabled=False), tmp_path / "op2.db")
    assert again.voice.enabled is True
    assert op.audit.recent(1)[0]["action"] == "voice.toggle"


def test_maya_blocked_by_gate_falls_back(cfg, tmp_path, fake_engines, monkeypatch):
    cfg["connectors"]["connectors"]["maya"]["enabled"] = False
    op = Operator(voice_cfg(cfg, tts="maya"), tmp_path / "op.db")
    monkeypatch.setattr(voice.MayaTTS, "post", lambda *a: pytest.fail("network must not be touched"))
    result = op.voice.speak("hello")
    assert result["engine"] == "fake_tts" and "disabled" in result["fallback_from"][0]
    blocked = [a for a in op.audit.recent(5) if a["target"] == "maya"]
    assert blocked and blocked[0]["decision"] == "deny"


def test_maya_preauthorized_uses_gate_and_secret(cfg, tmp_path, fake_engines, monkeypatch):
    (tmp_path / "keys.env").write_text("# keys\nELEVENLABS_API_KEY='test-key'\n")
    cfg["system"]["paths"]["secrets_file"] = str(tmp_path / "keys.env")
    op = Operator(voice_cfg(cfg, tts="maya"), tmp_path / "op.db")
    seen = {}

    def fake_post(self, url, body, headers):
        seen.update(url=url, key=headers["xi-api-key"], text=body["text"])
        return b"mp3"

    monkeypatch.setattr(voice.MayaTTS, "post", fake_post)
    assert op.voice.status()["tts"]["available"] is True
    result = op.voice.speak("namaste")
    assert result["engine"] == "maya" and result["mime"] == "audio/mpeg"
    assert seen == {"url": "https://api.elevenlabs.io/v1/text-to-speech/v1", "key": "test-key", "text": "namaste"}
    assert "test-key" not in str(op.audit.recent(10))


def test_maya_missing_secret_is_unavailable(cfg, tmp_path, fake_engines):
    op = Operator(voice_cfg(cfg, tts="maya", fallback=""), tmp_path / "op.db")
    assert "not found in secrets file" in op.voice.status()["tts"]["reason"]
    assert op.voice.speak("x")["status"] == "unavailable"
