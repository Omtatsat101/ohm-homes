from pathlib import Path

import pytest

from ohm_runtime.config import ConfigError, load_config
from ohm_runtime.permissions import ALLOW, APPROVE, DENY, Action, PermissionGate, validate_policy

SHIPPED_CONFIG = Path(__file__).resolve().parents[2] / "config"


def test_configured_tool_allowed(cfg):
    assert PermissionGate(cfg).decide(Action("tool.run", "py_version")).outcome == ALLOW


def test_unknown_tool_denied(cfg):
    assert PermissionGate(cfg).decide(Action("tool.run", "rm_rf")).outcome == DENY


def test_extra_args_rejected_when_not_allowed(cfg):
    assert PermissionGate(cfg).decide(Action("tool.run", "py_version", {"args": ["-x"]})).outcome == DENY


def test_max_args_enforced(cfg):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("tool.run", "py_echo", {"args": ["a", "b", "c"]})).outcome == ALLOW
    assert gate.decide(Action("tool.run", "py_echo", {"args": ["a", "b", "c", "d"]})).outcome == DENY


def test_forbidden_arg_chars(cfg):
    assert PermissionGate(cfg).decide(Action("tool.run", "py_echo", {"args": ["a\nb"]})).outcome == DENY


def test_dir_arg_type(cfg, tmp_path):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("tool.run", "open_dir", {"args": [str(tmp_path)]})).outcome == ALLOW
    assert gate.decide(Action("tool.run", "open_dir", {"args": [str(tmp_path / "nope")]})).outcome == DENY


def test_destructive_tool_needs_approval(cfg):
    assert PermissionGate(cfg).decide(Action("tool.run", "nuke")).outcome == APPROVE


def test_preauthorized_connector_allowed(cfg):
    d = PermissionGate(cfg).decide(Action("connector.outbound", "maya", {"host": "api.elevenlabs.io"}))
    assert d.outcome == ALLOW


def test_connector_wrong_host_denied(cfg):
    d = PermissionGate(cfg).decide(Action("connector.outbound", "maya", {"host": "evil.example"}))
    assert d.outcome == DENY


def test_unauthorized_connector_denied_by_default(cfg):
    d = PermissionGate(cfg).decide(Action("connector.outbound", "notion", {"host": "api.notion.com"}))
    assert d.outcome == DENY


def test_unauthorized_connector_can_require_approval(cfg):
    cfg["permissions"]["policy"]["connector.unauthorized"] = "approve"
    d = PermissionGate(cfg).decide(Action("connector.outbound", "notion", {"host": "api.notion.com"}))
    assert d.outcome == APPROVE


def test_disabled_and_unknown_connectors_denied(cfg):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("connector.outbound", "gmail", {"host": "gmail.googleapis.com"})).outcome == DENY
    assert gate.decide(Action("connector.outbound", "slack", {"host": "slack.com"})).outcome == DENY


def test_export_trusted_vs_untrusted(cfg, tmp_path):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("export", "x", {"path": str(tmp_path / "projects" / "a.md")})).outcome == ALLOW
    assert gate.decide(Action("export", "x", {"path": str(tmp_path / "elsewhere" / "a.md")})).outcome == APPROVE
    escape = str(tmp_path / "projects" / ".." / "elsewhere" / "a.md")
    assert gate.decide(Action("export", "x", {"path": escape})).outcome == APPROVE


def test_always_confirm_classes(cfg):
    gate = PermissionGate(cfg)
    for kind in ("destructive", "message.send", "account.change"):
        assert gate.decide(Action(kind, "t")).outcome == APPROVE


def test_unknown_kind_denied(cfg):
    assert PermissionGate(cfg).decide(Action("teleport", "mars")).outcome == DENY


def test_model_must_be_loopback(cfg):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("model.local", "ollama", {"endpoint": "http://127.0.0.1:11434"})).outcome == ALLOW
    assert gate.decide(Action("model.local", "ollama", {"endpoint": "http://10.0.0.5:11434"})).outcome == DENY


@pytest.mark.parametrize("key", ["destructive", "export.untrusted", "message.send", "account.change", "connector.unauthorized"])
def test_always_confirm_cannot_be_allow(key):
    with pytest.raises(ConfigError):
        validate_policy({"policy": {key: "allow"}})


def test_invalid_policy_value():
    with pytest.raises(ConfigError):
        validate_policy({"policy": {"tool.run": "maybe"}})


def test_shipped_config_is_valid_and_safe():
    cfg = load_config(SHIPPED_CONFIG)
    gate = PermissionGate(cfg)
    assert cfg["system"]["runtime"]["host"] == "127.0.0.1"
    for name, conn in cfg["connectors"]["connectors"].items():
        if conn.get("kind") == "outbound":
            assert not conn.get("enabled"), f"{name} must ship disabled"
            for host in conn.get("allowed_hosts", []) or ["example.com"]:
                assert gate.decide(Action("connector.outbound", name, {"host": host})).outcome == DENY
    assert gate.decide(Action("tool.run", "empty_recycle_bin")).outcome == APPROVE


def test_non_loopback_host_rejected(tmp_path):
    for f in SHIPPED_CONFIG.glob("*.toml"):
        text = f.read_text()
        if f.name == "system.toml":
            text = text.replace('host = "127.0.0.1"', 'host = "0.0.0.0"')
        (tmp_path / f.name).write_text(text)
    with pytest.raises(ConfigError):
        load_config(tmp_path)
