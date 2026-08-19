'use strict';
/* 元件库页：搜索 + 类别筛选 + 缺货筛选 + 入库/出库/流水/编辑/删除 */
window.Views = window.Views || {};

window.Views.components = {
  data: [],
  q: '',
  cat: '',
  missing: false,

  async render(container) {
    let list, settings;
    try {
      [list, settings] = await Promise.all([Api.get('/components'), Api.get('/settings')]);
      this.threshold = Number(settings.low_stock_threshold || 0);
      this.thresholdLabel = '≤' + this.threshold + ' 件';
    } catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    this.data = list;
    const cats = [];
    list.forEach(c => { if (cats.indexOf(c.category) < 0) cats.push(c.category); });

    let out = '<div class="card"><h2>元件库 <span class="sub">共 ' + list.length + ' 种 · 低库存阈值 ' + this.thresholdLabel + '</span></h2>' +
      '<div class="bar" style="margin-bottom:12px">' +
      '<input type="text" id="comp-search" placeholder="搜索名称 / 封装 / 别名…" value="' + U.esc(this.q) + '" style="max-width:260px">' +
      '<select id="comp-cat" style="max-width:140px">' +
      '<option value="">全部类别</option>' +
      cats.map(c => '<option value="' + U.esc(c) + '"' + (this.cat === c ? ' selected' : '') + '>' + U.esc(c) + '</option>').join('') +
      '</select>' +
      '<label style="display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:13px"><input type="checkbox" id="comp-missing"' + (this.missing ? ' checked' : '') + '> 只看低库存(' + this.thresholdLabel + ')</label>' +
      '<span style="flex:1"></span>' +
      '<button class="btn primary" id="comp-add">+ 新增元件</button>' +
      '</div>' +
      '<div class="table-wrap"><table><thead><tr>' +
      '<th>名称</th><th>封装</th><th>类别</th><th class="num">单价</th><th class="num">库存</th><th>别名</th><th style="width:290px">操作</th>' +
      '</tr></thead><tbody id="comp-tbody">' + this.renderRows() + '</tbody></table></div></div>';
    container.innerHTML = out;

    const tbody = container.querySelector('#comp-tbody');
    const search = container.querySelector('#comp-search');
    const cat = container.querySelector('#comp-cat');
    const missing = container.querySelector('#comp-missing');
    const apply = () => {
      this.q = search.value.trim().toLowerCase();
      this.cat = cat.value;
      this.missing = missing.checked;
      tbody.innerHTML = this.renderRows();
      this.bindRowActions(container, tbody);
    };
    search.addEventListener('input', apply);
    cat.addEventListener('change', apply);
    missing.addEventListener('change', apply);
    container.querySelector('#comp-add').addEventListener('click', () => this.openForm(null));
    this.bindRowActions(container, tbody);
  },

  renderRows() {
    let rows = this.data;
    if (this.q) {
      rows = rows.filter(c => (c.name + ' ' + c.footprint + ' ' + c.aliases).toLowerCase().indexOf(this.q) >= 0);
    }
    if (this.cat) rows = rows.filter(c => c.category === this.cat);
    if (this.missing) rows = rows.filter(c => c.qty <= (this.threshold || 0));
    if (!rows.length) return '<tr><td colspan="7" class="empty">无匹配元件</td></tr>';
    return rows.map(c => {
      const aliases = (() => { try { return JSON.parse(c.aliases || '[]'); } catch (e) { return []; } })();
      const aliasHtml = aliases.map(a => '<span class="pill">' + U.esc(a) + '</span>').join('') || '<span class="muted small">—</span>';
      const low = c.qty <= (this.threshold || 0);
      const lowq = low ? ' style="color:var(--danger)"' : '';
      return '<tr data-id="' + c.id + '">' +
        '<td><b>' + U.esc(c.name) + '</b>' + (low ? ' <span class="tag red">低库存</span>' : '') + '</td>' +
        '<td>' + U.esc(c.footprint || '—') + '</td>' +
        '<td><span class="tag">' + U.esc(c.category) + '</span></td>' +
        '<td class="num">' + (c.unit_price ? U.fmtMoney(c.unit_price) : '—') + '</td>' +
        '<td class="num"><b' + lowq + '>' + U.fmtNum(c.qty) + '</b></td>' +
        '<td>' + aliasHtml + '</td>' +
        '<td><div class="bar">' +
        '<button class="btn sm c-in">入库</button>' +
        '<button class="btn sm c-out">出库</button>' +
        '<button class="btn sm c-logs">流水</button>' +
        '<button class="btn sm c-edit">编辑</button>' +
        '<button class="btn sm danger c-del">删</button>' +
        '</div></td></tr>';
    }).join('');
  },

  bindRowActions(container, tbody) {
    const self = this;
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = Number(tr.dataset.id);
      const comp = self.data.find(c => c.id === id);
      if (!comp) return;
      tr.querySelector('.c-in').addEventListener('click', () => self.openAdjust(comp, +1));
      tr.querySelector('.c-out').addEventListener('click', () => self.openAdjust(comp, -1));
      tr.querySelector('.c-logs').addEventListener('click', () => {
        window.Views.logs.preset = id;
        App.go('logs');
      });
      tr.querySelector('.c-edit').addEventListener('click', () => self.openForm(comp));
      tr.querySelector('.c-del').addEventListener('click', async () => {
        if (!await U.confirmDlg('确定删除元件「' + comp.name + '」？\n若被项目引用，将自动解除这些项目里的绑定。')) return;
        try {
          const r = await Api.del('/components/' + id);
          U.toast((r.unbound ? '已删除并解除 ' + r.unbound + ' 处绑定' : '已删除'));
          await self.render(container);
        } catch (e) { U.toast(e.message, 'err'); }
      });
    });
  },

  openForm(comp) {
    const aliases = comp ? (() => { try { return JSON.parse(comp.aliases || '[]'); } catch (e) { return []; } })() : [];
    const body = '' +
      '<label class="f">名称<input type="text" id="f-name" value="' + U.esc(comp ? comp.name : '') + '"></label>' +
      '<label class="f">封装<input type="text" id="f-foot" placeholder="如 0805" value="' + U.esc(comp ? comp.footprint : '') + '"></label>' +
      '<div class="row2">' +
      '<label class="f">类别<select id="f-cat">' + ['电阻', '电容', '电感', 'IC', '晶振', '连接器', 'LED', '保险丝', '其他'].map(c => '<option' + (comp && comp.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
      '<label class="f">单价(元/个)<input type="number" step="0.001" min="0" id="f-price" value="' + (comp ? comp.unit_price : '') + '"></label>' +
      '</div>' +
      '<label class="f">同类型别名<small class="muted">（逗号分隔，如 0.1uF,104,100nF）</small><input type="text" id="f-aliases" value="' + U.esc(aliases.join(',')) + '"></label>' +
      '<label class="f">备注<input type="text" id="f-note" value="' + U.esc(comp ? comp.note : '') + '"></label>';
    U.modal(comp ? '编辑元件' : '新增元件', body, {
      onok: (box) => {
        const payload = {
          name: box.querySelector('#f-name').value.trim(),
          footprint: box.querySelector('#f-foot').value.trim(),
          category: box.querySelector('#f-cat').value,
          unit_price: Number(box.querySelector('#f-price').value || 0),
          aliases: box.querySelector('#f-aliases').value.split(/[,，,;；]/).map(s => s.trim()).filter(Boolean),
          note: box.querySelector('#f-note').value.trim()
        };
        if (!payload.name) { U.toast('名称不能为空', 'err'); return false; }
        const op = comp ? Api.put('/components/' + comp.id, payload) : Api.post('/components', payload);
        return op.then(async () => {
          U.toast('已保存');
          await this.render(document.getElementById('main'));
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  },

  openAdjust(comp, sign) {
    const body = '<label class="f">元件：<b>' + U.esc(comp.name) + '</b>（当前库存 ' + U.fmtNum(comp.qty) + '）</label>' +
      '<label class="f">' + (sign > 0 ? '入库' : '出库') + '数量<input type="number" id="ad-n" min="1" value="1"></label>' +
      '<label class="f">备注<small class="muted">（可选）</small><input type="text" id="ad-note"></label>';
    U.modal(sign > 0 ? '入库' : '出库', body, {
      onok: (box) => {
        const delta = Number(box.querySelector('#ad-n').value || 0);
        if (!delta) { U.toast('请输入数量', 'err'); return false; }
        return Api.post('/components/' + comp.id + '/adjust', {
          delta: sign > 0 ? Math.abs(delta) : -Math.abs(delta),
          note: box.querySelector('#ad-note').value.trim()
        }).then(async () => {
          U.toast('已更新');
          await this.render(document.getElementById('main'));
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  }
};
