import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .operator import Operator

MAX_BODY = 64 * 1024
APPROVAL_PATH = re.compile(r"^/approvals/([0-9a-f]{12})$")


def make_server(operator: Operator, host: str, port: int) -> ThreadingHTTPServer:
    runtime = operator.cfg.get("system", {}).get("runtime", {})
    allowed_origins = set(runtime.get("allowed_origins", []))

    class Handler(BaseHTTPRequestHandler):
        server_version = "OhmOperator"

        def log_message(self, fmt, *args):
            pass

        def _host_ok(self) -> bool:
            bound = self.server.server_address[1]
            return self.headers.get("Host", "") in {f"127.0.0.1:{bound}", f"localhost:{bound}", f"[::1]:{bound}"}

        def _origin_ok(self) -> bool:
            origin = self.headers.get("Origin")
            return origin is None or origin in allowed_origins

        def _send(self, code: int, payload) -> None:
            body = json.dumps(payload, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            origin = self.headers.get("Origin")
            if origin and origin in allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def _guard(self) -> bool:
            if not self._host_ok():
                self._send(403, {"error": "invalid host"})
                return False
            if not self._origin_ok():
                self._send(403, {"error": "origin not allowed"})
                return False
            return True

        def _json_body(self):
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self._send(415, {"error": "content-type must be application/json"})
                return None
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                self._send(413, {"error": "body too large"})
                return None
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self._send(400, {"error": "invalid json"})
                return None
            if not isinstance(data, dict):
                self._send(400, {"error": "body must be a json object"})
                return None
            return data

        def do_OPTIONS(self):
            if not self._guard():
                return
            self.send_response(204)
            origin = self.headers.get("Origin")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Max-Age", "600")
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            if not self._guard():
                return
            url = urlparse(self.path)
            routes = {
                "/status": operator.status,
                "/approvals": operator.approvals.pending,
                "/tools": operator.runner.list_tools,
                "/projects": operator.projects,
                "/permissions": operator.permissions,
                "/bridge/handoffs": operator.handoffs.list_handoffs,
                "/health": lambda: {"ok": True},
            }
            if url.path == "/bridge/reviews":
                handoff = parse_qs(url.query).get("handoff", [None])[0]
                return self._send(200, operator.handoffs.list_reviews(handoff))
            if url.path == "/audit":
                try:
                    limit = int(parse_qs(url.query).get("limit", ["50"])[0])
                except ValueError:
                    limit = 50
                return self._send(200, operator.audit.recent(limit))
            handler = routes.get(url.path)
            if handler is None:
                return self._send(404, {"error": "not found"})
            self._send(200, handler())

        def do_POST(self):
            if not self._guard():
                return
            path = urlparse(self.path).path
            data = self._json_body()
            if data is None:
                return
            if path == "/chat":
                text = data.get("text")
                if not isinstance(text, str):
                    return self._send(400, {"error": "text must be a string"})
                return self._send(200, operator.chat(text))
            if path == "/bridge/handoffs":
                return self._send(200, operator.handoffs.package(data.get("target"), data.get("request"), data.get("files") or []))
            if path == "/bridge/reviews":
                return self._send(200, operator.handoffs.record_review(
                    data.get("handoff_id"), data.get("reviewer"), data.get("text"), data.get("path")))
            match = APPROVAL_PATH.match(path)
            if match:
                decision = data.get("decision")
                if decision not in ("approve", "reject"):
                    return self._send(400, {"error": "decision must be 'approve' or 'reject'"})
                return self._send(200, operator.resolve_approval(match.group(1), decision == "approve"))
            self._send(404, {"error": "not found"})

    return ThreadingHTTPServer((host, port), Handler)
