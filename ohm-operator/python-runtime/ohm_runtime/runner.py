import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path

from .audit import ApprovalQueue, AuditLog
from .config import resolve
from .permissions import ALLOW, APPROVE, Action, PermissionGate


@dataclass
class RunResult:
    status: str
    tool: str
    reason: str = ""
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    approval_id: str | None = None
    argv: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class ToolRunner:
    def __init__(self, cfg: dict, gate: PermissionGate, audit: AuditLog, approvals: ApprovalQueue):
        self.cfg = cfg
        self.gate = gate
        self.audit = audit
        self.approvals = approvals
        self.tools = cfg.get("system", {}).get("tools", {})
        self.max_output = cfg.get("system", {}).get("runtime", {}).get("max_output_chars", 20000)

    def list_tools(self) -> list[dict]:
        out = []
        for name, tool in sorted(self.tools.items()):
            decision = self.gate.decide(Action("tool.run", name))
            out.append({
                "name": name,
                "description": tool.get("description", ""),
                "class": tool.get("class", "tool.run"),
                "extra_args": tool.get("extra_args", False),
                "decision": decision.outcome,
            })
        return out

    def request(self, name: str, args: list[str] | tuple = (), approved_id: str | None = None) -> RunResult:
        args = list(args)
        decision = self.gate.decide(Action("tool.run", name, {"args": args}))
        detail = {"args": args}
        if decision.outcome == APPROVE and approved_id is None:
            approval_id = self.approvals.create("tool.run", name, detail, decision.reason)
            self.audit.record("tool.run", name, APPROVE, f"pending:{approval_id}", detail)
            return RunResult("pending", name, decision.reason, approval_id=approval_id)
        if decision.outcome not in (ALLOW, APPROVE):
            self.audit.record("tool.run", name, decision.outcome, f"blocked: {decision.reason}", detail)
            return RunResult("denied", name, decision.reason)
        if approved_id:
            detail["approval_id"] = approved_id
        return self._execute(name, args, decision.outcome, detail)

    def _execute(self, name: str, args: list[str], outcome: str, detail: dict) -> RunResult:
        tool = self.tools[name]
        argv = [resolve(self.cfg, a) for a in tool["argv"]] + [resolve(self.cfg, a) for a in args]
        cwd = resolve(self.cfg, tool["cwd"]) if tool.get("cwd") else None
        if cwd and not Path(cwd).is_dir():
            reason = f"working directory not found: {cwd}"
            self.audit.record("tool.run", name, outcome, f"error: {reason}", detail)
            return RunResult("error", name, reason, argv=argv)
        try:
            proc = subprocess.run(
                argv,
                cwd=cwd,
                shell=False,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                errors="replace",
                timeout=tool.get("timeout", 60),
            )
        except FileNotFoundError:
            reason = f"executable not found: {argv[0]}"
            self.audit.record("tool.run", name, outcome, f"error: {reason}", detail)
            return RunResult("error", name, reason, argv=argv)
        except subprocess.TimeoutExpired:
            reason = f"timed out after {tool.get('timeout', 60)}s"
            self.audit.record("tool.run", name, outcome, f"error: {reason}", detail)
            return RunResult("error", name, reason, argv=argv)
        status = "ok" if proc.returncode == 0 else "failed"
        self.audit.record("tool.run", name, outcome, f"{status} exit={proc.returncode}", detail)
        return RunResult(
            status, name, exit_code=proc.returncode,
            stdout=proc.stdout[-self.max_output:], stderr=proc.stderr[-self.max_output:], argv=argv,
        )
