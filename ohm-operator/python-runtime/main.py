import argparse
import sys

from ohm_runtime.config import ConfigError, is_loopback, load_config
from ohm_runtime.operator import Operator
from ohm_runtime.server import make_server


def main() -> int:
    parser = argparse.ArgumentParser(description="Ohm.Homes operator sidecar (localhost only)")
    parser.add_argument("--config", help="config directory (default: ../config or $OHM_CONFIG_DIR)")
    parser.add_argument("--db", help="SQLite path (default: <data_dir>/operator.db)")
    parser.add_argument("--port", type=int, help="override runtime.port")
    args = parser.parse_args()
    try:
        cfg = load_config(args.config)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2
    runtime = cfg["system"].get("runtime", {})
    host = runtime.get("host", "127.0.0.1")
    if not is_loopback(host):
        print("refusing to bind a non-loopback host", file=sys.stderr)
        return 2
    port = args.port if args.port is not None else runtime.get("port", 8765)
    operator = Operator(cfg, args.db)
    server = make_server(operator, host, port)
    operator.audit.record("runtime.start", f"{host}:{server.server_address[1]}", "allow", "listening")
    print(f"ohm operator sidecar listening on http://{host}:{server.server_address[1]}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        operator.audit.record("runtime.stop", host, "allow", "stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
