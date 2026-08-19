"""SQLite 数据访问层。"""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(PROJECT_ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "bom_stock.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS components(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  footprint  TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '其他',
  aliases    TEXT NOT NULL DEFAULT '[]',
  qty        INTEGER NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stock_logs(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id INTEGER NOT NULL,
  delta        INTEGER NOT NULL,
  type         TEXT NOT NULL DEFAULT '',
  project_id   INTEGER,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TEXT NOT NULL,
  board_count   INTEGER NOT NULL DEFAULT 1,
  loss_ratio    REAL,
  needs_pcb     INTEGER NOT NULL DEFAULT 0,
  pcb_cost      REAL NOT NULL DEFAULT 0,
  needs_stencil INTEGER NOT NULL DEFAULT 0,
  stencil_cost  REAL NOT NULL DEFAULT 0,
  other_cost    REAL NOT NULL DEFAULT 0,
  revenue       REAL,
  note          TEXT NOT NULL DEFAULT '',
  closed_at     TEXT
);
CREATE TABLE IF NOT EXISTS project_items(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL,
  component_id  INTEGER,
  name          TEXT NOT NULL,
  footprint     TEXT NOT NULL DEFAULT '',
  designator    TEXT NOT NULL DEFAULT '',
  qty_per_board INTEGER NOT NULL DEFAULT 1,
  total_needed  INTEGER NOT NULL DEFAULT 0,
  occupied      INTEGER NOT NULL DEFAULT 0,
  bought        INTEGER NOT NULL DEFAULT 0,
  bought_cost   REAL NOT NULL DEFAULT 0
);
"""


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_conn():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def conn_ctx():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with conn_ctx() as conn:
        conn.executescript(SCHEMA)
    with conn_ctx() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO settings(key,value) VALUES('default_loss_ratio','5')"
        )


def get_setting(key, default=None):
    with conn_ctx() as conn:
        r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default


def set_setting(key, value):
    with conn_ctx() as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )


def dump_all() -> dict:
    """导出全部数据（用于备份）。"""
    with conn_ctx() as conn:
        return {
            "settings": [dict(r) for r in conn.execute("SELECT * FROM settings").fetchall()],
            "components": [dict(r) for r in conn.execute("SELECT * FROM components").fetchall()],
            "stock_logs": [dict(r) for r in conn.execute("SELECT * FROM stock_logs").fetchall()],
            "projects": [dict(r) for r in conn.execute("SELECT * FROM projects").fetchall()],
            "project_items": [dict(r) for r in conn.execute("SELECT * FROM project_items").fetchall()],
        }


def restore_all(data: dict):
    """用备份数据整体替换（保留自增 id）。"""
    with conn_ctx() as conn:
        conn.execute("DELETE FROM project_items")
        conn.execute("DELETE FROM projects")
        conn.execute("DELETE FROM stock_logs")
        conn.execute("DELETE FROM components")
        conn.execute("DELETE FROM settings")

        for s in data.get("settings", []):
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?)", (s["key"], s["value"])
            )
        for c in data.get("components", []):
            conn.execute(
                "INSERT INTO components(id,name,footprint,category,aliases,qty,unit_price,note) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (c["id"], c["name"], c["footprint"], c["category"], c["aliases"],
                 c["qty"], c.get("unit_price", 0), c.get("note", "")),
            )
        for l in data.get("stock_logs", []):
            conn.execute(
                "INSERT INTO stock_logs(id,component_id,delta,type,project_id,note,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (l["id"], l["component_id"], l["delta"], l.get("type", ""),
                 l.get("project_id"), l.get("note", ""), l.get("created_at", now())),
            )
        for p in data.get("projects", []):
            conn.execute(
                "INSERT INTO projects(id,name,status,created_at,board_count,loss_ratio,"
                "needs_pcb,pcb_cost,needs_stencil,stencil_cost,other_cost,revenue,note,closed_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (p["id"], p["name"], p.get("status", "draft"), p.get("created_at", now()),
                 p.get("board_count", 1), p.get("loss_ratio"), p.get("needs_pcb", 0),
                 p.get("pcb_cost", 0), p.get("needs_stencil", 0), p.get("stencil_cost", 0),
                 p.get("other_cost", 0), p.get("revenue"), p.get("note", ""), p.get("closed_at")),
            )
        for it in data.get("project_items", []):
            conn.execute(
                "INSERT INTO project_items(id,project_id,component_id,name,footprint,designator,"
                "qty_per_board,total_needed,occupied,bought,bought_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (it["id"], it["project_id"], it.get("component_id"), it["name"], it.get("footprint", ""),
                 it.get("designator", ""), it.get("qty_per_board", 1), it.get("total_needed", 0),
                 it.get("occupied", 0), it.get("bought", 0), it.get("bought_cost", 0)),
            )
