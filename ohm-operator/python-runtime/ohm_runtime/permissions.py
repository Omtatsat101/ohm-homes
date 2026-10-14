from dataclasses import dataclass, field
from fnmatch import fnmatch
from pathlib import Path
from urllib.parse import urlparse

from .config import ConfigError, is_loopback, resolve, resolve_path

ALLOW, APPROVE, DENY = "allow", "approve", "deny"
OUTCOMES = {ALLOW, APPROVE, DENY}
ALWAYS_CONFIRM = {"export.untrusted", "destructive", "message.send", "account.change", "connector.unauthorized"}
DEFAULT_POLICY = {
    "unknown": DENY,
    "tool.run": ALLOW,
    "connector.unauthorized": DENY,
    "export.untrusted": APPROVE,
    "destructive": APPROVE,
    "message.send": APPROVE,
    "account.change": APPROVE,
    "memory.write": APPROVE,
}
FORBIDDEN_ARG_CHARS = ("\x00", "\n", "\r")
DEFAULT_DENY_GLOBS = ["*.env", ".env*", "*.pem", "*.key", "*.pfx", "*.p12", "id_rsa*", "id_ed25519*", "*api-keys*"]


@dataclass(frozen=True)
class Action:
    kind: str
    target: str
    detail: dict = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Decision:
    outcome: str
    reason: str

    @property
    def allowed(self) -> bool:
        return self.outcome == ALLOW


def validate_policy(permissions: dict) -> dict:
    policy = {**DEFAULT_POLICY, **permissions.get("policy", {})}
    for key, value in policy.items():
        if value not in OUTCOMES:
            raise ConfigError(f"permissions.policy.{key} must be one of {sorted(OUTCOMES)}")
        if key in ALWAYS_CONFIRM and value == ALLOW:
            raise ConfigError(f"permissions.policy.{key} is always-confirm and cannot be 'allow'")
    return policy


class PermissionGate:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.policy = validate_policy(cfg.get("permissions", {}))
        self.tools = cfg.get("system", {}).get("tools", {})
        self.connectors = cfg.get("connectors", {}).get("connectors", {})
        zones = cfg.get("permissions", {}).get("export", {}).get("trusted_zones", [])
        self.trusted_zones = [resolve_path(cfg, z).resolve() for z in zones]
        bridge = cfg.get("connectors", {}).get("bridge", {})
        self.bridge_roots = [resolve_path(cfg, r).resolve() for r in bridge.get("file_roots", ["{workspace}/projects"])]
        self.bridge_deny_globs = [g.lower() for g in bridge.get("deny_globs", DEFAULT_DENY_GLOBS)]
        self.bridge_max_bytes = bridge.get("max_file_bytes", 1024 * 1024)
        self.bridge_max_files = bridge.get("max_files", 20)
        secrets = cfg.get("system", {}).get("paths", {}).get("secrets_file")
        self.secrets_file = resolve_path(cfg, secrets).resolve() if secrets else None

    def decide(self, action: Action) -> Decision:
        handler = {
            "tool.run": self._tool,
            "connector.outbound": self._connector,
            "export": self._export,
            "model.local": self._model,
            "bridge.handoff": self._bridge,
            "bridge.review": self._bridge,
            "memory.write": self._memory,
        }.get(action.kind)
        if handler:
            return handler(action)
        if action.kind in self.policy and action.kind != "unknown":
            return Decision(self.policy[action.kind], f"policy for {action.kind}")
        return Decision(self.policy["unknown"], f"unknown action kind {action.kind!r}")

    def _tool(self, action: Action) -> Decision:
        tool = self.tools.get(action.target)
        if tool is None:
            return Decision(DENY, f"tool {action.target!r} is not in a configured tool profile")
        args = list(action.detail.get("args", []))
        if args and not tool.get("extra_args", False):
            return Decision(DENY, f"tool {action.target!r} does not accept extra arguments")
        if len(args) > tool.get("max_args", 8):
            return Decision(DENY, f"tool {action.target!r} accepts at most {tool.get('max_args', 8)} arguments")
        for arg in args:
            if not isinstance(arg, str) or any(c in arg for c in FORBIDDEN_ARG_CHARS):
                return Decision(DENY, "argument contains forbidden characters")
            if tool.get("arg_type") == "dir" and not Path(resolve(self.cfg, arg)).is_dir():
                return Decision(DENY, f"argument {arg!r} is not an existing directory")
        tool_class = tool.get("class", "tool.run")
        if tool_class == "destructive" or tool.get("require_approval", False):
            outcome = self.policy["destructive"] if tool_class == "destructive" else APPROVE
            return Decision(outcome, f"tool {action.target!r} is {tool_class}; explicit confirmation required")
        return Decision(self.policy["tool.run"], f"tool {action.target!r} is in an approved profile")

    def _connector(self, action: Action) -> Decision:
        conn = self.connectors.get(action.target)
        if conn is None:
            return Decision(DENY, f"connector {action.target!r} is not configured")
        if not conn.get("enabled", False):
            return Decision(DENY, f"connector {action.target!r} is disabled")
        host = (action.detail.get("host") or "").lower()
        if host not in [h.lower() for h in conn.get("allowed_hosts", [])]:
            return Decision(DENY, f"host {host!r} is not allowed for connector {action.target!r}")
        if conn.get("preauthorized", False):
            return Decision(ALLOW, f"connector {action.target!r} is pre-authorized for {host}")
        return Decision(self.policy["connector.unauthorized"], f"connector {action.target!r} is not pre-authorized")

    def _export(self, action: Action) -> Decision:
        dest = action.detail.get("path") or action.target
        try:
            resolved = Path(resolve(self.cfg, dest)).resolve()
        except (OSError, RuntimeError):
            return Decision(DENY, f"export path {dest!r} could not be resolved")
        if any(resolved.is_relative_to(z) for z in self.trusted_zones):
            return Decision(ALLOW, "export target is inside a trusted zone")
        return Decision(self.policy["export.untrusted"], "export target is outside trusted zones")

    def bridge_file(self, value) -> tuple[Path | None, str]:
        if not isinstance(value, str) or not value.strip() or any(c in value for c in FORBIDDEN_ARG_CHARS):
            return None, "invalid file path"
        path = Path(resolve(self.cfg, value.strip()))
        if not path.is_absolute():
            path = Path(resolve(self.cfg, "{workspace}")) / path
        try:
            real = path.resolve(strict=True)
        except (OSError, RuntimeError):
            return None, f"file not found: {value}"
        if not real.is_file():
            return None, f"not a regular file: {value}"
        if not any(real.is_relative_to(r) for r in self.bridge_roots):
            return None, f"{value} is outside the bridge file roots"
        if real == self.secrets_file or any(fnmatch(real.name.lower(), g) for g in self.bridge_deny_globs):
            return None, f"{value} looks like a secret and cannot be bridged"
        if real.stat().st_size > self.bridge_max_bytes:
            return None, f"{value} is larger than {self.bridge_max_bytes} bytes"
        return real, ""

    def _bridge(self, action: Action) -> Decision:
        files = list(action.detail.get("files", []))
        if action.detail.get("path"):
            files.append(action.detail["path"])
        if len(files) > self.bridge_max_files:
            return Decision(DENY, f"at most {self.bridge_max_files} files per handoff")
        for f in files:
            _, reason = self.bridge_file(f)
            if reason:
                return Decision(DENY, reason)
        if not action.detail.get("dest"):
            return Decision(DENY, "bridge action has no destination")
        return self._export(Action("export", action.detail["dest"]))

    def _memory(self, action: Action) -> Decision:
        if not action.detail.get("enabled", False):
            return Decision(DENY, "memory writes are disabled (system.memory.writes = false)")
        return Decision(self.policy["memory.write"], "policy for memory.write")

    def _model(self, action: Action) -> Decision:
        host = urlparse(action.detail.get("endpoint", "")).hostname or ""
        if is_loopback(host):
            return Decision(ALLOW, "local model endpoint")
        return Decision(DENY, "model endpoint is not loopback; route it through an outbound connector")
