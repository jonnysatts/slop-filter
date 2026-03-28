#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from slopfilter_engine import SERVICE
from persistence import utc_now

ROOT = Path(__file__).resolve().parent


def allowed_origins() -> set[str]:
    raw = os.environ.get("SLOPFILTER_ALLOWED_ORIGINS", "").strip()
    if not raw:
        return {"*"}
    return {item.strip() for item in raw.split(",") if item.strip()}


def api_keys() -> set[str]:
    combined = []
    for env_name in ("SLOPFILTER_API_KEY", "SLOPFILTER_API_KEYS"):
        raw = os.environ.get(env_name, "").strip()
        if raw:
            combined.extend(part.strip() for part in raw.split(",") if part.strip())
    return set(combined)


def request_limit_bytes() -> int:
    raw = os.environ.get("SLOPFILTER_MAX_REQUEST_BYTES", "").strip()
    if not raw:
        return 512_000
    try:
        return max(4096, int(raw))
    except ValueError:
        return 512_000


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


class SlopFilterHandler(BaseHTTPRequestHandler):
    static_dir = ROOT

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _request_origin(self) -> str:
        return self.headers.get("Origin", "").strip()

    def _cors_origin(self) -> str:
        origins = allowed_origins()
        origin = self._request_origin()
        if "*" in origins:
            return "*" if not origin else origin
        if origin and origin in origins:
            return origin
        return ""

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        cors_origin = self._cors_origin()
        if cors_origin:
            self.send_header("Access-Control-Allow-Origin", cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, payload: object, status: int = 200) -> None:
        self._send(status, json_bytes(payload))

    def _send_error(self, message: str, status: int = 400) -> None:
        self._send_json({"error": message, "status": status}, status=status)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > request_limit_bytes():
            raise ValueError(f"Payload exceeds {request_limit_bytes()} bytes.")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as exc:  # pragma: no cover - error sent to client
            raise ValueError(f"Invalid JSON payload: {exc}") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON payload must be an object.")
        return payload

    def _auth_token(self) -> str:
        bearer = self.headers.get("Authorization", "").strip()
        if bearer.lower().startswith("bearer "):
            return bearer[7:].strip()
        return self.headers.get("X-API-Key", "").strip()

    def _api_requires_auth(self, path: str) -> bool:
        if not api_keys():
            return False
        return path not in {"/api/health", "/api/config"}

    def _enforce_auth(self, path: str) -> bool:
        if not self._api_requires_auth(path):
            return True
        if self._auth_token() in api_keys():
            return True
        self._send_error("Missing or invalid API key.", status=401)
        return False

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            if not self._enforce_auth(parsed.path):
                return
            self._handle_api_get(parsed.path)
            return
        self._serve_static(parsed.path)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        cors_origin = self._cors_origin()
        if cors_origin:
            self.send_header("Access-Control-Allow-Origin", cors_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self._send_error("Unknown route.", status=404)
            return
        if not self._enforce_auth(parsed.path):
            return
        try:
            payload = self._read_json()
            self._handle_api_post(parsed.path, payload)
        except ValueError as exc:
            self._send_error(str(exc), status=400)
        except KeyError as exc:
            self._send_error(str(exc), status=404)
        except Exception as exc:  # pragma: no cover - keep server alive
            self._send_error(str(exc), status=500)

    def _handle_api_get(self, path: str) -> None:
        if path == "/api/health":
            self._send_json({"ok": True, "time": utc_now()})
            return
        if path == "/api/config":
            self._send_json(
                {
                    "app_version": "3.0-alpha",
                    "modes": ["preserve-batch-voice", "house-voice", "hybrid"],
                    "document_modes": ["fiction", "essay", "marketing", "business", "worldbuilding"],
                    "edit_budgets": ["minimal", "medium", "aggressive"],
                    "portable_endpoint": "/api/portable/slop-check",
                    "portable_endpoint_v1": "/api/v1/slop-check",
                    "auth_required": bool(api_keys()),
                    "allowed_origins": sorted(origin for origin in allowed_origins() if origin != "*"),
                    "voice_packs": SERVICE.list_voice_packs(),
                }
            )
            return
        if path == "/api/batches":
            self._send_json(SERVICE.list_batches())
            return
        if path == "/api/voice-packs":
            self._send_json(SERVICE.list_voice_packs())
            return
        if path.startswith("/api/batches/") and path.endswith("/export.zip"):
            batch_id = path[len("/api/batches/") : -len("/export.zip")].strip("/")
            try:
                zip_path = SERVICE.export_zip(batch_id)
            except KeyError:
                self._send_error("Batch not found.", status=404)
                return
            data = zip_path.read_bytes()
            self.send_response(200)
            cors_origin = self._cors_origin()
            if cors_origin:
                self.send_header("Access-Control-Allow-Origin", cors_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{zip_path.name}"')
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if path.startswith("/api/batches/"):
            batch_id = path[len("/api/batches/") :].strip("/")
            try:
                self._send_json(SERVICE.get_batch(batch_id))
            except KeyError:
                self._send_error("Batch not found.", status=404)
            return
        if path.startswith("/api/documents/"):
            document_id = path[len("/api/documents/") :].strip("/")
            try:
                self._send_json(SERVICE.get_document(document_id))
            except KeyError:
                self._send_error("Document not found.", status=404)
            return
        self._send_error("Unknown route.", status=404)

    def _handle_api_post(self, path: str, payload: dict) -> None:
        if path == "/api/batches":
            batch = SERVICE.create_batch(payload)
            self._send_json(batch, status=201)
            return
        if path == "/api/voice-packs":
            voice_pack = SERVICE.create_voice_pack(payload.get("name", "Voice Pack"), payload.get("sample_text", ""))
            self._send_json(voice_pack, status=201)
            return
        if path.startswith("/api/batches/") and path.endswith("/rerun-outliers"):
            batch_id = path[len("/api/batches/") : -len("/rerun-outliers")].strip("/")
            self._send_json(SERVICE.rerun_outliers(batch_id), status=202)
            return
        if path.startswith("/api/documents/") and path.endswith("/rerun"):
            document_id = path[len("/api/documents/") : -len("/rerun")].strip("/")
            self._send_json(SERVICE.rerun_document(document_id, payload.get("edit_budget")), status=202)
            return
        if path in {"/api/portable/slop-check", "/api/v1/slop-check"}:
            self._send_json(SERVICE.portable_slop_check(payload, api_key=self._auth_token()), status=200)
            return
        self._send_error("Unknown route.", status=404)

    def _serve_static(self, raw_path: str) -> None:
        requested = raw_path.lstrip("/") or "index.html"
        candidate = (self.static_dir / requested).resolve()
        try:
            candidate.relative_to(self.static_dir.resolve())
        except ValueError:
            self._send_error("Blocked.", status=403)
            return
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.exists():
            candidate = self.static_dir / "index.html"
        if not candidate.exists():
            self._send_error("index.html not found.", status=404)
            return
        content = candidate.read_bytes()
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Slop Filter V3 alpha server.")
    parser.add_argument("--host", default=os.environ.get("SLOPFILTER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", os.environ.get("SLOPFILTER_PORT", "8743"))))
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer((args.host, args.port), SlopFilterHandler)
    print(f"\n  Slop Filter V3 alpha running at http://{args.host}:{args.port}")
    print("  Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.\n")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
