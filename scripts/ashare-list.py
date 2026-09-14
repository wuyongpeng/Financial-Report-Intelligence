#!/usr/bin/env python3
"""Fetch A-share code/name list via urllib (Node fetch often fails on exchange gateways)."""
from __future__ import annotations
import json, ssl, sys, urllib.request

UA = "FinanceReportIntelligence/1.0 (+ashare-universe-refresh)"
CTX = ssl.create_default_context()

def get(url: str, referer: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": referer, "Connection": "close"})
    with urllib.request.urlopen(req, context=CTX, timeout=45) as resp:
        return resp.read()

def fetch_sse() -> list[dict]:
    out, seen = [], set()
    for stock_type in ("1", "8"):
        url = (
            "https://query.sse.com.cn/security/stock/getStockListData2.do"
            f"?pageHelp.pageSize=5000&pageHelp.pageNo=1&stockType={stock_type}"
        )
        raw = json.loads(get(url, "https://www.sse.com.cn/"))
        for row in (raw.get("pageHelp") or {}).get("data") or []:
            code = (row.get("SECURITY_CODE_A") or row.get("SECURITY_CODE") or "").strip()
            name = row.get("SECURITY_ABBR_A") or row.get("COMPANY_ABBR") or row.get("SECURITY_ABBR") or ""
            if code and code not in seen:
                seen.add(code)
                out.append({"code": code, "name": name, "exchange": "SSE"})
    return out

def fetch_eastmoney() -> list[dict]:
    """沪深京 A 股列表（分页）。"""
    out, seen = [], set()
    # m:1 沪市；m:0 深市；t:23 科创板；t:81 创业板等 — 用宽 fs
    boards = [
        ("m:1+t:2,m:1+t:23", "SSE"),   # 沪主板 + 科创
        ("m:0+t:6,m:0+t:80", "SZSE"),  # 深主板 + 创业板
        ("m:0+t:13", "BSE"),           # 北交所（字段可能变动，失败则跳过）
    ]
    for fs, exchange in boards:
        page = 1
        while page <= 100:
            url = (
                "https://82.push2.eastmoney.com/api/qt/clist/get"
                f"?pn={page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12"
                f"&fs={fs}&fields=f12,f14"
            )
            try:
                raw = json.loads(get(url, "https://quote.eastmoney.com/"))
            except Exception:
                break
            diff = ((raw.get("data") or {}).get("diff")) or []
            if not diff:
                break
            for row in diff:
                code = str(row.get("f12") or "").zfill(6)
                name = str(row.get("f14") or "").strip()
                if code.isdigit() and len(code) == 6 and code not in seen and name:
                    seen.add(code)
                    out.append({"code": code, "name": name, "exchange": exchange})
            total = int((raw.get("data") or {}).get("total") or 0)
            if page * 100 >= total:
                break
            page += 1
    return out

def main() -> int:
    notes, rows = [], []
    seen = set()
    for label, fn in (("sse", fetch_sse), ("eastmoney", fetch_eastmoney)):
        try:
            part = fn()
            notes.append(f"{label} {len(part)}")
            for r in part:
                if r["code"] not in seen:
                    seen.add(r["code"])
                    rows.append(r)
        except Exception as exc:  # noqa: BLE001
            notes.append(f"{label} fail: {exc}")
    sys.stdout.write(json.dumps({"notes": notes, "rows": rows}, ensure_ascii=False))
    return 0 if rows else 1

if __name__ == "__main__":
    raise SystemExit(main())
