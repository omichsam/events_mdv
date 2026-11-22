# -*- coding: utf-8 -*-
"""Local server for the MDV prototype.

Serves the site like `python -m http.server`, plus a small API that the
organizer desk (portal.html) uses to publish:

    GET  /api/content   the content store (data/content.json)
    PUT  /api/content   save the content store, keep a backup, rebuild the site
    POST /api/upload    save an event photo (images/<slug>.jpg), then rebuild

Run:  python serve.py            (http://127.0.0.1:8000)
      python serve.py --port 8080

This is a local authoring tool, not a production server. It only listens on
127.0.0.1, only accepts requests whose Host is localhost, and requires the
X-MDV-Desk header so that other websites cannot post to it from a browser.
There is no real authentication: anyone who can reach the port can publish.
"""
import argparse
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONTENT = ROOT / "data" / "content.json"
BACKUPS = ROOT / "data" / "backups"
MAX_BODY = 8 * 1024 * 1024
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
BUILD_LOCK = threading.Lock()


def build():
    """Run render_site.py; return (ok, output)."""
    with BUILD_LOCK:
        result = subprocess.run(
            [sys.executable, str(ROOT / "render_site.py")],
            cwd=str(ROOT), capture_output=True, text=True, timeout=180,
        )
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output[-4000:]


def validate(data):
    """Basic shape checks so a bad save cannot wipe the site."""
    if not isinstance(data, dict):
        return "The content must be an object."
    for key in ("site", "events", "venues", "kinds", "badges", "pages", "users"):
        if key not in data:
            return "Missing '%s'." % key
    if not isinstance(data["events"], list):
        return "'events' must be a list."
    seen = set()
    for i, event in enumerate(data["events"]):
        if not isinstance(event, dict):
            return "Event %d is not an object." % (i + 1)
        slug = event.get("slug", "")
        if not SLUG.match(slug or ""):
            return "Event %d has an invalid slug: %r (lowercase letters, numbers, hyphens)." % (i + 1, slug)
        if slug in seen:
            return "Two events share the slug %r." % slug
        seen.add(slug)
        if not str(event.get("title", "")).strip():
            return "Event %r has no title." % slug
        for key in ("start", "end"):
            try:
                datetime.fromisoformat(event.get(key, ""))
            except (TypeError, ValueError):
                return "Event %r has an invalid %s date." % (slug, key)
    admins = [u for u in data["users"] if u.get("role") == "admin" and u.get("active", True)]
    if not admins:
        return "At least one active admin user is required."
    return None


def write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.replace(tmp, path)


def backup():
    if not CONTENT.exists():
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (BACKUPS / ("content-%s.json" % stamp)).write_bytes(CONTENT.read_bytes())
    for old in sorted(BACKUPS.glob("content-*.json"))[:-20]:
        old.unlink()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # The desk should always see fresh pages after a publish.
        if self.path.split("?")[0].endswith((".html", ".json", ".js", ".css")) or self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            self._json(403, {"ok": False, "error": "Only local requests are accepted."})
            return False
        if self.command != "GET" and self.headers.get("X-MDV-Desk") != "1":
            self._json(403, {"ok": False, "error": "Missing X-MDV-Desk header."})
            return False
        return True

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Request body is empty or larger than 8 MB.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # ---- routes
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            if self._allowed():
                self._json(200, {"ok": True, "publishing": True})
            return
        if path == "/api/content":
            if self._allowed():
                self._json(200, json.loads(CONTENT.read_text(encoding="utf-8")))
            return
        if path.startswith("/data/"):
            self.send_error(404)  # users and backups are not served as files
            return
        super().do_GET()

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/content":
            return self.send_error(404)
        if not self._allowed():
            return
        try:
            data = self._body()
        except (ValueError, json.JSONDecodeError) as error:
            return self._json(400, {"ok": False, "error": str(error)})
        problem = validate(data)
        if problem:
            return self._json(400, {"ok": False, "error": problem})
        data["updated"] = datetime.now().astimezone().isoformat(timespec="seconds")
        backup()
        write_atomic(CONTENT, json.dumps(data, ensure_ascii=False, indent=2))
        ok, output = build()
        self._json(200 if ok else 500, {"ok": ok, "output": output, "updated": data["updated"]})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/upload":
            return self.send_error(404)
        if not self._allowed():
            return
        try:
            data = self._body()
            slug = data.get("slug", "")
            if not SLUG.match(slug):
                raise ValueError("Invalid slug.")
            raw = base64.b64decode(data.get("data", ""), validate=True)
            from PIL import Image  # Pillow is already needed by the build
            image = Image.open(io.BytesIO(raw))
            image.verify()
            image = Image.open(io.BytesIO(raw)).convert("RGB")
            if image.width < 800:
                raise ValueError("Use a photo at least 800 pixels wide.")
            image.thumbnail((2400, 2400))
            image.save(ROOT / "images" / ("%s.jpg" % slug), "JPEG", quality=86)
        except Exception as error:  # noqa: BLE001 - report any decode or image error to the desk
            return self._json(400, {"ok": False, "error": "Upload failed: %s" % error})
        ok, output = build()
        self._json(200 if ok else 500, {"ok": ok, "output": output})


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not CONTENT.exists():
        print("No data/content.json yet: building once to create it.")
        build()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("MDV on http://127.0.0.1:%d  (desk: /portal.html, Ctrl+C to stop)" % args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
