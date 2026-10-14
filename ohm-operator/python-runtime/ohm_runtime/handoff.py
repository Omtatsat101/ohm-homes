import hashlib
import json
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .audit import ApprovalQueue, AuditLog
from .bridge import BridgeConnector
from .config import resolve_path
from .permissions import ALLOW, APPROVE, Action, PermissionGate

HANDOFF_ID = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")


def _new_id() -> str:
    return f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{secrets.token_hex(3)}"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


class HandoffStore:
    """Packages bridge handoffs into a local folder and records review outputs beside them."""

    def __init__(self, cfg: dict, gate: PermissionGate, audit: AuditLog, approvals: ApprovalQueue, bridge: BridgeConnector):
        settings = cfg.get("connectors", {}).get("bridge", {})
        self.gate = gate
        self.audit = audit
        self.approvals = approvals
        self.bridge = bridge
        self.root = resolve_path(cfg, settings.get("handoff_dir", "{operator}/data/handoffs"))
        self.targets = sorted(settings.get("bundles", {}))
        self.max_text = settings.get("max_request_chars", 20000)

    def _folder(self, handoff_id: str) -> Path | None:
        if not isinstance(handoff_id, str) or not HANDOFF_ID.match(handoff_id):
            return None
        folder = self.root / handoff_id
        return folder if (folder / "handoff.json").is_file() else None

    def _invalid(self, kind: str, target: str, reason: str) -> dict:
        self.audit.record(kind, str(target), "deny", f"invalid: {reason}")
        return {"status": "invalid", "reason": reason}

    def _gate(self, kind: str, target: str, detail: dict, approved_id: str | None):
        decision = self.gate.decide(Action(kind, target, detail))
        if decision.outcome == APPROVE and approved_id is None:
            approval_id = self.approvals.create(kind, target, detail, decision.reason)
            self.audit.record(kind, target, APPROVE, f"pending:{approval_id}", detail)
            return {"status": "pending", "reason": decision.reason, "approval_id": approval_id}, None
        if decision.outcome not in (ALLOW, APPROVE):
            self.audit.record(kind, target, decision.outcome, f"blocked: {decision.reason}", detail)
            return {"status": "denied", "reason": decision.reason}, None
        return None, decision.outcome

    def package(self, target: str, request: str, files: list[str] | None = None, approved_id: str | None = None) -> dict:
        files = files or []
        request = (request or "").strip() if isinstance(request, str) else ""
        if target not in self.targets:
            return self._invalid("bridge.handoff", target, f"target must be one of {self.targets}")
        if not request or len(request) > self.max_text:
            return self._invalid("bridge.handoff", target, f"request must be 1-{self.max_text} characters")
        if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
            return self._invalid("bridge.handoff", target, "files must be strings")
        detail = {"dest": str(self.root), "request": request, "files": files}
        blocked, outcome = self._gate("bridge.handoff", target, detail, approved_id)
        if blocked:
            return blocked
        handoff_id = _new_id()
        folder = self.root / handoff_id
        (folder / "files").mkdir(parents=True)
        (folder / "reviews").mkdir()
        copied = []
        for i, f in enumerate(files):
            src, reason = self.gate.bridge_file(f)
            if src is None:
                shutil.rmtree(folder)
                self.audit.record("bridge.handoff", target, outcome, f"error: {reason}", detail)
                return {"status": "error", "reason": reason}
            data = src.read_bytes()
            name = f"{i:02d}-{src.name}"
            (folder / "files" / name).write_bytes(data)
            copied.append({"source": str(src), "copy": f"files/{name}", "bytes": len(data), "sha256": _sha256(data)})
        bundles = [{k: b[k] for k in ("name", "path", "state", "age_minutes")} for b in self.bridge.status()["bundles"]]
        manifest = {
            "id": handoff_id,
            "created": datetime.now(timezone.utc).isoformat(),
            "target": target,
            "request": request,
            "bundles": bundles,
            "files": copied,
        }
        (folder / "request.md").write_text(request + "\n", encoding="utf-8")
        (folder / "handoff.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        audit_detail = {"id": handoff_id, "files": len(copied), **({"approval_id": approved_id} if approved_id else {})}
        self.audit.record("bridge.handoff", target, outcome, "ok", audit_detail)
        return {"status": "ok", "handoff": {**manifest, "folder": str(folder)}}

    def record_review(self, handoff_id: str, reviewer: str, text: str | None = None, path: str | None = None,
                      approved_id: str | None = None) -> dict:
        folder = self._folder(handoff_id)
        if folder is None:
            return self._invalid("bridge.review", handoff_id, "unknown handoff id")
        if reviewer not in self.targets:
            return self._invalid("bridge.review", handoff_id, f"reviewer must be one of {self.targets}")
        if (text is None) == (path is None):
            return self._invalid("bridge.review", handoff_id, "provide exactly one of text or path")
        if text is not None and (not isinstance(text, str) or not text.strip() or len(text) > self.max_text):
            return self._invalid("bridge.review", handoff_id, f"text must be 1-{self.max_text} characters")
        detail = {"dest": str(folder / "reviews"), "reviewer": reviewer, **({"path": path} if path else {"text": text})}
        blocked, outcome = self._gate("bridge.review", handoff_id, detail, approved_id)
        if blocked:
            return blocked
        source = "text"
        if path is not None:
            src, reason = self.gate.bridge_file(path)
            if src is None:
                self.audit.record("bridge.review", handoff_id, outcome, f"error: {reason}", detail)
                return {"status": "error", "reason": reason}
            text, source = src.read_text(encoding="utf-8", errors="replace"), str(src)
        review_id = _new_id()
        review = {
            "id": review_id,
            "handoff_id": handoff_id,
            "reviewer": reviewer,
            "created": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "sha256": _sha256(text.encode()),
            "text": text,
        }
        (folder / "reviews" / f"{review_id}-{reviewer}.json").write_text(json.dumps(review, indent=2), encoding="utf-8")
        self.audit.record("bridge.review", handoff_id, outcome, "ok", {"review_id": review_id, "reviewer": reviewer})
        return {"status": "ok", "review": review}

    def _reviews(self, folder: Path) -> list[dict]:
        out = [_read_json(p) for p in sorted((folder / "reviews").glob("*.json"))]
        return [r for r in out if r]

    def list_handoffs(self) -> list[dict]:
        if not self.root.is_dir():
            return []
        out = []
        for folder in sorted(self.root.iterdir(), reverse=True):
            manifest = _read_json(folder / "handoff.json") if HANDOFF_ID.match(folder.name) else None
            if manifest:
                out.append({**manifest, "folder": str(folder), "reviews": len(self._reviews(folder))})
        return out

    def list_reviews(self, handoff_id: str | None = None) -> list[dict]:
        if handoff_id:
            folder = self._folder(handoff_id)
            return self._reviews(folder) if folder else []
        if not self.root.is_dir():
            return []
        folders = [f for f in sorted(self.root.iterdir()) if self._folder(f.name)]
        return sorted((r for f in folders for r in self._reviews(f)), key=lambda r: r.get("created", ""), reverse=True)
