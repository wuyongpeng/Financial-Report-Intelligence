#!/usr/bin/env python3
"""Fetch SZSE announcement list (Node fetch/curl often get empty reply / hang-up)."""
from __future__ import annotations
import json, ssl, sys, urllib.request

def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        body = json.loads(sys.argv[1])
    else:
        raw = sys.stdin.read()
        body = json.loads(raw) if raw.strip() else {}
    req = urllib.request.Request(
        "https://www.szse.cn/api/disc/announcement/annList",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.szse.cn/disclosure/listed/notice/index.html",
            "Origin": "https://www.szse.cn",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Connection": "close",
        },
        method="POST",
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=18) as resp:
            sys.stdout.write(resp.read().decode("utf-8", errors="replace"))
        return 0
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(str(exc))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
