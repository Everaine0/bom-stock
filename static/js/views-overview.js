'use strict';
/* 总览页：统计卡 + 出入库趋势(可切换天数) + 类别分布环形图 + 品类库存柱状图 + 预警/缺货列表 + 成本盈利曲线 + TOP 榜单 */
window.Views = window.Views || {};

window.Views.overview = {
  range: 30,
  charts: [],
  current: null,

  cssVar(name) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    } catch (e) {}
    return '#888';
  },
  color() {
    return {
      accent: this.cssVar('--accent'),
      green: this.cssVar('--green'),
      warn: this.cssVar('--warn'),
      danger: this.cssVar('--danger'),
      text: this.cssVar('--text'),
      muted: this.cssVar('--muted'),
      line: this.cssVar('--line'),
      panel: this.cssVar('--panel')
    };
  },
  makeChart(id, option) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === 'undefined') return;
    const c = echarts.init(el);
    c.setOption(option);
    this.charts.push(c);
  },

  async render(container) {
    if (this.charts.length) { this.charts.forEach(c => { try { c.dispose(); } catch (e) {} }); this.charts = []; }
    let st;
    try { st = await Api.get('/stats/overview?range=' + (this.range || 30)); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    this.current = container;

    const pc = st.project_counts || {};
    const statusName = { draft: '草稿', in_progress: '进行中', completed: '已完成' };
    const statusTag = { draft: 'gray', in_progress: 'blue', completed: 'green' };
    const sts = st.stock_state || { ok: 0, warn: 0, out: 0 };
    const gTh = st.low_stock_threshold || 0;

    let out = '<div class="grid-stats">' +
      '<div class="stat"><div class="k">库存总值</div><div class="v acc">' + U.fmtMoney(st.inventory_value) + '</div></div>' +
      '<div class="stat"><div class="k">库存件数 / 种类</div><div class="v">' + U.fmtNum(st.inventory_qty) + ' / ' + U.fmtNum(st.inventory_count) + '</div></div>' +
      '<div class="stat"><div class="k"><span class="dot ok"></span> 正常</div><div class="v grn">' + U.fmtNum(sts.ok) + '</div></div>' +
      '<div class="stat"><div class="k"><span class="dot warn"></span> 预警(≤' + gTh + ' 件)</div><div class="v org">' + U.fmtNum(sts.warn) + '</div></div>' +
      '<div class="stat"><div class="k"><span class="dot out"></span> 缺货</div><div class="v red">' + U.fmtNum(sts.out) + '</div></div>' +
      '<div class="stat"><div class="k">占用中</div><div class="v org">' + U.fmtNum(st.occupied) + ' 件</div></div>' +
      '<div class="stat"><div class="k">已消耗</div><div class="v">' + U.fmtNum(st.consumed) + ' 件</div></div>' +
      '<div class="stat"><div class="k">项目成本</div><div class="v org">' + U.fmtMoney(st.cost_active) + '</div></div>' +
      '<div class="stat"><div class="k">总收益</div><div class="v grn">' + U.fmtMoney(st.revenue) + '</div></div>' +
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

    // 出入库趋势
    out += '<div class="card"><h2>出入库趋势 <span class="sub">按天 · 出入库流水</span></h2>' +
      '<div class="bar" style="margin-bottom:6px">' +
      [7, 30, 90, 365].map(r => '<button class="btn sm ' + (this.range === r ? 'primary' : '') + '" data-r="' + r + '">' + (r === 365 ? '一年' : r + '天') + '</button>').join('') +
      '</div><div id="chart-trend" class="chart"></div></div>';

    // 类别分布 + 品类库存
    out += '<div class="grid-2">' +
      '<div class="card"><h2>类别分布 <span class="sub">按种数</span></h2><div id="chart-cat" class="chart"></div></div>' +
      '<div class="card"><h2>品类库存数量</h2><div id="chart-catqty" class="chart"></div></div>' +
      '</div>';

    // 成本与盈利曲线
    out += '<div class="card"><h2>成本与盈利曲线 <span class="sub">按完工月份</span></h2>' + this.profitCard(st.trend || []) + '</div>';

    // TOP 榜单
    out += '<div class="grid-2">' +
      '<div>' + this.topCard('消耗量 TOP10（已完成）', st.top_consumed || [], 'qty', v => U.fmtNum(v) + ' 件', 'var(--accent)') + '</div>' +
      '<div>' + this.topCard('采购金额 TOP10', st.top_bought_cost || [], 'cost', v => U.fmtMoney(v), 'var(--warn)') + '</div>' +
      '</div>';

    container.innerHTML = out;

    // 绑定范围按钮
    container.querySelectorAll('[data-r]').forEach(b => {
      b.addEventListener('click', () => {
        this.range = Number(b.dataset.r);
        this.render(container);
      });
    });

    this.initCharts(st);
  },

  initCharts(st) {
    const C = this.color();
    const cats = (st.by_category || []);

    // 类别分布环形图
    if (cats.length) {
      this.makeChart('chart-cat', {
        tooltip: { trigger: 'item', formatter: '{b}<br/>种数：{c}（{d}%）' },
        legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { color: C.muted, fontSize: 11 } },
        series: [{
          type: 'pie', radius: ['46%', '68%'], center: ['50%', '45%'],
          itemStyle: { borderRadius: 6, borderColor: C.panel, borderWidth: 2 },
          label: { color: C.text, fontSize: 11, formatter: '{b}\n{c}' },
          data: cats.map(c => ({ name: c.category, value: c.count }))
        }]
      });
    } else {
      const el = document.getElementById('chart-cat');
      if (el) el.parentElement.innerHTML = '<div class="muted small" style="padding:20px 0">暂无元件</div>';
    }

    // 各品类库存数量
    if (cats.length) {
      const names = cats.map(c => c.category).reverse();
      const vals = cats.map(c => c.qty).reverse();
      this.makeChart('chart-catqty', {
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 70, top: 8, bottom: 6, containLabel: true },
        xAxis: { type: 'value', axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.line } } },
        yAxis: { type: 'category', data: names, axisLabel: { color: C.text, fontSize: 11 }, axisLine: { lineStyle: { color: C.line } } },
        series: [{ type: 'bar', data: vals, barMaxWidth: 16, itemStyle: { color: C.accent, borderRadius: [0, 5, 5, 0] } }]
      });
    } else {
      const el = document.getElementById('chart-catqty');
      if (el) el.parentElement.innerHTML = '<div class="muted small" style="padding:20px 0">暂无元件</div>';
    }

    // 出入库趋势
    const tr = st.stock_trend || [];
    this.makeChart('chart-trend', {
      tooltip: { trigger: 'axis' },
      legend: { data: ['入库', '出库'], bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: C.muted, fontSize: 11 } },
      grid: { left: 8, right: 8, top: 26, bottom: 34, containLabel: true },
      xAxis: { type: 'category', data: tr.map(t => t.date), axisLabel: { color: C.muted, fontSize: 10, rotate: tr.length > 30 ? 45 : 0 }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.line } } },
      series: [
        { name: '入库', type: 'bar', data: tr.map(t => t.in), barMaxWidth: 13, itemStyle: { color: C.green, borderRadius: [4, 4, 0, 0] } },
        { name: '出库', type: 'bar', data: tr.map(t => t.out), barMaxWidth: 13, itemStyle: { color: C.accent, borderRadius: [4, 4, 0, 0] } }
      ]
    });

    // 成本与盈利
    this.renderProfitChart(st.trend || []);
  },

  profitCard(trend) {
    if (!trend.length) return '<div class="muted small">还没有已完成的项目，暂无趋势数据</div>';
    return '<div id="chart-profit" class="chart tall"></div>';
  },

  renderProfitChart(trend) {
    const C = this.color();
    const months = trend.map(t => U.esc(String(t.month).slice(2)));
    this.makeChart('chart-profit', {
      tooltip: { trigger: 'axis' },
      legend: { data: ['成本', '收益', '毛利'], bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: C.muted, fontSize: 11 } },
      grid: { left: 8, right: 8, top: 26, bottom: 34, containLabel: true },
      xAxis: { type: 'category', data: months, axisLabel: { color: C.muted }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', axisLabel: { color: C.muted }, splitLine: { lineStyle: { color: C.line } } },
      series: [
        { name: '成本', type: 'bar', data: trend.map(t => t.cost), barMaxWidth: 14, itemStyle: { color: C.warn, borderRadius: [4, 4, 0, 0] } },
        { name: '收益', type: 'bar', data: trend.map(t => t.revenue), barMaxWidth: 14, itemStyle: { color: C.green, borderRadius: [4, 4, 0, 0] } },
        { name: '毛利', type: 'line', data: trend.map(t => t.profit), symbol: 'circle', symbolSize: 5, lineStyle: { color: C.accent, width: 2 }, itemStyle: { color: C.accent } }
      ]
    });
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

/* 主题切换时重绘总览图表 */
window.addEventListener('bom-theme-changed', function () {
  const v = window.Views.overview;
  if (window.App && window.App.currentView === 'overview' && v.current) {
    v.render(v.current);
  }
});
