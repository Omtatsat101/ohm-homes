import sqlite3
from datetime import timedelta

import pytest

from ohm_runtime.audit import ApprovalQueue, AuditLog, Store


def test_record_and_read(store):
    log = AuditLog(store)
    log.record("tool.run", "git_status", "allow", "ok exit=0", {"args": []})
    log.record("connector.outbound", "notion", "deny", "blocked")
    rows = log.recent()
    assert [r["target"] for r in rows] == ["notion", "git_status"]
    assert rows[1]["detail"] == {"args": []}
    assert all(r["ts"] for r in rows)


def test_audit_is_append_only(store):
    AuditLog(store).record("tool.run", "x", "allow", "ok")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("UPDATE audit SET result = 'tampered'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("DELETE FROM audit")
    assert AuditLog(store).recent()[0]["result"] == "ok"


def test_audit_persists_to_disk(tmp_path):
    db = tmp_path / "nested" / "audit.db"
    s = Store(db)
    AuditLog(s).record("runtime.start", "127.0.0.1:1", "allow", "listening")
    s.close()
    s2 = Store(db)
    assert AuditLog(s2).recent()[0]["action"] == "runtime.start"
    s2.close()


def test_approval_lifecycle(store):
    q = ApprovalQueue(store)
    aid = q.create("tool.run", "nuke", {"args": []}, "destructive")
    assert [p["id"] for p in q.pending()] == [aid]
    row = q.resolve(aid, "approved")
    assert row["status"] == "approved" and row["target"] == "nuke"
    assert q.resolve(aid, "approved") is None
    assert q.pending() == []


def test_approval_expiry(store):
    q = ApprovalQueue(store, expire_minutes=60)
    q.expire = timedelta(minutes=-1)
    aid = q.create("tool.run", "nuke", {}, "destructive")
    assert q.pending() == []
    assert q.resolve(aid, "approved") is None


def test_approval_bad_status(store):
    with pytest.raises(ValueError):
        ApprovalQueue(store).resolve("abc", "maybe")
