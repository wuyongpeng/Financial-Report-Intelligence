#!/usr/bin/env python3
"""Fetch A-share code/name list via urllib (Node fetch often fails on exchange gateways).

stdout: JSON {"notes":[...],"rows":[...]}  — clean data for the refresh pipeline
stderr: progress / warnings                        — for cron and humans

Row shape:
  code, name, short_name, exchange, board, list_date
"""
from __future__ import annotations

import json
import logging
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; FinanceReportIntelligence/1.0; +ashare-universe-refresh)"
CTX = ssl.create_default_context()

# Eastmoney push hosts rotate; some close idle connections.
EM_HOSTS = (
    "48.push2.eastmoney.com",
    "82.push2.eastmoney.com",
    "79.push2.eastmoney.com",
    "push2.eastmoney.com",
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("ashare-list")


def get(url: str, referer: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Referer": referer,
            "Accept": "*/*",
            "Connection": "close",
        },
    )
    with urllib.request.urlopen(req, context=CTX, timeout=45) as resp:
        return resp.read()


def board_of(code: str) -> str:
    """Board from official code prefixes (user rules + known edges)."""
    if code.startswith(("688", "689")):
        return "科创板"
    if code.startswith("60"):
        return "主板"
    if code.startswith("00"):
        return "主板"
    if code.startswith("30"):
        return "创业板"
    if code.startswith(("8", "4", "92")):
        return "北交所"
    return ""


def short_name_of(name: str) -> str:
    n = re.sub(r"[\s\u3000]+", "", (name or "").strip())
    return re.sub(r"[AaＡａBbＢｂHhＨｈ]$", "", n)


def fmt_list_date(value) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if not s or s in ("-", "None", "null"):
        return ""
    s = s.split(" ")[0].replace("/", "-")
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    return ""


def enrich_row(row: dict) -> dict:
    code = str(row.get("code") or "").zfill(6)
    name = re.sub(r"[\s\u3000]+", "", str(row.get("name") or "").strip())
    return {
        "code": code,
        "name": name,
        "short_name": short_name_of(name),
        "exchange": row.get("exchange") or "",
        "board": board_of(code),
        "list_date": fmt_list_date(row.get("list_date")),
    }


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
            name = (
                row.get("SECURITY_ABBR_A")
                or row.get("COMPANY_ABBR")
                or row.get("SECURITY_ABBR")
                or ""
            )
            list_date = row.get("LISTING_DATE") or ""
            if code and code not in seen:
                seen.add(code)
                out.append(
                    {"code": code, "name": name, "exchange": "SSE", "list_date": list_date}
                )
    return out


def _em_clist(fs: str, exchange: str, host: str) -> list[dict]:
    out, seen = [], set()
    page = 1
    fs_q = urllib.parse.quote(fs, safe="+:!")
    while page <= 100:
        url = (
            f"https://{host}/api/qt/clist/get"
            f"?pn={page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f12"
            f"&fs={fs_q}&fields=f12,f14,f26"
        )
        raw = json.loads(get(url, "https://quote.eastmoney.com/center/gridlist.html"))
        data = raw.get("data") or {}
        diff = data.get("diff") or []
        if not diff:
            break
        for row in diff:
            code = str(row.get("f12") or "").zfill(6)
            name = str(row.get("f14") or "").strip()
            list_date = row.get("f26")
            if code.isdigit() and len(code) == 6 and code not in seen and name:
                seen.add(code)
                out.append(
                    {
                        "code": code,
                        "name": name,
                        "exchange": exchange,
                        "list_date": list_date,
                    }
                )
        total = int(data.get("total") or 0)
        if page * 100 >= total:
            break
        page += 1
        time.sleep(0.05)
    return out


def fetch_szse() -> list[dict]:
    """深交所官网分页名录（每页约 20 条；上限须覆盖 ~2900+ 家）。"""
    out, seen = [], set()
    page = 1
    max_pages = 200
    while page <= max_pages:
        url = (
            "https://www.szse.cn/api/report/ShowReport/data"
            f"?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO={page}"
        )
        try:
            raw = json.loads(get(url, "https://www.szse.cn/"))
        except Exception as exc:  # noqa: BLE001
            log.warning("szse page %s fail: %s", page, exc)
            break
        block = raw[0] if isinstance(raw, list) and raw else None
        rows = (block or {}).get("data") or []
        if not rows:
            break
        for row in rows:
            code = str(row.get("agdm") or row.get("A股代码") or row.get("zqdm") or "").zfill(6)
            name = str(row.get("agjc") or row.get("A股简称") or row.get("zqjc") or "").strip()
            if "<" in name:
                name = re.sub(r"<[^>]+>", "", name).strip()
            # 上市日期字段：agssrq（实测）
            list_date = row.get("agssrq") or row.get("ssrq") or ""
            if code.isdigit() and len(code) == 6 and code not in seen and name:
                seen.add(code)
                out.append(
                    {
                        "code": code,
                        "name": name,
                        "exchange": "SZSE",
                        "list_date": list_date,
                    }
                )
        meta = (block or {}).get("metadata") or {}
        total = int(meta.get("recordcount") or meta.get("recordCount") or 0)
        pagecount = int(meta.get("pagecount") or meta.get("pageCount") or 0)
        if (total and page * 20 >= total) or (pagecount and page >= pagecount):
            break
        page += 1
        time.sleep(0.08)
    return out


def fetch_eastmoney_hs() -> list[dict]:
    """沪深 A 股（不含北交所）。"""
    out, seen = [], set()
    boards = [
        ("m:1+t:2,m:1+t:23", "SSE"),
        ("m:0+t:6,m:0+t:80", "SZSE"),
    ]
    last_err: Exception | None = None
    for fs, exchange in boards:
        part: list[dict] = []
        for host in EM_HOSTS:
            try:
                part = _em_clist(fs, exchange, host)
                if part:
                    break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                continue
        if not part and last_err:
            raise last_err
        for r in part:
            if r["code"] not in seen:
                seen.add(r["code"])
                out.append(r)
    return out


def fetch_bse_sina() -> list[dict]:
    """北交所上市证券（新浪 hs_bjs；东财旧 t:13 已失效）。"""
    out, seen = [], set()
    for page in range(1, 80):
        url = (
            "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            "Market_Center.getHQNodeData"
            f"?page={page}&num=80&sort=symbol&asc=1&node=hs_bjs&symbol=&_s_r_a=page"
        )
        raw = get(url, "https://finance.sina.com.cn/").decode()
        if not raw or raw.strip() in ("[]", "null"):
            break
        part = json.loads(raw)
        if not part:
            break
        for row in part:
            code = str(row.get("code") or "").zfill(6)
            name = str(row.get("name") or "").strip()
            if code.isdigit() and len(code) == 6 and code not in seen and name:
                seen.add(code)
                out.append(
                    {"code": code, "name": name, "exchange": "BSE", "list_date": ""}
                )
        time.sleep(0.12)
    return out


def fetch_bse_eastmoney() -> list[dict]:
    """北交所备用：东财 fs=m:0+t:81。"""
    last_err: Exception | None = None
    for host in EM_HOSTS:
        try:
            part = _em_clist("m:0+t:81", "BSE", host)
            return [r for r in part if r["code"].startswith(("4", "8", "92"))]
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            continue
    if last_err:
        raise last_err
    return []


def validate(rows: list[dict], notes: list[str]) -> bool:
    """合理性校验：拦截明显不完整的快照。"""
    total = len(rows)
    by_ex: dict[str, int] = {}
    for r in rows:
        by_ex[r["exchange"]] = by_ex.get(r["exchange"], 0) + 1

    ok = True
    if total < 5000:
        notes.append(f"WARN: total={total} below expected ~5200+")
        ok = False
    if by_ex.get("SSE", 0) < 1900:
        notes.append(f"WARN: SSE={by_ex.get('SSE', 0)} below ~2000")
        ok = False
    if by_ex.get("SZSE", 0) < 2800:
        notes.append(f"WARN: SZSE={by_ex.get('SZSE', 0)} below ~2900")
        ok = False
    if by_ex.get("BSE", 0) < 250:
        notes.append(f"WARN: BSE={by_ex.get('BSE', 0)} below ~280")
        ok = False
    if ok:
        notes.append(f"VALIDATE_OK: total={total} {by_ex}")
    else:
        notes.append(f"VALIDATE_FAIL: total={total} {by_ex}")
        log.warning("validate failed: total=%s %s", total, by_ex)
    return ok


def main() -> int:
    notes: list[str] = []
    rows: list[dict] = []
    seen: set[str] = set()

    def absorb(label: str, fn) -> None:
        try:
            part = fn()
            notes.append(f"{label} {len(part)}")
            log.info("%s: %d rows", label, len(part))
            for r in part:
                if r["code"] not in seen:
                    seen.add(r["code"])
                    rows.append(r)
                else:
                    # Fill list_date from a later source if earlier left it empty
                    for existing in rows:
                        if existing["code"] == r["code"]:
                            if not fmt_list_date(existing.get("list_date")) and fmt_list_date(
                                r.get("list_date")
                            ):
                                existing["list_date"] = r["list_date"]
                            break
        except Exception as exc:  # noqa: BLE001
            log.warning("%s fail: %s", label, exc)
            notes.append(f"{label} fail: {exc}")

    absorb("sse", fetch_sse)
    absorb("szse", fetch_szse)
    absorb("eastmoney-hs", fetch_eastmoney_hs)
    absorb("bse-sina", fetch_bse_sina)
    if not any(r["exchange"] == "BSE" for r in rows):
        absorb("bse-eastmoney", fetch_bse_eastmoney)

    bse_n = sum(1 for r in rows if r["exchange"] == "BSE")
    notes.append(f"bse_total {bse_n}")
    if bse_n == 0:
        notes.append("bse_missing: recognition universe has no BSE rows")

    enriched = [enrich_row(r) for r in rows]
    dated = sum(1 for r in enriched if r["list_date"])
    notes.append(f"list_date_filled {dated}/{len(enriched)}")
    log.info("list_date filled: %d/%d", dated, len(enriched))

    ok = validate(enriched, notes)
    sys.stdout.write(json.dumps({"notes": notes, "rows": enriched}, ensure_ascii=False))
    return 0 if (ok and enriched) else 1


if __name__ == "__main__":
    raise SystemExit(main())
