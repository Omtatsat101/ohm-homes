from datetime import datetime, timezone
from pathlib import Path

from .audit import ApprovalQueue, AuditLog
from .config import read_secret_values, resolve_path
from .permissions import ALLOW, APPROVE, Action, PermissionGate

SKIP_DIRS = {".obsidian", ".trash", ".git"}


def _mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


class Memory:
    """Reads primer.md and the Obsidian vault. Writes are off by default and always pass the gate."""

    def __init__(self, cfg: dict, gate: PermissionGate, audit: AuditLog, approvals: ApprovalQueue):
        self.cfg = cfg
        self.gate = gate
        self.audit = audit
        self.approvals = approvals
        paths = cfg.get("system", {}).get("paths", {})
        settings = cfg.get("system", {}).get("memory", {})
        self.primer = resolve_path(cfg, paths["primer"]) if paths.get("primer") else None
        self.vault = resolve_path(cfg, paths["obsidian_vault"]) if paths.get("obsidian_vault") else None
        self.writes = settings.get("writes", False)
        self.max_bytes = settings.get("max_note_bytes", 256 * 1024)
        self.list_limit = settings.get("list_limit", 200)

    def _vault_dir(self) -> Path | None:
        return self.vault.resolve() if self.vault and self.vault.is_dir() else None

    def note_path(self, rel, must_exist: bool = True) -> tuple[Path | None, str]:
        vault = self._vault_dir()
        if vault is None:
            return None, "obsidian vault not found"
        if not isinstance(rel, str) or not rel.strip() or "\x00" in rel or Path(rel).is_absolute():
            return None, "note path must be relative to the vault"
        path = (vault / rel.strip()).resolve()
        if not path.is_relative_to(vault) or path.suffix.lower() != ".md":
            return None, "note must be a .md file inside the vault"
        if SKIP_DIRS & set(path.relative_to(vault).parts):
            return None, "note is inside a vault system folder"
        if must_exist and not path.is_file():
            return None, f"note not found: {rel}"
        return path, ""

    def overview(self) -> dict:
        primer = {"path": str(self.primer) if self.primer else None, "exists": bool(self.primer and self.primer.is_file())}
        if primer["exists"]:
            data = self.primer.read_bytes()
            primer.update(bytes=len(data), modified=_mtime(self.primer),
                          text=data[: self.max_bytes].decode("utf-8", errors="replace"), truncated=len(data) > self.max_bytes)
        vault = self._vault_dir()
        return {
            "primer": primer,
            "vault": {"path": str(self.vault) if self.vault else None, "exists": vault is not None,
                      "writes_enabled": self.writes, "policy": self.gate.policy.get("memory.write")},
        }

    def notes(self, query: str | None = None) -> list[dict]:
        vault = self._vault_dir()
        if vault is None:
            return []
        q = (query or "").lower()
        out = []
        for p in vault.rglob("*.md"):
            rel = p.relative_to(vault)
            if SKIP_DIRS & set(rel.parts) or not p.is_file() or (q and q not in rel.as_posix().lower()):
                continue
            out.append({"path": rel.as_posix(), "bytes": p.stat().st_size, "modified": _mtime(p)})
        out.sort(key=lambda n: n["modified"], reverse=True)
        return out[: self.list_limit]

    def read_note(self, rel) -> dict:
        path, reason = self.note_path(rel)
        if path is None:
            return {"status": "invalid", "reason": reason}
        data = path.read_bytes()
        return {"status": "ok", "path": rel, "modified": _mtime(path),
                "text": data[: self.max_bytes].decode("utf-8", errors="replace"), "truncated": len(data) > self.max_bytes}

    def write_note(self, rel, text, mode: str = "append", approved_id: str | None = None) -> dict:
        if mode not in ("append", "create"):
            return self._invalid(rel, "mode must be 'append' or 'create'")
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > self.max_bytes:
            return self._invalid(rel, f"text must be 1-{self.max_bytes} bytes")
        path, reason = self.note_path(rel, must_exist=False)
        if path is None:
            return self._invalid(rel, reason)
        if mode == "create" and path.exists():
            return self._invalid(rel, f"note already exists: {rel}")
        if any(secret in text for secret in read_secret_values(self.cfg)):
            self.audit.record("memory.write", rel, "deny", "blocked: text contains a secret value", {"mode": mode})
            return {"status": "denied", "reason": "text contains a value from the secrets file"}
        detail = {"path": rel, "mode": mode, "text": text}
        decision = self.gate.decide(Action("memory.write", rel, {"enabled": self.writes}))
        audit_detail = {"mode": mode, "chars": len(text)}
        if decision.outcome == APPROVE and approved_id is None:
            approval_id = self.approvals.create("memory.write", rel, detail, decision.reason)
            self.audit.record("memory.write", rel, APPROVE, f"pending:{approval_id}", audit_detail)
            return {"status": "pending", "reason": decision.reason, "approval_id": approval_id}
        if decision.outcome not in (ALLOW, APPROVE):
            self.audit.record("memory.write", rel, decision.outcome, f"blocked: {decision.reason}", audit_detail)
            return {"status": "denied", "reason": decision.reason}
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x" if mode == "create" else "a", encoding="utf-8") as fh:
            fh.write(text if text.endswith("\n") else text + "\n")
        if approved_id:
            audit_detail["approval_id"] = approved_id
        self.audit.record("memory.write", rel, decision.outcome, "ok", audit_detail)
        return {"status": "ok", "path": rel, "mode": mode}

    def _invalid(self, rel, reason: str) -> dict:
        self.audit.record("memory.write", str(rel), "deny", f"invalid: {reason}")
        return {"status": "invalid", "reason": reason}
