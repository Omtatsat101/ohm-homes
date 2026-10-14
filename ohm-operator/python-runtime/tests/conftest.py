import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ohm_runtime.audit import ApprovalQueue, AuditLog, Store  # noqa: E402
from ohm_runtime.permissions import PermissionGate  # noqa: E402
from ohm_runtime.runner import ToolRunner  # noqa: E402

PY = sys.executable


@pytest.fixture
def cfg(tmp_path):
    (tmp_path / "projects" / "demo").mkdir(parents=True)
    return {
        "_operator_dir": str(tmp_path / "operator"),
        "system": {
            "runtime": {"host": "127.0.0.1", "port": 0, "allowed_origins": ["http://tauri.localhost"]},
            "paths": {"workspace": str(tmp_path), "projects": "{workspace}/projects", "primer": "{workspace}/primer.md"},
            "model": {"provider": "ollama", "enabled": False, "endpoint": "http://127.0.0.1:9", "name": "x"},
            "tools": {
                "py_version": {"description": "python version", "argv": [PY, "--version"]},
                "py_echo": {"argv": [PY, "-c", "import sys; print(' '.join(sys.argv[1:]))"], "extra_args": True, "max_args": 3},
                "py_fail": {"argv": [PY, "-c", "import sys; sys.exit(3)"]},
                "py_sleep": {"argv": [PY, "-c", "import time; time.sleep(5)"], "timeout": 1},
                "py_cwd": {"argv": [PY, "-c", "import os; print(os.getcwd())"], "cwd": "{workspace}/projects/demo"},
                "open_dir": {"argv": [PY, "-c", "print('opened')"], "extra_args": True, "max_args": 1, "arg_type": "dir"},
                "nuke": {"argv": [PY, "-c", "print('nuked')"], "class": "destructive"},
                "missing_bin": {"argv": ["definitely-not-a-real-binary-ohm"]},
            },
        },
        "connectors": {
            "bridge": {"enabled": True, "root": "{workspace}/bridge", "stale_after_minutes": 60,
                       "refresh_tool": "py_version", "bundles": {"claude": "out/claude.md", "codex": "out/codex.md"}},
            "connectors": {
                "maya": {"kind": "outbound", "enabled": True, "preauthorized": True, "allowed_hosts": ["api.elevenlabs.io"]},
                "notion": {"kind": "outbound", "enabled": True, "preauthorized": False, "allowed_hosts": ["api.notion.com"]},
                "gmail": {"kind": "outbound", "enabled": False, "preauthorized": True, "allowed_hosts": ["gmail.googleapis.com"]},
            },
        },
        "permissions": {
            "policy": {},
            "export": {"trusted_zones": ["{workspace}/projects"]},
            "approvals": {"expire_minutes": 60},
        },
        "voice": {},
        "ui": {"ui": {"landing": "chat", "mode": 0}},
    }


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


@pytest.fixture
def runner(cfg, store):
    return ToolRunner(cfg, PermissionGate(cfg), AuditLog(store), ApprovalQueue(store))
