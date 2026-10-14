import json
import os
import threading
import time
import urllib.error
import urllib.request

import pytest

from ohm_runtime.bridge import BridgeConnector
from ohm_runtime.operator import Operator
from ohm_runtime.server import make_server


def test_bridge_missing(cfg):
    status = BridgeConnector(cfg).status()
    assert status["state"] == "missing"
    assert {b["state"] for b in status["bundles"]} == {"missing"}


def test_bridge_fresh_and_stale(cfg, tmp_path):
    out = tmp_path / "bridge" / "out"
    out.mkdir(parents=True)
    (out / "claude.md").write_text("ctx")
    (out / "codex.md").write_text("ctx")
    assert BridgeConnector(cfg).status()["state"] == "fresh"
    old = time.time() - 2 * 3600
    os.utime(out / "codex.md", (old, old))
    status = BridgeConnector(cfg).status()
    assert status["state"] == "stale"
    assert {b["name"]: b["state"] for b in status["bundles"]} == {"claude": "fresh", "codex": "stale"}


def test_bridge_disabled(cfg):
    cfg["connectors"]["bridge"]["enabled"] = False
    assert BridgeConnector(cfg).status()["state"] == "disabled"


def test_operator_chat_commands(cfg, tmp_path):
    op = Operator(cfg, tmp_path / "op.db")
    assert "Commands" in op.chat("/help")["reply"]
    assert op.chat("/run py_echo hi there")["reply"] == "hi there"
    pending = op.chat("/run nuke")
    assert pending["data"]["status"] == "pending"
    aid = pending["data"]["approval_id"]
    assert op.resolve_approval(aid, True)["stdout"].strip() == "nuked"
    assert op.resolve_approval(aid, True)["status"] == "not_found"
    assert op.chat("/run nope")["data"]["status"] == "denied"
    assert op.chat("hello")["kind"] == "degraded"
    assert op.chat("/bridge")["data"]["state"] == "missing"
    assert [p["name"] for p in op.projects()] == ["demo"]


@pytest.fixture
def server(cfg, tmp_path):
    op = Operator(cfg, tmp_path / "srv.db")
    srv = make_server(op, "127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", op
    srv.shutdown()
    srv.server_close()


def call(url, data=None, headers=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    body = json.dumps(data).encode() if data is not None else None
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=body, headers=hdrs)
    try:
        with opener.open(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read()), resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read()), exc.headers


def test_server_status_and_chat(server):
    base, _ = server
    code, status, _ = call(f"{base}/status")
    assert code == 200 and status["ui"]["landing"] == "chat" and status["pending_approvals"] == 0
    code, reply, _ = call(f"{base}/chat", {"text": "/run nuke"})
    assert code == 200 and reply["data"]["status"] == "pending"
    code, pending, _ = call(f"{base}/approvals")
    assert [p["id"] for p in pending] == [reply["data"]["approval_id"]]
    code, result, _ = call(f"{base}/approvals/{pending[0]['id']}", {"decision": "reject"})
    assert result["status"] == "rejected"
    code, audit, _ = call(f"{base}/audit?limit=5")
    assert audit[0]["decision"] == "rejected"


def test_server_cors_allowlist(server):
    base, _ = server
    code, _, headers = call(f"{base}/status", headers={"Origin": "http://tauri.localhost"})
    assert code == 200 and headers["Access-Control-Allow-Origin"] == "http://tauri.localhost"
    code, body, _ = call(f"{base}/status", headers={"Origin": "https://evil.example"})
    assert code == 403 and body["error"] == "origin not allowed"


def test_server_rejects_bad_host_and_content_type(server):
    base, _ = server
    code, _, _ = call(f"{base}/status", headers={"Host": "attacker.example"})
    assert code == 403
    code, _, _ = call(f"{base}/chat", {"text": "/help"}, headers={"Content-Type": "text/plain"})
    assert code == 415


def test_server_bridge_handoffs(server):
    base, op = server
    code, pending, _ = call(f"{base}/bridge/handoffs", {"target": "codex", "request": "check this"})
    assert code == 200 and pending["status"] == "pending"
    code, done, _ = call(f"{base}/approvals/{pending['approval_id']}", {"decision": "approve"})
    hid = done["handoff"]["id"]
    code, listed, _ = call(f"{base}/bridge/handoffs")
    assert [h["id"] for h in listed] == [hid]
    code, review, _ = call(f"{base}/bridge/reviews", {"handoff_id": hid, "reviewer": "codex", "text": "lgtm"})
    assert review["status"] == "pending"
    call(f"{base}/approvals/{review['approval_id']}", {"decision": "approve"})
    code, reviews, _ = call(f"{base}/bridge/reviews?handoff={hid}")
    assert [r["text"] for r in reviews] == ["lgtm"]
    code, bad, _ = call(f"{base}/bridge/handoffs", {"target": "codex", "request": "x", "files": "a"})
    assert bad["status"] == "invalid"


def test_server_voice_endpoints(server):
    base, _ = server
    code, st, _ = call(f"{base}/voice/status")
    assert code == 200 and st["enabled"] is False and st["stt"]["available"] is False
    code, _, _ = call(f"{base}/voice/settings", {"enabled": "yes"})
    assert code == 400
    code, st, _ = call(f"{base}/voice/settings", {"enabled": True})
    assert st["enabled"] is True
    code, turn, _ = call(f"{base}/voice/turn", {"audio_base64": "eA=="})
    assert turn["status"] == "invalid"
    code, spoken, _ = call(f"{base}/voice/speak", {"text": "hi"})
    assert spoken["status"] == "unavailable"
    code, transcript, _ = call(f"{base}/voice/transcript")
    assert transcript == []
