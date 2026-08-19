'use strict';
/* 总览页：统计卡片 + 项目分布 + 类别分布 + 月度成本收益曲线 + TOP 榜单 */
window.Views = window.Views || {};

window.Views.overview = {
  async render(container) {
    let st;
    try { st = await Api.get('/stats/overview'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }

    const pc = st.project_counts || {};
    const statusName = { draft: '草稿', in_progress: '进行中', completed: '已完成' };
    const statusTag = { draft: 'gray', in_progress: 'blue', completed: 'green' };
    const lsTh = st.low_stock_threshold || 0;

    let out = '<div class="grid-stats">' +
      '<div class="stat"><div class="k">库存总值</div><div class="v acc">' + U.fmtMoney(st.inventory_value) + '</div></div>' +
      '<div class="stat"><div class="k">库存件数 / 种类</div><div class="v">' + U.fmtNum(st.inventory_qty) + ' / ' + U.fmtNum(st.inventory_count) + '</div></div>' +
      '<div class="stat"><div class="k">低库存种数(≤' + lsTh + ')</div><div class="v ' + ((st.low_stock_count || 0) > 0 ? 'red' : '') + '">' + U.fmtNum(st.low_stock_count) + '</div></div>' +
      '<div class="stat"><div class="k">占用中(进行中/已完成)</div><div class="v org">' + U.fmtNum(st.occupied) + ' 件</div></div>' +
      '<div class="stat"><div class="k">已累计消耗</div><div class="v">' + U.fmtNum(st.consumed) + ' 件</div></div>' +
      '<div class="stat"><div class="k">项目总成本(未关闭)</div><div class="v org">' + U.fmtMoney(st.cost_active) + '</div></div>' +
      '<div class="stat"><div class="k">总收益(已完成)</div><div class="v grn">' + U.fmtMoney(st.revenue) + '</div></div>' +
      '<div class="stat"><div class="k">毛利</div><div class="v ' + (st.profit >= 0 ? 'grn' : 'red') + '">' + U.fmtMoney(st.profit) + '</div></div>' +
      '<div class="stat"><div class="k">待采购 PCB</div><div class="v ' + ((st.pending_pcb || 0) > 0 ? 'org' : '') + '">' + U.fmtNum(st.pending_pcb || 0) + '</div></div>' +
      '<div class="stat"><div class="k">待采购 钢网</div><div class="v ' + ((st.pending_stencil || 0) > 0 ? 'org' : '') + '">' + U.fmtNum(st.pending_stencil || 0) + '</div></div>' +
      '</div>';

    // 项目分布
    out += '<div class="card"><h2>项目分布</h2><div class="status-row">';
    for (const k of ['draft', 'in_progress', 'completed']) {
      out += '<span class="tag ' + statusTag[k] + '">' + (statusName[k] || k) + '：' + U.fmtNum(pc[k] || 0) + '</span>';
    }
    out += '</div></div>';

    // 月度成本/收益/毛利曲线
    out += '<div class="card"><h2>成本与盈利曲线 <span class="sub">按完工月份</span></h2>' + this.trendHtml(st.trend || []) + '</div>';

    // 类别分布
    let catRows = '';
    for (const c of st.by_category || []) {
      catRows += '<tr><td>' + U.esc(c.category) + '</td><td class="num">' + U.fmtNum(c.count) + '</td><td class="num">' + U.fmtNum(c.qty) + '</td></tr>';
    }
    if (!catRows) catRows = '<tr><td colspan="3" class="empty">暂无元件</td></tr>';
    out += '<div class="card" style="max-width:560px"><h2>元件类别分布</h2><table><thead><tr><th>类别</th><th class="num">种数</th><th class="num">数量</th></tr></thead><tbody>' + catRows + '</tbody></table></div>';

    // TOP 榜单
    out += '<div class="grid-stats" style="grid-template-columns:1fr 1fr;gap:12px">' +
      '<div>' + this.topCard('消耗量 TOP10（已完成）', st.top_consumed || [], 'qty', v => U.fmtNum(v) + ' 件', 'var(--accent)') + '</div>' +
      '<div>' + this.topCard('采购金额 TOP10', st.top_bought_cost || [], 'cost', v => U.fmtMoney(v), 'var(--warn)') + '</div>' +
      '</div>';

    // 说明
    out += '<div class="card"><h2>说明 <span class="sub">统计口径</span></h2>' +
      '<div class="muted small">' +
      '· 库存：元件库当前总量与按单价估值的总价<br>' +
      '· 低库存：库存 ≤ 设置阈值（设置页可调）的元件种数；元件库中可筛选<br>' +
      '· 占用中：进行中 / 已完成项目从库存扣除的件数（关闭即退回并删除项目）<br>' +
      '· 已消耗：已完成项目占用的元件总数<br>' +
      '· 项目成本：元件采购金额 + PCB/钢网采购 + 其他费用（不含草稿/已删除）<br>' +
      '· 毛利 = 已填收益 − 已完成成本；曲线按项目完工月份汇总' +
      '</div></div>';

    container.innerHTML = out;
  },

  trendHtml(trend) {
    if (!trend.length) return '<div class="muted small">还没有已完成的项目，暂无趋势数据</div>';
    const W = 700, H = 230, padL = 52, padR = 14, padT = 14, padB = 36;
    const viewW = W - padL - padR, viewH = H - padT - padB;
    const n = trend.length;
    let M = 0;
    for (const t of trend) M = Math.max(M, t.cost, t.revenue, Math.abs(t.profit));
    M = M || 1;
    const bw = Math.max(4, Math.min(24, (viewW / n) * 0.26));
    const xAt = i => padL + (n > 1 ? (i * viewW / (n - 1)) : viewW / 2);
    const yAt = v => padT + viewH - (v / M) * viewH;

    let grid = '', bars = '', pts = '', dots = '', labels = '';
    for (let g = 0; g <= 4; g++) {
      const gy = padT + viewH - (g / 4) * viewH;
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (gy + 3) + '" font-size="10" fill="var(--muted)" text-anchor="end">' + this.k(M * g / 4) + '</text>';
    }
    for (let i = 0; i < n; i++) {
      const t = trend[i], cx = xAt(i);
      const hC = (t.cost / M) * viewH, hR = (t.revenue / M) * viewH;
      bars += '<rect x="' + (cx - bw - 1.5) + '" y="' + (padT + viewH - hC) + '" width="' + bw + '" height="' + hC + '" fill="#e5a13c" opacity=".85" rx="2"/>' +
        '<rect x="' + (cx + 1.5) + '" y="' + (padT + viewH - hR) + '" width="' + bw + '" height="' + hR + '" fill="#37c08a" opacity=".85" rx="2"/>';
      pts += (i ? ',' : '') + cx.toFixed(1) + ',' + yAt(t.profit).toFixed(1);
      dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + yAt(t.profit).toFixed(1) + '" r="2.5" fill="#4f8cff"/>';
      labels += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" font-size="10" fill="var(--muted)" text-anchor="middle">' + U.esc(String(t.month).slice(2)) + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px" xmlns="http://www.w3.org/2000/svg">' +
      grid + bars + (pts ? '<polyline points="' + pts + '" fill="none" stroke="#4f8cff" stroke-width="2"/>' + dots : '') + labels + '</svg>' +
      '<div class="small muted" style="margin-top:6px"><span style="color:#e5a13c">▍成本</span> <span style="color:#37c08a">▍收益</span> <span style="color:#4f8cff">— 毛利</span>　月份只显示后两位（如 25-01）</div>';
  },

  k(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + 'w';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v).toString();
  },

  topCard(title, rows, valKey, fmt, color) {
    let html = '<div class="card"><h2>' + title + '</h2>';
    if (!rows || !rows.length) { html += '<div class="muted small">暂无数据</div></div>'; return html; }
    const max = Math.max.apply(null, rows.map(r => r[valKey])) || 1;
    rows.forEach((r, i) => {
      const w = Math.max(2, (r[valKey] / max) * 100);
      html += '<div style="display:flex;align-items:center;gap:10px;margin:6px 0">' +
        '<span style="width:24px;color:var(--muted)" class="small">' + (i + 1) + '</span>' +
        '<div style="flex:1;min-width:0">' +
        '<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.esc(r.name) + '<span class="muted"> ' + U.esc(r.footprint || '') + '</span></span><b>' + fmt(r[valKey]) + '</b></div>' +
        '<div style="height:7px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:3px"><div style="width:' + w + '%;height:100%;background:' + color + ';border-radius:3px"></div></div>' +
        '</div></div>';
    });
    html += '</div>';
    return html;
  }
};
