'use strict';
/* 采购页：元件缺件 + PCB/钢网 统一采购 */
window.Views = window.Views || {};

window.Views.purchases = {
  async render(container) {
    let shortages, pending, purchased;
    try {
      [shortages, pending, purchased] = await Promise.all([
        Api.get('/purchases/shortages'),
        Api.get('/purchases/pending'),
        Api.get('/purchases')
      ]);
    } catch (e) {
      container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>';
      return;
    }

    // —— 元件缺件 ——
    let rows = '';
    if (!shortages.length) rows = '<tr><td colspan="4" class="empty">当前没有缺件的元件 ✓</td></tr>';
    for (const s of shortages) {
      rows += '<tr data-item="' + s.item_id + '" data-pid="' + s.project_id + '">' +
        '<td>' + U.esc(s.project_name) + '</td>' +
        '<td><b>' + U.esc(s.name) + '</b><div class="small muted">' + U.esc(s.footprint || '') + '</div></td>' +
        '<td class="num"><b style="color:var(--danger)">' + U.fmtNum(s.shortage) + '</b><div class="small muted">需 ' + U.fmtNum(s.needed) + ' / 已' + U.fmtNum(s.occupied + s.bought) + '</div></td>' +
        '<td><button class="btn sm p-buy">采购</button></td></tr>';
    }
    let html = '<div class="card"><h2>待采购元件</h2>' +
      '<div class="table-wrap"><table><thead><tr><th>项目</th><th>元件 / 封装</th><th class="num">缺件</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    // —— PCB / 钢网 ——
    rows = '';
    const kindName = { pcb: 'PCB打板', stencil: '钢网' };
    if (!pending.length) rows = '<tr><td colspan="4" class="empty">没有待采购的 PCB / 钢网 ✓</td></tr>';
    for (const p of pending) {
      rows += '<tr data-pid="' + p.project_id + '" data-kind="' + p.kind + '" data-qty="' + p.qty + '">' +
        '<td>' + U.esc(p.project_name) + '</td>' +
        '<td><span class="tag org">' + kindName[p.kind] + '</span></td>' +
        '<td class="num">×' + U.fmtNum(p.qty) + '</td>' +
        '<td><button class="btn sm p-px">记录成本</button></td></tr>';
    }
    html += '<div class="card"><h2>待采购 PCB / 钢网</h2>' +
      '<div class="table-wrap"><table><thead><tr><th>项目</th><th>类型</th><th class="num">数量</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    // —— 已采购 ——
    rows = '';
    if (!purchased.length) rows = '<tr><td colspan="5" class="empty">还没有采购记录</td></tr>';
    for (const x of purchased) {
      rows += '<tr><td>' + U.esc(x.pname) + '</td><td>' + (kindName[x.kind] || x.kind) + '</td>' +
        '<td class="num">' + U.fmtNum(x.qty) + '</td><td class="num">' + U.fmtMoney(x.cost) + '</td>' +
        '<td class="small muted">' + U.esc(x.created_at) + (x.note ? ' · ' + U.esc(x.note) : '') + '</td></tr>';
    }
    html += '<div class="card"><h2>采购记录</h2>' +
      '<div class="table-wrap"><table><thead><tr><th>项目</th><th>类型</th><th class="num">数量</th><th class="num">成本</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    container.innerHTML = html;
    this.bind(container);
  },

  bind(container) {
    // 元件采购
    container.querySelectorAll('.p-buy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const pid = Number(tr.dataset.pid);
        const itemId = Number(tr.dataset.item);
        const project = (await Api.get('/projects/' + pid)).items.find(i => i.id === itemId);
        if (!project) return;
        const body = '<label class="f">元件：<b>' + U.esc(project.name) + '</b>（项目：' + U.esc(tr.dataset.pid) + '）</label>' +
          '<label class="f">缺件 <b style="color:var(--danger)">' + U.fmtNum(project.shortage) + '</b> 件</label>' +
          '<label class="f">购买数量<input type="number" id="q' + itemId + '" min="1" value="' + project.shortage + '"></label>' +
          '<label class="f">单价(元/个)<input type="number" id="p' + itemId + '" min="0" step="0.001"></label>';
        U.modal('采购入库', body, {
          onok: (box) => {
            const qty = Math.floor(Number(box.querySelector('#q' + itemId).value || 0));
            const price = Number(box.querySelector('#p' + itemId).value || 0);
            if (qty <= 0) { U.toast('数量需为正数', 'err'); return false; }
            return Api.post('/projects/' + pid + '/purchase', { items: [{ item_id: itemId, qty: qty, unit_price: price }] }).then(async () => {
              U.toast('已入库 ' + qty + ' 件'); await App.go('purchases');
            }).catch(e => { U.toast(e.message, 'err'); return false; });
          }
        });
      });
    });
    // PCB/钢网采购
    const kindName = { pcb: 'PCB打板', stencil: '钢网' };
    container.querySelectorAll('.p-px').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const pid = Number(tr.dataset.pid);
        const kind = tr.dataset.kind;
        const qty = Number(tr.dataset.qty);
        const body = '<label class="f">采购：<b>' + kindName[kind] + '</b>（项目：' + U.esc(tr.querySelector('td').textContent) + '）</label>' +
          '<label class="f">数量<input type="number" id="px-q" min="1" value="' + qty + '"></label>' +
          '<label class="f">实际成本(元)<input type="number" id="px-c" min="0" step="0.01"></label>' +
          '<label class="f">备注<input type="text" id="px-n"></label>';
        U.modal('记录 ' + kindName[kind] + ' 采购', body, {
          onok: (box) => {
            const q = Math.floor(Number(box.querySelector('#px-q').value || 0));
            const c = Number(box.querySelector('#px-c').value || 0);
            if (q <= 0) { U.toast('数量需为正数', 'err'); return false; }
            return Api.post('/projects/' + pid + '/purchases', { kind: kind, qty: q, cost: c, note: box.querySelector('#px-n').value.trim() }).then(async () => {
              U.toast('已记录'); await App.go('purchases');
            }).catch(e => { U.toast(e.message, 'err'); return false; });
          }
        });
      });
    });
  }
};
