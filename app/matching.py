"""同类型元件匹配工具。

- 名称匹配不区分大小写、忽略空格 / Ω / µ 等符号差异
- 支持件值归一化：0.1uF == 100nF == 104 → 1e-07F；10kΩ == 10K → 10000Ω
- 用户别名（如 '104'）优先参与匹配
"""
import json
import re

NUM = r"[0-9]+(?:\.[0-9]+)?"


def norm(s: str) -> str:
    t = str(s or "").strip().lower()
    t = t.replace(" ", "").replace("\u3000", "")
    t = t.replace("µ", "u").replace("μ", "u")
    for ch in ("Ω", "Ω", "ω", "欧", "欧姆", "ohm", "欧姆"):
        t = t.replace(ch, "")
    return t


def _num(s):
    try:
        return float(s)
    except Exception:
        return None


def canonical_candidates(name: str) -> set:
    """把一个名称转成所有可能的‘规范值’候选集合。"""
    out = set()
    n = norm(name)
    if not n:
        return out

    # 电容：数值 + (p|n|u|m)f，如 1uF / 100nF / 10pF
    m = re.fullmatch(rf"({NUM})(p|n|u|m)f", n)
    if m:
        v = _num(m.group(1))
        if v is not None:
            mult = {"p": 1e-12, "n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
            out.add(f"{v * mult:.6g}F")

    # 纯数字：按 EIA 编码解释（电容三位/四位码 -> pF；电阻三位码 -> Ω）
    if re.fullmatch(r"\d{3,4}", n):
        m = re.fullmatch(r"(\d{2})(\d)", n)
        if m:
            d, u = int(m.group(1)), int(m.group(2))
            out.add(f"{d * (10 ** u) * 1e-12:.6g}F")
        m = re.fullmatch(r"(\d{3})(\d)", n)
        if m:
            d, u = int(m.group(1)), int(m.group(2))
            out.add(f"{d * (10 ** u) * 1e-12:.6g}F")
        m = re.fullmatch(r"(\d{2})(\d)", n)
        if m:
            d, u = int(m.group(1)), int(m.group(2))
            out.add(f"{d * (10 ** u):.6g}Ω")
        out.add(f"{_num(n):.6g}Ω")

    # 电阻：数值 + (k|m|meg|r)？，如 10k / 4.7k / 150k / 33k / 0
    m = re.fullmatch(rf"({NUM})(k|m|meg|r)?", n)
    if m:
        v = _num(m.group(1))
        if v is not None:
            pre = m.group(2)
            if pre == "r":
                out.add(f"{v:.6g}Ω")
            elif pre == "k":
                out.add(f"{v * 1e3:.6g}Ω")
            elif pre == "m":
                out.add(f"{v * 1e-3:.6g}Ω")
            elif pre == "meg":
                out.add(f"{v * 1e6:.6g}Ω")
            else:
                out.add(f"{v:.6g}Ω")

    # 电阻 4R7 写法
    m = re.fullmatch(r"(\d+)r(\d+)", n)
    if m:
        try:
            out.add(f"{int(m.group(1)) + int(m.group(2)) / (10 ** len(m.group(2))):.6g}Ω")
        except Exception:
            pass

    # 电感：数值 + (n|u|m)h，如 10uH / 2.2uH / 1.5uH
    m = re.fullmatch(rf"({NUM})(n|u|m)h", n)
    if m:
        v = _num(m.group(1))
        if v is not None:
            mult = {"n": 1e-9, "u": 1e-6, "m": 1e-3}[m.group(2)]
            out.add(f"{v * mult:.6g}H")

    return out


def match_row(bom_name: str, bom_foot: str, comp) -> str | None:
    """把一条 BOM 行的名称/封装与一个元件比较，返回匹配方式或 None。

    comp 为 sqlite Row / dict，需含 name、footprint、aliases 字段。
    匹配优先级：精确名称 > 用户别名 > 规范值。
    封装均非空时要求一致（忽略大小写）。
    """
    bn = norm(bom_name)
    bf = norm(bom_foot)
    cn = norm(comp["name"])
    cf = norm(comp.get("footprint") or "")

    if bf and cf and bf != cf:
        return None

    if cn and cn == bn:
        return "exact"

    try:
        aliases = json.loads(comp.get("aliases") or "[]")
    except Exception:
        aliases = []
    for a in aliases:
        if norm(a) == bn:
            return "alias"

    bcan = canonical_candidates(bn)
    if bcan:
        ccan = canonical_candidates(comp["name"])
        if ccan & bcan:
            return "canonical"

    return None


# 位号前缀 -> 类别（从 BOM 建元件时自动分类）
_DESIGNATOR_CAT = [
    ("LED", "LED"),
    ("SW", "开关"),
    ("CN", "连接器"),
    ("BT", "电池"),
    ("TP", "测试点"),
    ("R", "电阻"),
    ("C", "电容"),
    ("L", "电感"),
    ("U", "IC"),
    ("D", "二极管"),
    ("Q", "晶体管"),
    ("J", "连接器"),
    ("P", "连接器"),
    ("X", "晶振"),
    ("Y", "晶振"),
    ("CR", "晶振"),
    ("F", "保险丝"),
    ("T", "变压器"),
    ("B", "电池"),
    ("K", "开关"),
    ("M", "电机"),
    ("E", "其他"),
]


def infer_category(name: str, designator: str = "") -> str:
    """根据位号前缀、其次按名称单位推断元件类别。"""
    d = norm(designator)
    if d:
        # 多字母前缀优先
        for pref, cat in _DESIGNATOR_CAT:
            if len(pref) > 1 and d.startswith(pref.lower()):
                return cat
        # 单字母取第一个字母
        ch = d[0]
        if ch.isalpha():
            for pref, cat in _DESIGNATOR_CAT:
                if len(pref) == 1 and pref.lower() == ch:
                    return cat
    # 按名称规范值推断：Ω->电阻 / F->电容 / H->电感
    cans = canonical_candidates(name)
    for c in cans:
        if c.endswith("Ω"):
            return "电阻"
        if c.endswith("F"):
            return "电容"
        if c.endswith("H"):
            return "电感"
    return "其他"
