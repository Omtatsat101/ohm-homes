import ipaddress
import os
import tomllib
from pathlib import Path

FILES = ("system", "connectors", "permissions", "voice", "ui")
LOOPBACK_NAMES = {"localhost"}


class ConfigError(ValueError):
    pass


def default_config_dir() -> Path:
    env = os.environ.get("OHM_CONFIG_DIR")
    return Path(env) if env else Path(__file__).resolve().parents[2] / "config"


def load_config(config_dir: str | Path | None = None) -> dict:
    directory = Path(config_dir) if config_dir else default_config_dir()
    cfg: dict = {}
    for name in FILES:
        path = directory / f"{name}.toml"
        if not path.is_file():
            raise ConfigError(f"missing config file: {path}")
        try:
            with path.open("rb") as fh:
                cfg[name] = tomllib.load(fh)
        except tomllib.TOMLDecodeError as exc:
            raise ConfigError(f"{path}: {exc}") from exc
    cfg["_operator_dir"] = str(directory.resolve().parent)
    cfg["_config_dir"] = str(directory.resolve())
    validate(cfg)
    return cfg


def is_loopback(host: str) -> bool:
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def resolve(cfg: dict, value: str) -> str:
    paths = cfg.get("system", {}).get("paths", {})
    workspace = os.path.expanduser(os.path.expandvars(paths.get("workspace", "")))
    out = value.replace("{workspace}", workspace).replace("{operator}", cfg.get("_operator_dir", ""))
    return os.path.expanduser(os.path.expandvars(out))


def resolve_path(cfg: dict, value: str) -> Path:
    return Path(resolve(cfg, value))


def _secret_pairs(cfg: dict) -> list[tuple[str, str]]:
    value = cfg.get("system", {}).get("paths", {}).get("secrets_file")
    if not value:
        return []
    try:
        lines = resolve_path(cfg, value).read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return []
    pairs = []
    for line in lines:
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, sep, val = line.partition("=")
        if sep and not name.lstrip().startswith("#"):
            pairs.append((name.strip(), val.strip().strip("'\"")))
    return pairs


def read_secret(cfg: dict, key: str) -> str | None:
    return next((v for k, v in _secret_pairs(cfg) if key and k == key and v), None)


def read_secret_values(cfg: dict, min_length: int = 8) -> list[str]:
    return [v for _, v in _secret_pairs(cfg) if len(v) >= min_length]


def validate(cfg: dict) -> None:
    runtime = cfg.get("system", {}).get("runtime", {})
    host = runtime.get("host", "127.0.0.1")
    if not is_loopback(host):
        raise ConfigError(f"runtime.host must be loopback, got {host!r}")
    port = runtime.get("port", 8765)
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ConfigError(f"runtime.port invalid: {port!r}")
    for name, tool in cfg.get("system", {}).get("tools", {}).items():
        argv = tool.get("argv")
        if not isinstance(argv, list) or not argv or not all(isinstance(a, str) for a in argv):
            raise ConfigError(f"tools.{name}.argv must be a non-empty list of strings")
    from .permissions import validate_policy

    validate_policy(cfg.get("permissions", {}))
