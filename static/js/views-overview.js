'use strict';
/* 总览页 */
window.Views = window.Views || {};

window.Views.overview = {
  async render(container) {
    let st;
    try { st = await Api.get('/stats/overview'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }

    const pc = st.project_counts || {};
    const statusName = { draft: '草稿', in_progress: '进行中', completed: '已完成', closed: '已关闭' };
    const statusTag = { draft: 'gray', in_progress: 'blue', completed: 'green', closed: 'org' };

    let out = '<div class="grid-stats">' +
      '<div class="stat"><div class="k">库存总值</div><div class="v acc">' + U.fmtMoney(st.inventory_value) + '</div></div>' +
      '<div class="stat"><div class="k">库存件数 / 种类</div><div class="v">' + U.fmtNum(st.inventory_qty) + ' / ' + U.fmtNum(st.inventory_count) + '</div></div>' +
      '<div class="stat"><div class="k">占用中(进行中/已完成项目)</div><div class="v org">' + U.fmtNum(st.occupied) + ' 件</div></div>' +
      '<div class="stat"><div class="k">已累计消耗</div><div class="v">' + U.fmtNum(st.consumed) + ' 件</div></div>' +
      '<div class="stat"><div class="k">项目总成本(未关闭)</div><div class="v org">' + U.fmtMoney(st.cost_active) + '</div></div>' +
      '<div class="stat"><div class="k">已完成项目成本</div><div class="v">' + U.fmtMoney(st.cost_completed) + '</div></div>' +
      '<div class="stat"><div class="k">总收益(已完成)</div><div class="v grn">' + U.fmtMoney(st.revenue) + '</div></div>' +
      '<div class="stat"><div class="k">毛利</div><div class="v ' + (st.profit >= 0 ? 'grn' : 'red') + '">' + U.fmtMoney(st.profit) + '</div></div>' +
      '</div>';

    // 项目状态分布
    out += '<div class="card"><h2>项目分布</h2><div class="status-row">';
    for (const k of ['draft', 'in_progress', 'completed', 'closed']) {
      out += '<span class="tag ' + statusTag[k] + '">' + (statusName[k] || k) + '：' + U.fmtNum(pc[k] || 0) + '</span>';
    }
    out += '</div></div>';

    // 类别分布
    let catRows = '';
    for (const c of st.by_category || []) {
      catRows += '<tr><td>' + U.esc(c.category) + '</td><td class="num">' + U.fmtNum(c.count) + '</td><td class="num">' + U.fmtNum(c.qty) + '</td></tr>';
    }
    if (!catRows) catRows = '<tr><td colspan="3" class="empty">暂无元件</td></tr>';
    out += '<div class="card" style="max-width:560px"><h2>元件类别分布</h2><table><thead><tr><th>类别</th><th class="num">种数</th><th class="num">数量</th></tr></thead><tbody>' + catRows + '</tbody></table></div>';

    // 消耗说明
    out += '<div class="card"><h2>说明 <span class="sub">统计口径</span></h2>' +
      '<div class="muted small">' +
      '· 库存：元件库当前总量与按单价估值的总价<br>' +
      '· 占用中：进行中 / 已完成项目从库存扣除的件数（关闭后会退回）<br>' +
      '· 已消耗：已完成项目占用的元件总数<br>' +
      '· 项目成本：元件采购金额 + PCB打板 + 钢网 + 其他费用（不含已关闭项目）<br>' +
      '· 毛利 = 已填收益 − 已完成项目成本' +
      '</div></div>';

    container.innerHTML = out;
  }
};
