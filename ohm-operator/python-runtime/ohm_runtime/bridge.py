import time
from pathlib import Path

from .config import resolve_path

FRESH, STALE, MISSING = "fresh", "stale", "missing"


class BridgeConnector:
    """File-based interface to projects/local-assist-bridge. Reports real filesystem state only."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.settings = cfg.get("connectors", {}).get("bridge", {})
        self.enabled = self.settings.get("enabled", False)
        self.root = resolve_path(cfg, self.settings["root"]) if self.settings.get("root") else None
        self.stale_after = self.settings.get("stale_after_minutes", 720) * 60
        self.refresh_tool = self.settings.get("refresh_tool", "")

    def bundle_status(self, name: str, rel: str) -> dict:
        path = Path(rel) if Path(rel).is_absolute() or self.root is None else self.root / rel
        if not path.is_file():
            return {"name": name, "path": str(path), "state": MISSING, "age_minutes": None, "bytes": None}
        stat = path.stat()
        age = max(0.0, time.time() - stat.st_mtime)
        return {
            "name": name,
            "path": str(path),
            "state": FRESH if age <= self.stale_after else STALE,
            "age_minutes": round(age / 60, 1),
            "bytes": stat.st_size,
        }

    def status(self) -> dict:
        if not self.enabled or self.root is None:
            return {"enabled": False, "state": "disabled", "root": None, "root_exists": False, "script": None, "bundles": []}
        script = self.root / self.settings.get("refresh_script", "build-safe-context.ps1")
        bundles = [self.bundle_status(n, p) for n, p in sorted(self.settings.get("bundles", {}).items())]
        states = {b["state"] for b in bundles}
        if not self.root.is_dir() or not bundles or states == {MISSING}:
            overall = MISSING
        elif states == {FRESH}:
            overall = FRESH
        else:
            overall = STALE
        return {
            "enabled": True,
            "state": overall,
            "root": str(self.root),
            "root_exists": self.root.is_dir(),
            "script": {"path": str(script), "exists": script.is_file()},
            "refresh_tool": self.refresh_tool,
            "bundles": bundles,
        }
