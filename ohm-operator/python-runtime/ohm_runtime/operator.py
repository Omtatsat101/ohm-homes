import json
import os
import shlex
import urllib.error
import urllib.request
from pathlib import Path

from . import __version__
from .audit import ApprovalQueue, AuditLog, Store
from .bridge import BridgeConnector
from .config import resolve_path
from .handoff import HandoffStore
from .permissions import Action, PermissionGate
from .runner import ToolRunner

HELP = """Commands:
/status - operator status
/tools - list tool profiles
/run <tool> [args] - run a tool through the permission gate
/bridge - bridge bundle status
/bridge refresh - rebuild bridge bundles
/handoff <target> <request> [@file ...] - package a bridge handoff (files relative to workspace)
/handoffs - list handoffs
/review <handoff_id> <reviewer> <text | @file> - record a review output
/reviews [handoff_id] - list reviews
/approvals - pending approvals
Anything else goes to the local model if it is available."""


class Operator:
    def __init__(self, cfg: dict, db_path: str | Path | None = None):
        self.cfg = cfg
        system = cfg.get("system", {})
        if db_path is None:
            db_path = resolve_path(cfg, system.get("runtime", {}).get("data_dir", "{operator}/data")) / "operator.db"
        self.store = Store(db_path)
        self.audit = AuditLog(self.store)
        expire = cfg.get("permissions", {}).get("approvals", {}).get("expire_minutes", 60)
        self.approvals = ApprovalQueue(self.store, expire)
        self.gate = PermissionGate(cfg)
        self.runner = ToolRunner(cfg, self.gate, self.audit, self.approvals)
        self.bridge = BridgeConnector(cfg)
        self.handoffs = HandoffStore(cfg, self.gate, self.audit, self.approvals, self.bridge)
        self.model_cfg = system.get("model", {})

    def _path_state(self, key: str) -> dict:
        value = self.cfg.get("system", {}).get("paths", {}).get(key)
        if not value:
            return {"path": None, "exists": False}
        path = resolve_path(self.cfg, value)
        return {"path": str(path), "exists": path.exists()}

    def model_status(self) -> dict:
        m = self.model_cfg
        if not m.get("enabled", False):
            return {"provider": m.get("provider"), "state": "disabled", "name": m.get("name")}
        decision = self.gate.decide(Action("model.local", m.get("provider", ""), {"endpoint": m.get("endpoint", "")}))
        if not decision.allowed:
            return {"provider": m.get("provider"), "state": "blocked", "reason": decision.reason, "name": m.get("name")}
        try:
            self._model_request("/api/tags", None, timeout=2)
            state = "online"
        except (urllib.error.URLError, OSError, ValueError):
            state = "offline"
        return {"provider": m.get("provider"), "state": state, "name": m.get("name"), "endpoint": m.get("endpoint")}

    def status(self) -> dict:
        voice = self.cfg.get("voice", {})
        return {
            "version": __version__,
            "ui": self.cfg.get("ui", {}).get("ui", {}),
            "voice": {"enabled": voice.get("voice", {}).get("enabled", False),
                      "stt": voice.get("stt", {}).get("engine"), "tts": voice.get("tts", {}).get("engine")},
            "model": self.model_status(),
            "bridge": self.bridge.status(),
            "memory": {"primer": self._path_state("primer"), "obsidian_vault": self._path_state("obsidian_vault")},
            "secrets_file_present": self._path_state("secrets_file")["exists"],
            "pending_approvals": len(self.approvals.pending()),
            "onboarding_completed": self.cfg.get("system", {}).get("onboarding", {}).get("completed", False),
        }

    def projects(self) -> list[dict]:
        root = self._path_state("projects")
        if not root["exists"]:
            return []
        out = []
        for p in sorted(Path(root["path"]).iterdir()):
            if p.is_dir() and not p.name.startswith("."):
                out.append({"name": p.name, "path": str(p), "git": (p / ".git").exists()})
        return out

    def permissions(self) -> dict:
        connectors = []
        for name, c in sorted(self.cfg.get("connectors", {}).get("connectors", {}).items()):
            connectors.append({
                "name": name,
                "kind": c.get("kind", "outbound"),
                "enabled": c.get("enabled", False),
                "preauthorized": c.get("preauthorized", False),
                "allowed_hosts": c.get("allowed_hosts", []),
            })
        return {
            "policy": self.gate.policy,
            "trusted_zones": [str(z) for z in self.gate.trusted_zones],
            "connectors": connectors,
            "pending": self.approvals.pending(),
        }

    def resolve_approval(self, approval_id: str, approve: bool) -> dict:
        row = self.approvals.resolve(approval_id, "approved" if approve else "rejected")
        if row is None:
            return {"status": "not_found", "reason": "approval is not pending (unknown, resolved, or expired)"}
        if not approve:
            self.audit.record(row["kind"], row["target"], "rejected", "rejected by user", {"approval_id": approval_id})
            return {"status": "rejected", "approval_id": approval_id}
        d = row["detail"]
        if row["kind"] == "tool.run":
            return self.runner.request(row["target"], d.get("args", []), approved_id=approval_id).to_dict()
        if row["kind"] == "bridge.handoff":
            return self.handoffs.package(row["target"], d.get("request", ""), d.get("files", []), approved_id=approval_id)
        if row["kind"] == "bridge.review":
            return self.handoffs.record_review(row["target"], d.get("reviewer", ""), d.get("text"), d.get("path"),
                                               approved_id=approval_id)
        self.audit.record(row["kind"], row["target"], "approved", "no executor for this action kind", {"approval_id": approval_id})
        return {"status": "error", "reason": f"no executor for {row['kind']}"}

    def chat(self, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            return {"kind": "error", "reply": "empty message"}
        if not text.startswith("/"):
            return self._ask_model(text)
        head, _, rest = text.partition(" ")
        if head.lower() in ("/handoff", "/review"):
            return self._bridge_command(head.lower(), rest.split())
        try:
            parts = shlex.split(text, posix=os.name != "nt")
        except ValueError as exc:
            return {"kind": "error", "reply": f"could not parse command: {exc}"}
        parts = [p.strip('"') for p in parts]
        cmd, args = parts[0].lower(), parts[1:]
        if cmd == "/help":
            return {"kind": "help", "reply": HELP}
        if cmd == "/status":
            return {"kind": "status", "reply": "operator status", "data": self.status()}
        if cmd == "/tools":
            tools = self.runner.list_tools()
            lines = [f"{t['name']} [{t['decision']}] - {t['description']}" for t in tools]
            return {"kind": "tools", "reply": "\n".join(lines) or "no tools configured", "data": tools}
        if cmd == "/approvals":
            pending = self.approvals.pending()
            lines = [f"{p['id']}: {p['kind']} {p['target']} - {p['reason']}" for p in pending]
            return {"kind": "approvals", "reply": "\n".join(lines) or "no pending approvals", "data": pending}
        if cmd == "/bridge":
            if args[:1] == ["refresh"]:
                return self._run(self.bridge.refresh_tool, [])
            status = self.bridge.status()
            lines = [f"bridge: {status['state']}"] + [f"{b['name']}: {b['state']}" for b in status["bundles"]]
            return {"kind": "bridge", "reply": "\n".join(lines), "data": status}
        if cmd == "/handoffs":
            items = self.handoffs.list_handoffs()
            lines = [f"{h['id']} -> {h['target']}: {h['request'][:60]} ({len(h['files'])} files, {h['reviews']} reviews)" for h in items]
            return {"kind": "handoffs", "reply": "\n".join(lines) or "no handoffs", "data": items}
        if cmd == "/reviews":
            items = self.handoffs.list_reviews(args[0] if args else None)
            lines = [f"{r['handoff_id']} {r['reviewer']}: {r['text'][:80]}" for r in items]
            return {"kind": "reviews", "reply": "\n".join(lines) or "no reviews", "data": items}
        if cmd == "/run":
            if not args:
                return {"kind": "error", "reply": "usage: /run <tool> [args]"}
            return self._run(args[0], args[1:])
        return {"kind": "error", "reply": f"unknown command {cmd}. Try /help"}

    def _bridge_command(self, cmd: str, words: list[str]) -> dict:
        files = [w[1:] for w in words if w.startswith("@") and len(w) > 1]
        rest = [w for w in words if not w.startswith("@")]
        if cmd == "/handoff":
            if len(rest) < 2:
                return {"kind": "error", "reply": "usage: /handoff <target> <request> [@file ...]"}
            result = self.handoffs.package(rest[0], " ".join(rest[1:]), files)
            ok = f"handoff {result['handoff']['id']} packaged at {result['handoff']['folder']}" if result["status"] == "ok" else ""
        else:
            if len(rest) < 2 or (len(rest) > 2) == bool(files) or len(files) > 1:
                return {"kind": "error", "reply": "usage: /review <handoff_id> <reviewer> <text | @file>"}
            text = None if files else " ".join(rest[2:])
            result = self.handoffs.record_review(rest[0], rest[1], text, files[0] if files else None)
            ok = f"review {result['review']['id']} recorded for {rest[0]}" if result["status"] == "ok" else ""
        reply = ok or f"{result['status']}: {result['reason']}"
        return {"kind": cmd[1:], "reply": reply, "data": result}

    def _run(self, tool: str, args: list[str]) -> dict:
        result = self.runner.request(tool, args).to_dict()
        if result["status"] == "pending":
            reply = f"{tool} needs approval: {result['reason']}"
        elif result["status"] == "denied":
            reply = f"{tool} denied: {result['reason']}"
        elif result["status"] == "error":
            reply = f"{tool} error: {result['reason']}"
        else:
            reply = (result["stdout"] or result["stderr"] or f"{tool} exited {result['exit_code']}").rstrip()
        return {"kind": "run", "reply": reply, "data": result}

    def _model_request(self, path: str, body: dict | None, timeout: float) -> dict:
        url = self.model_cfg.get("endpoint", "").rstrip("/") + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode() or "{}")

    def _ask_model(self, text: str) -> dict:
        m = self.model_cfg
        provider = m.get("provider", "")
        if not m.get("enabled", False):
            return {"kind": "degraded", "reply": "Local model is disabled. Chat-only/manual mode: use /help for commands."}
        decision = self.gate.decide(Action("model.local", provider, {"endpoint": m.get("endpoint", "")}))
        if not decision.allowed:
            self.audit.record("model.local", provider, decision.outcome, f"blocked: {decision.reason}")
            return {"kind": "denied", "reply": f"Model call blocked: {decision.reason}"}
        body = {
            "model": m.get("name"),
            "stream": False,
            "messages": [{"role": "system", "content": m.get("system_prompt", "")}, {"role": "user", "content": text}],
        }
        try:
            resp = self._model_request("/api/chat", body, timeout=m.get("timeout", 60))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            self.audit.record("model.local", provider, decision.outcome, f"unavailable: {exc}")
            return {"kind": "degraded", "reply": f"Local model unavailable ({provider} at {m.get('endpoint')}). Chat-only/manual mode: use /help for commands."}
        self.audit.record("model.local", provider, decision.outcome, "ok", {"model": m.get("name")})
        return {"kind": "model", "reply": resp.get("message", {}).get("content", "").strip()}
