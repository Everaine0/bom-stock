'use strict';
/* 出入库流水页 */
window.Views = window.Views || {};

window.Views.logs = {
  preset: 0, // 从元件库跳转时设置的元件 id

  async render(container) {
    let logs, comps;
    try { logs = await Api.get('/stock/logs'); comps = await Api.get('/components'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }

    const typeName = { in: '入库', out: '出库', occupy: '占用', return: '退回', purchase: '采购' };
    const typeTag = { in: 'green', out: 'org', occupy: 'blue', return: 'org', purchase: 'green' };

    const selId = this.preset || 0;
    const opts = comps.map(c => '<option value="' + c.id + '"' + (selId === c.id ? ' selected' : '') + '>' +
      U.esc(c.name) + ' · ' + U.esc(c.footprint || '无封装') + '</option>').join('');
    this.preset = 0;

    container.innerHTML =
      '<div class="card"><h2>出入库流水 <span class="sub">入库 / 出库 / 项目占用 / 采购 / 退回</span></h2>' +
      '<div class="bar" style="margin-bottom:12px">' +
      '<select id="lg-cid" style="max-width:320px"><option value="0">全部元件</option>' + opts + '</select>' +
      '<select id="lg-type" style="max-width:160px">' +
      '<option value="">全部类型</option>' +
      Object.keys(typeName).map(t => '<option value="' + t + '">' + typeName[t] + '</option>').join('') +
      '</select>' +
      '<button class="btn sm" id="lg-set">刷新</button>' +
      '</div>' +
      '<table><thead><tr><th>时间</th><th>元件</th><th>类型</th><th class="num">数量</th><th>项目</th><th>备注</th></tr></thead>' +
      '<tbody id="lg-tbody">' + this.rows(logs, 0, '') + '</tbody></table></div>';

    const tbody = container.querySelector('#lg-tbody');
    const apply = () => {
      tbody.innerHTML = this.rows(logs, Number(container.querySelector('#lg-cid').value),
        container.querySelector('#lg-type').value);
    };
    container.querySelector('#lg-cid').addEventListener('change', apply);
    container.querySelector('#lg-type').addEventListener('change', apply);
    container.querySelector('#lg-set').addEventListener('click', apply);
  },

  rows(logs, cid, type) {
    let rows = logs;
    if (cid) rows = rows.filter(l => l.component_id === cid);
    if (type) rows = rows.filter(l => l.type === type);
    if (!rows.length) return '<tr><td colspan="6" class="empty">暂无流水记录</td></tr>';
    const typeName = { in: '入库', out: '出库', occupy: '占用', return: '退回', purchase: '采购' };
    const typeTag = { in: 'green', out: 'org', occupy: 'blue', return: 'org', purchase: 'green' };
    return rows.map(l => {
      const delta = l.delta > 0 ? '+' + U.fmtNum(l.delta) : U.fmtNum(l.delta);
      return '<tr>' +
        '<td class="small muted">' + U.esc(l.created_at) + '</td>' +
        '<td><b>' + U.esc(l.cname || ('#已删除 ' + (l.component_id ?? ''))) + '</b>' +
        (l.cfoot ? ' <span class="small muted">' + U.esc(l.cfoot) + '</span>' : '') + '</td>' +
        '<td><span class="tag ' + (typeTag[l.type] || 'gray') + '">' + (typeName[l.type] || l.type) + '</span></td>' +
        '<td class="num"><b class="' + (l.delta >= 0 ? '' : '') + '" style="' + (l.delta >= 0 ? 'color:var(--accent2)' : 'color:var(--danger)') + '">' + delta + '</b></td>' +
        '<td class="small">' + (l.pname ? U.esc(l.pname) : '<span class="muted">—</span>') + '</td>' +
        '<td class="small muted">' + U.esc(l.note || '') + '</td>' +
        '</tr>';
    }).join('');
  }
};
