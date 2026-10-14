import json

import pytest

from ohm_runtime.operator import Operator
from ohm_runtime.permissions import ALLOW, APPROVE, DENY, Action, PermissionGate


@pytest.fixture
def op(cfg, tmp_path):
    cfg["permissions"]["export"]["trusted_zones"].append("{operator}/data/handoffs")
    (tmp_path / "projects" / "demo" / "notes.md").write_text("hello bridge")
    (tmp_path / "projects" / "demo" / "prod.env").write_text("KEY=1")
    (tmp_path / "outside.md").write_text("nope")
    return Operator(cfg, tmp_path / "op.db")


def test_gate_bridge_files(op, tmp_path):
    gate = op.gate
    dest = str(op.handoffs.root)
    ok = gate.decide(Action("bridge.handoff", "codex", {"dest": dest, "files": ["projects/demo/notes.md"]}))
    assert ok.outcome == ALLOW
    for bad in ["projects/demo/prod.env", str(tmp_path / "outside.md"), "projects/demo/missing.md", "projects/demo",
                "projects/demo/../../outside.md"]:
        assert gate.decide(Action("bridge.handoff", "codex", {"dest": dest, "files": [bad]})).outcome == DENY, bad
    assert gate.decide(Action("bridge.handoff", "codex", {"files": []})).outcome == DENY


def test_gate_handoff_dest_outside_trusted_zone_needs_approval(cfg, tmp_path):
    gate = PermissionGate(cfg)
    assert gate.decide(Action("bridge.handoff", "codex", {"dest": str(tmp_path / "elsewhere")})).outcome == APPROVE


def test_package_and_review(op):
    result = op.handoffs.package("codex", "review the runner", ["projects/demo/notes.md"])
    assert result["status"] == "ok"
    h = result["handoff"]
    folder = op.handoffs.root / h["id"]
    assert (folder / "request.md").read_text().strip() == "review the runner"
    assert (folder / h["files"][0]["copy"]).read_text() == "hello bridge"
    manifest = json.loads((folder / "handoff.json").read_text())
    assert {b["name"]: b["state"] for b in manifest["bundles"]} == {"claude": "missing", "codex": "missing"}

    review = op.handoffs.record_review(h["id"], "codex", text="looks fine")
    assert review["status"] == "ok"
    from_file = op.handoffs.record_review(h["id"], "claude", path="projects/demo/notes.md")
    assert from_file["review"]["text"] == "hello bridge"

    listed = op.handoffs.list_handoffs()
    assert [x["id"] for x in listed] == [h["id"]] and listed[0]["reviews"] == 2
    assert len(op.handoffs.list_reviews(h["id"])) == 2 and len(op.handoffs.list_reviews()) == 2
    actions = [(a["action"], a["result"]) for a in op.audit.recent(10)]
    assert ("bridge.handoff", "ok") in actions and ("bridge.review", "ok") in actions


def test_package_rejects_bad_input(op):
    assert op.handoffs.package("gemini", "x")["status"] == "invalid"
    assert op.handoffs.package("codex", "  ")["status"] == "invalid"
    assert op.handoffs.package("codex", "x", "notes.md")["status"] == "invalid"
    denied = op.handoffs.package("codex", "x", ["projects/demo/prod.env"])
    assert denied["status"] == "denied" and "secret" in denied["reason"]
    assert op.handoffs.list_handoffs() == []
    assert op.audit.recent(1)[0]["result"].startswith("blocked")


def test_review_rejects_bad_input(op):
    h = op.handoffs.package("codex", "x")["handoff"]
    assert op.handoffs.record_review("../etc", "codex", text="x")["status"] == "invalid"
    assert op.handoffs.record_review(h["id"], "nobody", text="x")["status"] == "invalid"
    assert op.handoffs.record_review(h["id"], "codex")["status"] == "invalid"
    assert op.handoffs.record_review(h["id"], "codex", text="x", path="projects/demo/notes.md")["status"] == "invalid"
    assert op.handoffs.record_review(h["id"], "codex", path="projects/demo/prod.env")["status"] == "denied"


def test_handoff_approval_flow(cfg, tmp_path):
    op = Operator(cfg, tmp_path / "op.db")
    pending = op.handoffs.package("claude", "needs approval")
    assert pending["status"] == "pending"
    assert op.handoffs.list_handoffs() == []
    done = op.resolve_approval(pending["approval_id"], True)
    assert done["status"] == "ok" and done["handoff"]["request"] == "needs approval"
    review = op.handoffs.record_review(done["handoff"]["id"], "claude", text="ok")
    assert review["status"] == "pending"
    assert op.resolve_approval(review["approval_id"], True)["status"] == "ok"


def test_chat_bridge_commands(op):
    reply = op.chat("/handoff codex please review it @projects/demo/notes.md")
    assert reply["data"]["status"] == "ok", reply
    hid = reply["data"]["handoff"]["id"]
    assert reply["data"]["handoff"]["request"] == "please review it"
    assert hid in op.chat("/handoffs")["reply"]
    assert op.chat(f"/review {hid} codex it's fine")["data"]["status"] == "ok"
    assert op.chat(f"/review {hid} claude @projects/demo/notes.md")["data"]["status"] == "ok"
    assert "it's fine" in op.chat(f"/reviews {hid}")["reply"]
    assert op.chat("/handoff codex")["kind"] == "error"
    assert op.chat(f"/review {hid} codex")["kind"] == "error"
    assert op.chat(f"/review {hid} codex text @projects/demo/notes.md")["kind"] == "error"
