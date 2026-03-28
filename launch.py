#!/usr/bin/env python3
from __future__ import annotations

import threading
import time
import webbrowser

import server

PORT = 8743


def open_browser() -> None:
    time.sleep(0.5)
    webbrowser.open(f"http://127.0.0.1:{PORT}")


if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()
    raise SystemExit(server.main(["--host", "127.0.0.1", "--port", str(PORT)]))
