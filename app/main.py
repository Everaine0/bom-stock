"""元件仓：元器件库存 & 立创 BOM 对比工具（FastAPI 后端）。"""
import json
import math
import os
import time
from pathlib import Path
from typing import List, Optional

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import bom as bom_mod
from . import db
from . import matching

app = FastAPI(title="元件仓")
db.init_db()

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


# ---------------------------------------------------------------- models
class ComponentIn(BaseModel):
    name: str
    footprint: str = ""
    category: str = "其他"
    aliases: List[str] = []
    unit_price: float = 0
    note: str = ""


class AdjustIn(BaseModel):
    delta: int
    note: str = ""


class ProjectIn(BaseModel):
    name: str
    board_count: int = 1
    loss_ratio: Optional[float] = None
    needs_pcb: bool = False
    pcb_cost: float = 0
    needs_stencil: bool = False
    stencil_cost: float = 0
    other_cost: float = 0
    note: str = ""


class BindIn(BaseModel):
    component_id: int = 0  # 0 表示解除绑定


class PurchaseItem(BaseModel):
    item_id: int
    qty: int
    unit_price: float = 0


class PurchaseIn(BaseModel):
    items: List[PurchaseItem] = []


class RevenueIn(BaseModel):
    revenue: Optional[float] = None


class PurchaseExtraIn(BaseModel):
    kind: str = "pcb"  # 'pcb' | 'stencil'
    qty: int = 1
    cost: float = 0
    note: str = ""


class SettingsIn(BaseModel):
    default_loss_ratio: float = 5


# ---------------------------------------------------------------- helpers
def row2d(r):
    return dict(r) if r is not None else None


def _find_dup(conn, name, footprint, exclude=None):
    """按归一化名称+封装查找重复（忽略大小写与 Ω/µ 等符号差异）。"""
    nn, nf = matching.norm(name), matching.norm(footprint)
    rows = conn.execute("SELECT id, name, footprint FROM components").fetchall()
    for c in rows:
        if exclude is not None and c["id"] == exclude:
            continue
        if matching.norm(c["name"]) == nn and matching.norm(c["footprint"]) == nf:
            return c
    return None


def get_loss_ratio(conn, p):
    if hasattr(p, "keys"):
        p = dict(p)
    if p.get("loss_ratio") is not None:
        return p["loss_ratio"]
    try:
        return float(db.get_setting("default_loss_ratio", "5"))
    except Exception:
        return 5.0


def compute_needed(per_board, board_count, loss):
    return max(0, math.ceil(per_board * board_count * (1 + loss / 100.0)))


def purchase_cost(conn, pid):
    r = conn.execute(
        "SELECT COALESCE(SUM(cost),0) s FROM project_purchases WHERE project_id=?", (pid,)
    ).fetchone()
    return r["s"] or 0


def extra_cost(conn, pid, other_cost=0):
    return purchase_cost(conn, pid) + (other_cost or 0)


def cost_total_for(conn, pid, other_cost=0):
    bought = conn.execute(
        "SELECT COALESCE(SUM(bought_cost),0) s FROM project_items WHERE project_id=?", (pid,)
    ).fetchone()["s"] or 0
    return round(bought + extra_cost(conn, pid, other_cost), 2)


def series_root(conn, pid):
    cur = pid
    while True:
        r = conn.execute("SELECT parent_project_id FROM projects WHERE id=?", (cur,)).fetchone()
        if not r or not r["parent_project_id"]:
            return cur
        cur = r["parent_project_id"]


def project_detail(conn, pid):
    p = row2d(conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone())
    if not p:
        return None
    loss = get_loss_ratio(conn, p)
    items_raw = conn.execute(
        "SELECT * FROM project_items WHERE project_id=? ORDER BY id", (pid,)
    ).fetchall()
    items, shortage_total, bought_cost = [], 0, 0.0
    for r in items_raw:
        it = dict(r)
        comp = None
        if it["component_id"]:
            comp = row2d(
                conn.execute("SELECT * FROM components WHERE id=?", (it["component_id"],)).fetchone()
            )
        if it["total_needed"]:
            needed = it["total_needed"]
        else:
            needed = compute_needed(it["qty_per_board"], p["board_count"], loss)
        shortage = max(0, needed - it["occupied"] - it["bought"])
        shortage_total += shortage
        bought_cost += it["bought_cost"] or 0
        items.append({
            "id": it["id"],
            "component_id": it["component_id"],
            "name": it["name"],
            "footprint": it["footprint"],
            "designator": it["designator"],
            "qty_per_board": it["qty_per_board"],
            "needed": needed,
            "occupied": it["occupied"],
            "bought": it["bought"],
            "bought_cost": it["bought_cost"] or 0,
            "shortage": shortage,
            "component": {"id": comp["id"], "qty": comp["qty"]} if comp else None,
        })
    purchases = [dict(r) for r in conn.execute(
        "SELECT * FROM project_purchases WHERE project_id=?", (pid,)
    ).fetchall()]
    have = {x["kind"] for x in purchases}
    pending_purchases = []
    if p.get("needs_pcb") and "pcb" not in have:
        pending_purchases.append({"kind": "pcb", "name": "PCB打板", "qty": max(1, p["board_count"])})
    if p.get("needs_stencil") and "stencil" not in have:
        pending_purchases.append({"kind": "stencil", "name": "钢网", "qty": 1})
    cost_extra = extra_cost(conn, pid, p.get("other_cost"))
    root = series_root(conn, pid)
    members_raw = conn.execute(
        "SELECT * FROM projects WHERE id=? OR parent_project_id=? ORDER BY created_at, id", (root, root)
    ).fetchall()
    series = []
    for m in members_raw:
        m = dict(m)
        series.append({
            "id": m["id"],
            "name": m["name"],
            "status": m["status"],
            "board_count": m["board_count"],
            "cost_total": cost_total_for(conn, m["id"], m.get("other_cost")),
            "revenue": m["revenue"],
        })
    series_total_cost = round(sum(s["cost_total"] for s in series), 2)
    series_total_revenue = round(sum((s["revenue"] or 0) for s in series), 2)
    return {
        "project": {**p, "loss_ratio_effective": loss},
        "items": items,
        "purchases": purchases,
        "pending_purchases": pending_purchases,
        "series": {
            "root": root,
            "members": series,
            "total_cost": series_total_cost,
            "total_revenue": series_total_revenue,
            "total_profit": round(series_total_revenue - series_total_cost, 2),
        },
        "cost_bought": round(bought_cost, 2),
        "cost_extra": round(cost_extra, 2),
        "cost_total": round(bought_cost + cost_extra, 2),
        "shortage_total": shortage_total,
    }


def project_with_cost(conn, p):
    d = row2d(p)
    d["cost_total"] = cost_total_for(conn, p["id"], d.get("other_cost"))
    d["item_count"] = conn.execute(
        "SELECT COUNT(*) n FROM project_items WHERE project_id=?", (p["id"],)
    ).fetchone()["n"]
    d["series_count"] = conn.execute(
        "SELECT COUNT(*) n FROM projects WHERE parent_project_id=?", (p["id"],)
    ).fetchone()["n"]
    return d


# ---------------------------------------------------------------- health
@app.get("/api/health")
def api_health():
    return {"status": "ok", "db": db.DB_PATH}


# ---------------------------------------------------------------- components
@app.get("/api/components")
def api_components():
    with db.conn_ctx() as conn:
        rows = conn.execute("SELECT * FROM components ORDER BY name").fetchall()
        return [row2d(r) for r in rows]


@app.post("/api/components", status_code=201)
def api_component_create(data: ComponentIn):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    with db.conn_ctx() as conn:
        dup = _find_dup(conn, name, data.footprint)
        if dup:
            raise HTTPException(409, "已存在相同名称+封装的元件（注意不区分大小写）")
        aliases = json.dumps([a.strip() for a in data.aliases if a.strip()], ensure_ascii=False)
        cur = conn.execute(
            "INSERT INTO components(name,footprint,category,aliases,qty,unit_price,note) "
            "VALUES(?,?,?,?,0,?,?)",
            (name, data.footprint.strip(), data.category, aliases, data.unit_price, data.note),
        )
        return {"id": cur.lastrowid}


@app.put("/api/components/{cid}")
def api_component_update(cid: int, data: ComponentIn):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    with db.conn_ctx() as conn:
        if not conn.execute("SELECT id FROM components WHERE id=?", (cid,)).fetchone():
            raise HTTPException(404, "元件不存在")
        dup = _find_dup(conn, name, data.footprint, exclude=cid)
        if dup:
            raise HTTPException(409, "存在相同名称+封装的其它元件")
        aliases = json.dumps([a.strip() for a in data.aliases if a.strip()], ensure_ascii=False)
        conn.execute(
            "UPDATE components SET name=?, footprint=?, category=?, aliases=?, unit_price=?, note=? WHERE id=?",
            (name, data.footprint.strip(), data.category, aliases, data.unit_price, data.note, cid),
        )
        return {"ok": True}


@app.delete("/api/components/{cid}")
def api_component_delete(cid: int):
    with db.conn_ctx() as conn:
        if not conn.execute("SELECT id FROM components WHERE id=?", (cid,)).fetchone():
            raise HTTPException(404, "元件不存在")
        refs = conn.execute(
            "SELECT COUNT(*) n FROM project_items WHERE component_id=?", (cid,)
        ).fetchone()["n"]
        # 删除元件并自动解除它在所有项目里的绑定（项目内仍保留名称/封装快照；
        # 历史出入库流水保留，元件名显示为“已删除”）
        conn.execute("UPDATE project_items SET component_id=NULL WHERE component_id=?", (cid,))
        conn.execute("DELETE FROM components WHERE id=?", (cid,))
        return {"ok": True, "unbound": refs}


@app.post("/api/components/{cid}/adjust")
def api_component_adjust(cid: int, data: AdjustIn):
    if data.delta == 0:
        raise HTTPException(400, "数量不能为 0")
    with db.conn_ctx() as conn:
        c = conn.execute("SELECT * FROM components WHERE id=?", (cid,)).fetchone()
        if not c:
            raise HTTPException(404, "元件不存在")
        new = c["qty"] + data.delta
        if new < 0:
            raise HTTPException(400, f"库存不足，当前仅 {c['qty']}")
        conn.execute("UPDATE components SET qty=? WHERE id=?", (new, cid))
        conn.execute(
            "INSERT INTO stock_logs(component_id,delta,type,note,created_at) VALUES(?,?,?,?,?)",
            (cid, data.delta, "in" if data.delta > 0 else "out", data.note, db.now()),
        )
        return {"qty": new}


# ---------------------------------------------------------------- projects
@app.get("/api/projects")
def api_projects():
    with db.conn_ctx() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC, id DESC").fetchall()
        return [project_with_cost(conn, r) for r in rows]


@app.post("/api/projects", status_code=201)
def api_project_create(data: ProjectIn):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "项目名称不能为空")
    with db.conn_ctx() as conn:
        cur = conn.execute(
            "INSERT INTO projects(name,status,created_at,board_count,loss_ratio,"
            "needs_pcb,pcb_cost,needs_stencil,stencil_cost,other_cost,note) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (name, "draft", db.now(), max(1, data.board_count), data.loss_ratio,
             int(data.needs_pcb), data.pcb_cost, int(data.needs_stencil), data.stencil_cost,
             data.other_cost, data.note),
        )
        return {"id": cur.lastrowid}


@app.get("/api/projects/{pid}")
def api_project_get(pid: int):
    with db.conn_ctx() as conn:
        d = project_detail(conn, pid)
        if not d:
            raise HTTPException(404, "项目不存在")
        return d


@app.put("/api/projects/{pid}")
def api_project_update(pid: int, data: ProjectIn):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        board_count = p["board_count"]
        loss_ratio = p["loss_ratio"]
        if data.name.strip():
            conn.execute("UPDATE projects SET name=? WHERE id=?", (data.name.strip(), pid))
        # 草稿阶段允许改板数与损耗比（影响未确认的需求量）
        if p["status"] == "draft":
            board_count = max(1, data.board_count)
            loss_ratio = data.loss_ratio
        conn.execute(
            "UPDATE projects SET board_count=?, loss_ratio=?, needs_pcb=?, pcb_cost=?, "
            "needs_stencil=?, stencil_cost=?, other_cost=?, note=? WHERE id=?",
            (board_count, loss_ratio, int(data.needs_pcb), data.pcb_cost,
             int(data.needs_stencil), data.stencil_cost, data.other_cost, data.note, pid),
        )
        return project_detail(conn, pid)


@app.delete("/api/projects/{pid}")
def api_project_delete(pid: int):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "draft":
            raise HTTPException(400, "只有草稿项目可以删除")
        conn.execute("DELETE FROM project_purchases WHERE project_id=?", (pid,))
        conn.execute("DELETE FROM project_items WHERE project_id=?", (pid,))
        conn.execute("DELETE FROM projects WHERE id=?", (pid,))
        return {"ok": True}


@app.post("/api/projects/{pid}/bom")
async def api_project_bom(pid: int, file: UploadFile = File(...)):
    fn = (file.filename or "").lower()
    raw = await file.read()
    try:
        rows = bom_mod.parse_csv(raw) if fn.endswith(".csv") else bom_mod.parse_xlsx(raw)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"BOM 解析失败：{e}")
    if not rows:
        raise HTTPException(400, "未能识别出 BOM 数据（需要 Name/数量 等列）")
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        comps = [dict(c) for c in conn.execute("SELECT * FROM components").fetchall()]
        conn.execute("DELETE FROM project_items WHERE project_id=?", (pid,))
        matched = 0
        for r in rows:
            cid, how = None, None
            for c in comps:
                res = matching.match_row(r["name"], r["footprint"], c)
                if res:
                    cid, how = c["id"], res
                    break
            conn.execute(
                "INSERT INTO project_items(project_id,component_id,name,footprint,designator,qty_per_board) "
                "VALUES(?,?,?,?,?,?)",
                (pid, cid, r["name"], r["footprint"], r["designator"], r["qty"]),
            )
            if cid:
                matched += 1
        return {"matched": matched, "total": len(rows)}


@app.post("/api/projects/{pid}/items/{iid}/bind")
def api_item_bind(pid: int, iid: int, data: BindIn):
    with db.conn_ctx() as conn:
        it = conn.execute(
            "SELECT * FROM project_items WHERE id=? AND project_id=?", (iid, pid)
        ).fetchone()
        if not it:
            raise HTTPException(404, "BOM 条目不存在")
        if data.component_id <= 0:
            conn.execute("UPDATE project_items SET component_id=NULL WHERE id=?", (iid,))
        else:
            if not conn.execute("SELECT id FROM components WHERE id=?", (data.component_id,)).fetchone():
                raise HTTPException(404, "元件不存在")
            conn.execute("UPDATE project_items SET component_id=? WHERE id=?", (data.component_id, iid))
        return {"ok": True}


@app.post("/api/projects/{pid}/items/{iid}/newcomponent", status_code=201)
def api_item_newcomponent(pid: int, iid: int):
    with db.conn_ctx() as conn:
        it = conn.execute(
            "SELECT * FROM project_items WHERE id=? AND project_id=?", (iid, pid)
        ).fetchone()
        if not it:
            raise HTTPException(404, "BOM 条目不存在")
        name = it["name"]
        foot = it["footprint"]
        cat = matching.infer_category(name, it["designator"])
        dup = conn.execute(
            "SELECT id FROM components WHERE lower(name)=? AND lower(footprint)=?",
            (matching.norm(name), matching.norm(foot)),
        ).fetchone()
        if dup:
            cid = dup["id"]
        else:
            cur = conn.execute(
                "INSERT INTO components(name,footprint,category,aliases,qty,unit_price,note) "
                "VALUES(?,?,?,?,0,0,'从BOM创建')",
                (name, foot, cat, "[]"),
            )
            cid = cur.lastrowid
        conn.execute("UPDATE project_items SET component_id=? WHERE id=?", (cid, iid))
        return {"component_id": cid, "category": cat}


@app.delete("/api/projects/{pid}/items/{iid}")
def api_item_delete(pid: int, iid: int):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "draft":
            raise HTTPException(400, "只有草稿项目可以删除 BOM 行")
        if not conn.execute("SELECT id FROM project_items WHERE id=? AND project_id=?", (iid, pid)).fetchone():
            raise HTTPException(404, "BOM 条目不存在")
        conn.execute("DELETE FROM project_items WHERE id=?", (iid,))
        return {"ok": True}


@app.post("/api/projects/{pid}/confirm")
def api_project_confirm(pid: int):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "draft":
            raise HTTPException(400, "只有草稿项目可以确认")
        its = conn.execute("SELECT * FROM project_items WHERE project_id=?", (pid,)).fetchall()
        for it in its:
            if it["component_id"] is None:
                raise HTTPException(400, f"存在未匹配元件：{it['name']}，请先在列表中绑定")
        loss = get_loss_ratio(conn, p)
        for it in its:
            need = compute_needed(it["qty_per_board"], p["board_count"], loss)
            c = conn.execute("SELECT * FROM components WHERE id=?", (it["component_id"],)).fetchone()
            take = min(c["qty"], need)
            conn.execute(
                "UPDATE components SET qty=? WHERE id=?",
                (c["qty"] - take, it["component_id"]),
            )
            conn.execute(
                "UPDATE project_items SET total_needed=?, occupied=? WHERE id=?",
                (need, take, it["id"]),
            )
            if take > 0:
                conn.execute(
                    "INSERT INTO stock_logs(component_id,delta,type,project_id,note,created_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (it["component_id"], -take, "occupy", pid, "项目占用", db.now()),
                )
        conn.execute("UPDATE projects SET status='in_progress' WHERE id=?", (pid,))
        return project_detail(conn, pid)


@app.post("/api/projects/{pid}/purchase")
def api_project_purchase(pid: int, data: PurchaseIn):
    if not data.items:
        raise HTTPException(400, "没有购买条目")
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] not in ("in_progress", "completed"):
            raise HTTPException(400, "当前状态不允许采购")
        for it in data.items:
            row = conn.execute(
                "SELECT * FROM project_items WHERE id=? AND project_id=?", (it.item_id, pid)
            ).fetchone()
            if not row:
                raise HTTPException(404, "BOM 条目不存在")
            if it.qty <= 0:
                raise HTTPException(400, "购买数量需要为正数")
            if row["component_id"] is None:
                raise HTTPException(400, "该条目未绑定元件，无法采购")
            cid = row["component_id"]
            # 自动补齐缺件：先给库存 +买数量，其中 min(买数,缺件) 部分转为本项目占用
            shortage = max(0, row["total_needed"] - row["occupied"])
            cover = min(it.qty, shortage)
            net = it.qty - cover
            conn.execute("UPDATE components SET qty = qty + ? WHERE id=?", (net, cid))
            if cover > 0:
                conn.execute(
                    "UPDATE project_items SET occupied=occupied+? WHERE id=?", (cover, row["id"])
                )
                conn.execute(
                    "INSERT INTO stock_logs(component_id,delta,type,project_id,note,created_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (cid, -cover, "occupy", pid, "采购自动补齐缺件", db.now()),
                )
            conn.execute(
                "UPDATE project_items SET bought=bought+?, bought_cost=bought_cost+? WHERE id=?",
                (it.qty, it.qty * it.unit_price, row["id"]),
            )
            conn.execute(
                "INSERT INTO stock_logs(component_id,delta,type,project_id,note,created_at) "
                "VALUES(?,?,?,?,?,?)",
                (cid, it.qty, "purchase", pid, "项目采购", db.now()),
            )
        return project_detail(conn, pid)


@app.post("/api/projects/{pid}/complete")
def api_project_complete(pid: int):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "in_progress":
            raise HTTPException(400, "仅进行中的项目可以完成")
        bad = 0
        for it in conn.execute("SELECT * FROM project_items WHERE project_id=?", (pid,)).fetchall():
            if it["component_id"] and max(0, it["total_needed"] - it["occupied"] - it["bought"]) > 0:
                bad += 1
        if bad:
            raise HTTPException(400, f"仍有 {bad} 种元件缺件未补齐，不能标记为已完成")
        conn.execute("UPDATE projects SET status='completed' WHERE id=?", (pid,))
        return project_detail(conn, pid)


@app.post("/api/projects/{pid}/close")
def api_project_close(pid: int):
    """关闭（仅进行中可用）= 退回元件并将项目彻底删除。"""
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "in_progress":
            raise HTTPException(400, "只有「进行中」的项目可以关闭（关闭会退回元件并删除项目）")
        its = conn.execute("SELECT * FROM project_items WHERE project_id=?", (pid,)).fetchall()
        for it in its:
            cid = it["component_id"]
            if not cid:
                continue
            ret = it["occupied"]
            if ret > 0:
                c = conn.execute("SELECT * FROM components WHERE id=?", (cid,)).fetchone()
                if c:
                    conn.execute(
                        "UPDATE components SET qty=? WHERE id=?",
                        (c["qty"] + ret, cid),
                    )
                    conn.execute(
                        "INSERT INTO stock_logs(component_id,delta,type,project_id,note,created_at) "
                        "VALUES(?,?,?,?,?,?)",
                        (cid, ret, "return", pid, "项目关闭退回", db.now()),
                    )
        conn.execute("DELETE FROM project_purchases WHERE project_id=?", (pid,))
        conn.execute("DELETE FROM project_items WHERE project_id=?", (pid,))
        conn.execute("DELETE FROM projects WHERE id=?", (pid,))
        return {"ok": True, "deleted": pid}


class CloneIn(BaseModel):
    board_count: int = 1


@app.post("/api/projects/{pid}/clone", status_code=201)
def api_project_clone(pid: int, data: CloneIn):
    """返单：以已完成项目为母项目，克隆出一个新的独立草稿项目。"""
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] != "completed":
            raise HTTPException(400, "只有已完成的项目可以返单")
        root = series_root(conn, pid)
        cnt = conn.execute(
            "SELECT COUNT(*) n FROM projects WHERE parent_project_id=?", (root,)
        ).fetchone()["n"]
        name = f"{p['name']} · 返单{cnt + 1}"
        cur = conn.execute(
            "INSERT INTO projects(name,status,created_at,board_count,loss_ratio,needs_pcb,"
            "pcb_cost,needs_stencil,stencil_cost,other_cost,note,parent_project_id) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (name, "draft", db.now(), max(1, data.board_count), p["loss_ratio"],
             p["needs_pcb"], 0, p["needs_stencil"], 0, p["other_cost"], p["note"], root),
        )
        npid = cur.lastrowid
        for it in conn.execute("SELECT * FROM project_items WHERE project_id=?", (pid,)).fetchall():
            conn.execute(
                "INSERT INTO project_items(project_id,component_id,name,footprint,designator,qty_per_board) "
                "VALUES(?,?,?,?,?,?)",
                (npid, it["component_id"], it["name"], it["footprint"], it["designator"], it["qty_per_board"]),
            )
        return {"id": npid, "name": name}


@app.post("/api/projects/{pid}/revenue")
def api_project_revenue(pid: int, data: RevenueIn):
    with db.conn_ctx() as conn:
        p = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "项目不存在")
        if p["status"] not in ("in_progress", "completed"):
            raise HTTPException(400, "当前状态不可填写收益")
        conn.execute("UPDATE projects SET revenue=? WHERE id=?", (data.revenue, pid))
        return project_detail(conn, pid)


@app.get("/api/stock/logs")
def api_stock_logs(component_id: int = 0, limit: int = 300):
    with db.conn_ctx() as conn:
        sql = (
            "SELECT l.id, l.component_id, l.delta, l.type, l.project_id, l.note, l.created_at, "
            "c.name AS cname, c.footprint AS cfoot, p.name AS pname "
            "FROM stock_logs l "
            "LEFT JOIN components c ON c.id=l.component_id "
            "LEFT JOIN projects p ON p.id=l.project_id "
        )
        params = []
        if component_id:
            sql += "WHERE l.component_id=? "
            params.append(component_id)
        sql += "ORDER BY l.id DESC LIMIT ?"
        params.append(min(int(limit), 1000))
        rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------- PCB/钢网采购
@app.post("/api/projects/{pid}/purchases")
def api_project_purchases_save(pid: int, data: PurchaseExtraIn):
    if data.kind not in ("pcb", "stencil"):
        raise HTTPException(400, "kind 必须是 pcb 或 stencil")
    if data.qty <= 0:
        raise HTTPException(400, "数量需要为正数")
    with db.conn_ctx() as conn:
        if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
            raise HTTPException(404, "项目不存在")
        conn.execute(
            "INSERT INTO project_purchases(project_id,kind,qty,cost,note,created_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(project_id,kind) DO UPDATE SET "
            "qty=excluded.qty, cost=excluded.cost, note=excluded.note, created_at=excluded.created_at",
            (pid, data.kind, data.qty, data.cost, data.note, db.now()),
        )
        return project_detail(conn, pid)


@app.get("/api/purchases")
def api_purchases_all():
    with db.conn_ctx() as conn:
        rows = conn.execute(
            "SELECT x.*, p.name AS pname, p.status AS pstatus FROM project_purchases x "
            "JOIN projects p ON p.id=x.project_id ORDER BY x.id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/purchases/pending")
def api_purchases_pending():
    with db.conn_ctx() as conn:
        projs = conn.execute(
            "SELECT * FROM projects WHERE status IN ('in_progress','completed') "
            "AND (needs_pcb=1 OR needs_stencil=1)"
        ).fetchall()
        out = []
        for p in projs:
            have = {r["kind"] for r in conn.execute(
                "SELECT kind FROM project_purchases WHERE project_id=?", (p["id"],)
            ).fetchall()}
            if p["needs_pcb"] and "pcb" not in have:
                out.append({"project_id": p["id"], "project_name": p["name"],
                            "kind": "pcb", "name": "PCB打板", "qty": max(1, p["board_count"])})
            if p["needs_stencil"] and "stencil" not in have:
                out.append({"project_id": p["id"], "project_name": p["name"],
                            "kind": "stencil", "name": "钢网", "qty": 1})
        return out


@app.get("/api/purchases/shortages")
def api_purchases_shortages():
    with db.conn_ctx() as conn:
        rows = conn.execute(
            "SELECT it.id, it.project_id, it.component_id, it.name, it.footprint, it.designator, "
            "it.total_needed, it.occupied, it.bought, p.name AS pname "
            "FROM project_items it JOIN projects p ON p.id=it.project_id "
            "WHERE p.status IN ('in_progress','completed') AND it.total_needed>0"
        ).fetchall()
        out = []
        for it in rows:
            shortage = max(0, it["total_needed"] - it["occupied"] - it["bought"])
            if shortage > 0:
                out.append({
                    "project_id": it["project_id"],
                    "project_name": it["pname"],
                    "item_id": it["id"],
                    "name": it["name"],
                    "footprint": it["footprint"],
                    "needed": it["total_needed"],
                    "occupied": it["occupied"],
                    "bought": it["bought"],
                    "shortage": shortage,
                })
        return out


# ---------------------------------------------------------------- settings
@app.get("/api/settings")
def api_settings():
    try:
        return {"default_loss_ratio": float(db.get_setting("default_loss_ratio", "5"))}
    except Exception:
        return {"default_loss_ratio": 5.0}


@app.put("/api/settings")
def api_settings_update(data: SettingsIn):
    if data.default_loss_ratio < 0:
        raise HTTPException(400, "损耗比不能为负数")
    db.set_setting("default_loss_ratio", data.default_loss_ratio)
    return {"ok": True}


# ---------------------------------------------------------------- stats
@app.get("/api/stats/overview")
def api_stats_overview():
    with db.conn_ctx() as conn:
        inv = conn.execute(
            "SELECT COALESCE(SUM(qty),0) q, COUNT(*) n, COALESCE(SUM(qty*unit_price),0) v FROM components"
        ).fetchone()
        cats = conn.execute(
            "SELECT category, COUNT(*) n, COALESCE(SUM(qty),0) q "
            "FROM components GROUP BY category ORDER BY q DESC"
        ).fetchall()
        proj = conn.execute("SELECT * FROM projects").fetchall()
        items = conn.execute(
            "SELECT it.*, p.status AS st FROM project_items it "
            "JOIN projects p ON p.id=it.project_id"
        ).fetchall()

        status_counts = {"draft": 0, "in_progress": 0, "completed": 0}
        occupied = consumed = 0
        cost_active = cost_completed = 0.0
        revenue = 0.0
        pending_pcb = pending_stencil = 0
        for p in proj:
            key = p["status"]
            status_counts[key] = status_counts.get(key, 0) + 1
            if key in ("in_progress", "completed"):
                ext = extra_cost(conn, p["id"], p["other_cost"])
                cost_active += ext
                occupied += sum(
                    it["occupied"] for it in items if it["project_id"] == p["id"]
                )
                have = {r["kind"] for r in conn.execute(
                    "SELECT kind FROM project_purchases WHERE project_id=?", (p["id"],)
                ).fetchall()}
                if p["needs_pcb"] and "pcb" not in have:
                    pending_pcb += 1
                if p["needs_stencil"] and "stencil" not in have:
                    pending_stencil += 1
            if key == "completed":
                cost_completed += extra_cost(conn, p["id"], p["other_cost"])
                consumed += sum(
                    it["total_needed"] for it in items if it["project_id"] == p["id"]
                )
                if p["revenue"] is not None:
                    revenue += p["revenue"]
        cost_active += sum(it["bought_cost"] for it in items if it["st"] in ("in_progress", "completed"))
        cost_completed += sum(it["bought_cost"] for it in items if it["st"] == "completed")

        return {
            "inventory_qty": inv["q"],
            "inventory_count": inv["n"],
            "inventory_value": round(inv["v"], 2),
            "by_category": [{"category": c["category"], "count": c["n"], "qty": c["q"]} for c in cats],
            "occupied": occupied,
            "consumed": consumed,
            "cost_active": round(cost_active, 2),
            "cost_completed": round(cost_completed, 2),
            "revenue": round(revenue, 2),
            "profit": round(revenue - cost_completed, 2),
            "pending_pcb": pending_pcb,
            "pending_stencil": pending_stencil,
            "project_counts": status_counts,
        }


# ---------------------------------------------------------------- backup
@app.get("/api/backup")
def api_backup_export():
    data = db.dump_all()
    data = {
        "app": "bom-stock",
        "version": 1,
        "exported_at": db.now(),
        **data,
    }
    body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="bom-stock-backup.json"'},
    )


@app.post("/api/backup/import")
async def api_backup_import(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise HTTPException(400, f"备份文件不是有效 JSON：{e}")
    if data.get("app") != "bom-stock":
        raise HTTPException(400, "不是本工具的备份文件")
    # 导入前先把当前数据备份为时间戳文件
    try:
        bak = db.dump_all()
        bakname = os.path.join(db.DATA_DIR, f"pre-import-{int(time.time())}.json")
        with open(bakname, "w", encoding="utf-8") as f:
            json.dump(bak, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    db.restore_all(data)
    return {"ok": True, "restored_components": len(data.get("components", []))}


# ---------------------------------------------------------------- static
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
