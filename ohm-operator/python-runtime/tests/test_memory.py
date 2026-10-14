import pytest

from ohm_runtime.operator import Operator


@pytest.fixture
def mem_cfg(cfg, tmp_path):
    (tmp_path / "primer.md").write_text("# primer\nactive sprint: om system\n")
    vault = tmp_path / "vault"
    (vault / "daily").mkdir(parents=True)
    (vault / ".obsidian").mkdir()
    (vault / "daily" / "2026-10-14.md").write_text("today")
    (vault / "canon.md").write_text("red flag spec")
    (vault / ".obsidian" / "hidden.md").write_text("x")
    (vault / "image.png").write_bytes(b"png")
    (tmp_path / "keys.env").write_text("SECRET_TOKEN=supersecretvalue123\n")
    cfg["system"]["paths"].update(obsidian_vault=str(vault), secrets_file=str(tmp_path / "keys.env"))
    return cfg


def test_read_primer_and_vault(mem_cfg, tmp_path):
    op = Operator(mem_cfg, tmp_path / "op.db")
    ov = op.memory.overview()
    assert "active sprint" in ov["primer"]["text"] and ov["vault"]["exists"] and ov["vault"]["writes_enabled"] is False
    assert sorted(n["path"] for n in op.memory.notes()) == ["canon.md", "daily/2026-10-14.md"]
    assert [n["path"] for n in op.memory.notes("daily")] == ["daily/2026-10-14.md"]
    assert op.memory.read_note("canon.md")["text"] == "red flag spec"
    for bad in ["../primer.md", "image.png", ".obsidian/hidden.md", "missing.md", str(tmp_path / "primer.md"), ""]:
        assert op.memory.read_note(bad)["status"] == "invalid", bad


def test_missing_paths(cfg, tmp_path):
    op = Operator(cfg, tmp_path / "op.db")
    assert op.memory.overview()["primer"]["exists"] is False
    assert op.memory.notes() == []
    assert op.memory.read_note("a.md")["status"] == "invalid"


def test_writes_disabled_by_default(mem_cfg, tmp_path):
    op = Operator(mem_cfg, tmp_path / "op.db")
    result = op.memory.write_note("canon.md", "more")
    assert result["status"] == "denied" and "disabled" in result["reason"]
    assert (tmp_path / "vault" / "canon.md").read_text() == "red flag spec"
    assert op.audit.recent(1)[0]["decision"] == "deny"


def test_writes_need_approval_when_enabled(mem_cfg, tmp_path):
    mem_cfg["system"]["memory"] = {"writes": True}
    op = Operator(mem_cfg, tmp_path / "op.db")
    pending = op.memory.write_note("canon.md", "decision: ship v1")
    assert pending["status"] == "pending"
    assert (tmp_path / "vault" / "canon.md").read_text() == "red flag spec"
    assert op.resolve_approval(pending["approval_id"], True)["status"] == "ok"
    assert (tmp_path / "vault" / "canon.md").read_text() == "red flag specdecision: ship v1\n"
    created = op.memory.write_note("new/idea.md", "fresh", mode="create")
    assert op.resolve_approval(created["approval_id"], True)["status"] == "ok"
    assert (tmp_path / "vault" / "new" / "idea.md").read_text() == "fresh\n"
    assert op.memory.write_note("new/idea.md", "again", mode="create")["status"] == "invalid"


def test_write_guards(mem_cfg, tmp_path):
    mem_cfg["system"]["memory"] = {"writes": True}
    mem_cfg["permissions"]["policy"]["memory.write"] = "allow"
    op = Operator(mem_cfg, tmp_path / "op.db")
    assert op.memory.write_note("canon.md", "added")["status"] == "ok"
    leak = op.memory.write_note("canon.md", "token is supersecretvalue123")
    assert leak["status"] == "denied" and "secret" in leak["reason"]
    assert "supersecretvalue123" not in str(op.audit.recent(20))
    for bad in ["../escape.md", ".obsidian/x.md", "x.txt"]:
        assert op.memory.write_note(bad, "x")["status"] == "invalid", bad
    assert op.memory.write_note("canon.md", "x", mode="overwrite")["status"] == "invalid"
    assert not (tmp_path / "escape.md").exists()


def test_chat_memory_commands(mem_cfg, tmp_path):
    op = Operator(mem_cfg, tmp_path / "op.db")
    assert "active sprint" in op.chat("/primer")["reply"]
    assert "canon.md" in op.chat("/notes")["reply"]
    assert op.chat("/note canon.md")["reply"] == "red flag spec"
    assert op.chat("/remember canon.md don't forget")["data"]["status"] == "denied"
    assert op.chat("/remember canon.md")["kind"] == "error"
