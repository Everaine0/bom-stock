"""立创 EDA 导出的 BOM 解析（.xlsx / .csv）。"""
import csv
import io
import re

import openpyxl

HEADER_CANDIDATES = {
    "name": ["name", "元件名称", "名称", "元件"],
    "designator": ["designator", "位号", "编号", "reference", "refdes"],
    "footprint": ["footprint", "封装", "焊盘", "package"],
    "quantity": ["quantity", "数量", "qty", "用量", "个数"],
}


def _find_header(headers):
    idx = {}
    lows = [str(h).strip().lower() if h is not None else "" for h in headers]
    for key, cands in HEADER_CANDIDATES.items():
        for i, h in enumerate(lows):
            if any(c in h for c in cands):
                idx[key] = i
                break
    return idx


def _rows_from_2d(rows):
    if not rows:
        return []
    hi = 0
    for i, r in enumerate(rows):
        if r and any(str(c) and ("name" in str(c).lower() or "名称" in str(c)) for c in r[:3]):
            hi = i
            break
    idx = _find_header(rows[hi])
    if "name" not in idx:
        return []

    out = []
    for r in rows[hi + 1:]:
        if not r:
            continue

        def _g(k):
            j = idx.get(k)
            if j is None or j >= len(r):
                return ""
            v = r[j]
            return str(v).strip() if v is not None else ""

        name = _g("name")
        if not name:
            continue
        qty_raw = _g("quantity")
        try:
            qty = int(float(qty_raw))
        except Exception:
            qty = 1
        out.append({
            "name": name,
            "designator": _g("designator"),
            "footprint": _g("footprint"),
            "qty": max(1, qty),
        })
    return out


def parse_xlsx(data: bytes):
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    return _rows_from_2d(rows)


def parse_csv(data: bytes):
    text = None
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb2312"):
        try:
            text = data.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        text = data.decode("utf-8", "replace")
    rows = list(csv.reader(io.StringIO(text)))
    return _rows_from_2d(rows)
