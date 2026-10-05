#!/usr/bin/env python3
"""Serve a directory with CORS enabled, for testing a locally built cafes.db.

Usage: python3 tools/serve_cors.py 8001 /path/to/jeju-cafe-data/build
"""
import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    directory = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(CORSRequestHandler, directory=directory)
    print(f"Serving {directory} with CORS on http://localhost:{port}")
    ThreadingHTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
