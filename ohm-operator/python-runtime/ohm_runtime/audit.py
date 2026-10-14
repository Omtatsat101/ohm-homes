import json
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    decision TEXT NOT NULL,
    result TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    created TEXT NOT NULL,
    expires TEXT NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved TEXT
);
"""


def now() -> datetime:
    return datetime.now(timezone.utc)


class Store:
    def __init__(self, db_path: str | Path):
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(db_path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)

    def execute(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def close(self) -> None:
        self._db.close()


class AuditLog:
    def __init__(self, store: Store):
        self.store = store

    def record(self, action: str, target: str, decision: str, result: str, detail: dict | None = None) -> None:
        self.store.execute(
            "INSERT INTO audit (ts, action, target, decision, result, detail) VALUES (?, ?, ?, ?, ?, ?)",
            (now().isoformat(), action, target, decision, result, json.dumps(detail or {}, default=str)),
        )

    def recent(self, limit: int = 50) -> list[dict]:
        rows = self.store.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),))
        return [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]


class ApprovalQueue:
    def __init__(self, store: Store, expire_minutes: int = 60):
        self.store = store
        self.expire = timedelta(minutes=expire_minutes)

    def create(self, kind: str, target: str, detail: dict, reason: str) -> str:
        approval_id = uuid.uuid4().hex[:12]
        created = now()
        self.store.execute(
            "INSERT INTO approvals (id, created, expires, kind, target, detail, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (approval_id, created.isoformat(), (created + self.expire).isoformat(), kind, target, json.dumps(detail), reason),
        )
        return approval_id

    def _expire_stale(self) -> None:
        self.store.execute(
            "UPDATE approvals SET status = 'expired', resolved = ? WHERE status = 'pending' AND expires < ?",
            (now().isoformat(), now().isoformat()),
        )

    def pending(self) -> list[dict]:
        self._expire_stale()
        rows = self.store.execute("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created")
        return [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]

    def resolve(self, approval_id: str, status: str) -> dict | None:
        if status not in ("approved", "rejected"):
            raise ValueError("status must be 'approved' or 'rejected'")
        self._expire_stale()
        rows = self.store.execute(
            "UPDATE approvals SET status = ?, resolved = ? WHERE id = ? AND status = 'pending' RETURNING *",
            (status, now().isoformat(), approval_id),
        )
        if not rows:
            return None
        row = rows[0]
        return {**dict(row), "detail": json.loads(row["detail"])}
