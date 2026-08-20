'use strict';
/* 元件库页：搜索(支持单位等价) + 类别筛选 + 库存状态三档(正常/预警/缺货) + 位置 + 独立阈值 + 封装预设 + 别名自动生成 */
window.Views = window.Views || {};

window.Views.components = {
  data: [],
  q: '',
  cat: '',
  stock: { ok: true, warn: true, out: true },   // 三档筛选勾选状态

  effThreshold(c) {
    if (c.threshold != null) return Number(c.threshold);
    return Number((this.settings && this.settings.low_stock_threshold) || 0);
  },
  statusOf(c) {
    var q = Number(c.qty || 0);
    if (q <= 0) return 'out';                 // 缺货(红)
    if (q <= this.effThreshold(c)) return 'warn'; // 预警(黄)
    return 'ok';                              // 正常(绿)
  },

  async render(container) {
    let list, settings;
    try {
      [list, settings] = await Promise.all([Api.get('/components'), Api.get('/settings')]);
      this.settings = settings;
      this.threshold = Number(settings.low_stock_threshold || 0);
      this.thresholdLabel = '≤' + this.threshold + ' 件';
    } catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    this.data = list;
    const cats = [];
    list.forEach(c => { if (cats.indexOf(c.category) < 0) cats.push(c.category); });

    const sc = this.stock;
    let out = '<div class="card"><h2>元件库 <span class="sub">共 ' + list.length + ' 种 · 全局预警阈值 ' + this.thresholdLabel + '</span></h2>' +
      '<div class="bar" style="margin-bottom:12px">' +
      '<input type="text" id="comp-search" placeholder="搜索名称/封装/别名/位置（支持 1k=1000、1uF=1000nF 换算）" value="' + U.esc(this.q) + '" style="max-width:300px">' +
      '<select id="comp-cat" style="max-width:140px">' +
      '<option value="">全部类别</option>' +
      cats.map(c => '<option value="' + U.esc(c) + '"' + (this.cat === c ? ' selected' : '') + '>' + U.esc(c) + '</option>').join('') +
      '</select>' +
      '<span class="bar" style="gap:6px">' +
      '<label class="flt" data-k="ok"><input type="checkbox" id="st-ok" data-k="ok"' + (sc.ok ? ' checked' : '') + '><span class="dot ok"></span>正常</label>' +
      '<label class="flt" data-k="warn"><input type="checkbox" id="st-warn" data-k="warn"' + (sc.warn ? ' checked' : '') + '><span class="dot warn"></span>预警</label>' +
      '<label class="flt" data-k="out"><input type="checkbox" id="st-out" data-k="out"' + (sc.out ? ' checked' : '') + '><span class="dot out"></span>缺货</label>' +
      '</span>' +
      '<span style="flex:1"></span>' +
      '<button class="btn primary" id="comp-add">+ 新增元件</button>' +
      '</div>' +
      '<div class="table-wrap"><table><thead><tr>' +
      '<th>名称</th><th>封装</th><th>类别</th><th>位置</th><th class="num">单价</th><th class="num">库存</th><th>别名</th><th style="width:290px">操作</th>' +
      '</tr></thead><tbody id="comp-tbody">' + this.renderRows() + '</tbody></table></div></div>';
    container.innerHTML = out;

    const tbody = container.querySelector('#comp-tbody');
    const search = container.querySelector('#comp-search');
    const cat = container.querySelector('#comp-cat');
    const apply = () => {
      this.q = search.value.trim().toLowerCase();
      this.cat = cat.value;
      tbody.innerHTML = this.renderRows();
      this.bindRowActions(container, tbody);
    };
    search.addEventListener('input', apply);
    cat.addEventListener('change', apply);
    ['st-ok', 'st-warn', 'st-out'].forEach(id => {
      const el = container.querySelector('#' + id);
      el.addEventListener('change', () => {
        this.stock[el.dataset.k] = el.checked;
        tbody.innerHTML = this.renderRows();
        this.bindRowActions(container, tbody);
      });
    });
    container.querySelector('#comp-add').addEventListener('click', () => this.openForm(null));
    this.bindRowActions(container, tbody);
  },

  renderRows() {
    let rows = this.data;
    if (this.q) {
      rows = rows.filter(c => {
        const hay = (c.name + ' ' + (c.footprint || '') + ' ' + (c.aliases || '') + ' ' + (c.location || '')).toLowerCase();
        return hay.indexOf(this.q) >= 0 || U.unitEqMatch(this.q, hay);
      });
    }
    if (this.cat) rows = rows.filter(c => c.category === this.cat);
    if (!(this.stock.ok && this.stock.warn && this.stock.out)) {
      rows = rows.filter(c => this.stock[this.statusOf(c)]);
    }
    if (!rows.length) return '<tr><td colspan="8" class="empty">无匹配元件</td></tr>';
    return rows.map(c => {
      const aliases = (() => { try { return JSON.parse(c.aliases || '[]'); } catch (e) { return []; } })();
      const aliasHtml = aliases.map(a => '<span class="pill">' + U.esc(a) + '</span>').join('') || '<span class="muted small">—</span>';
      const st = this.statusOf(c);
      const color = st === 'out' ? 'var(--danger)' : st === 'warn' ? 'var(--warn)' : 'var(--green)';
      const badge = st === 'out' ? ' <span class="tag red">缺货</span>' : st === 'warn' ? ' <span class="tag org">低库存</span>' : '';
      return '<tr data-id="' + c.id + '">' +
        '<td><b style="color:' + color + '">' + U.esc(c.name) + '</b>' + badge + '</td>' +
        '<td>' + U.esc(c.footprint || '—') + '</td>' +
        '<td><span class="tag">' + U.esc(c.category) + '</span></td>' +
        '<td>' + (c.location ? '<span class="pill">' + U.esc(c.location) + '</span>' : '<span class="muted small">—</span>') + '</td>' +
        '<td class="num">' + (c.unit_price ? U.fmtMoney(c.unit_price) : '—') + '</td>' +
        '<td class="num"><b style="color:' + color + '">' + U.fmtNum(c.qty) + '</b>' +
        (c.threshold != null ? '<span class="sub">阈 ' + U.fmtNum(c.threshold) + '</span>' : '') + '</td>' +
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

  /* 自动分配最小空位置：类别前缀 + 盒子序号 + 槽位编号，如 R1-01 */
  nextLocation(category) {
    const map = (this.settings && this.settings.location_prefix) || {};
    const prefix = map[category] || map['其他'] || 'X';
    const slots = Math.max(1, Number((this.settings && this.settings.slots_per_box) || 8));
    const digits = Math.max(1, Number((this.settings && this.settings.slot_digits) || 2));
    const used = {};
    (this.data || []).forEach(c => { if (c.location) used[String(c.location).toLowerCase()] = true; });
    for (let box = 1; box < 10000; box++) {
      for (let slot = 1; slot <= slots; slot++) {
        const loc = prefix + box + '-' + String(slot).padStart(digits, '0');
        if (!used[loc.toLowerCase()]) return loc;
      }
    }
    return prefix + '1-' + String(1).padStart(digits, '0');
  },

  openForm(comp) {
    const isNew = !comp;
    const self = this;
    const aliases = comp ? (() => { try { return JSON.parse(comp.aliases || '[]'); } catch (e) { return []; } })() : [];
    const cats = ['电阻', '电容', '电感', 'IC', '晶振', '连接器', 'LED', '保险丝', '其他'];
    const presets = (this.settings && this.settings.footprint_presets) || {};
    const cat0 = comp ? comp.category : '电阻';

    const body = '' +
      '<label class="f">名称<input type="text" id="f-name" placeholder="如 10kΩ / 0.1uF / 1N4007" value="' + U.esc(comp ? comp.name : '') + '"></label>' +
      '<label class="f">封装<input type="text" id="f-foot" list="fp-list" placeholder="如 0805 / C0402" value="' + U.esc(comp ? comp.footprint : '') + '">' +
      '<datalist id="fp-list">' + (presets[cat0] || []).map(f => '<option value="' + U.esc(f) + '">').join('') + '</datalist>' +
      '<small class="muted">按类别预设下拉，也可自由输入</small></label>' +
      '<div class="row2">' +
      '<label class="f">类别<select id="f-cat">' + cats.map(c => '<option' + (comp && comp.category === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
      '<label class="f">单价(元/个)<input type="number" step="0.001" min="0" id="f-price" value="' + (comp ? comp.unit_price : '') + '"></label>' +
      '</div>' +
      '<div class="row2">' +
      '<label class="f">预警阈值(件)<input type="number" min="0" id="f-thr" placeholder="留空用全局(' + this.thresholdLabel + ')" value="' + (comp && comp.threshold != null ? comp.threshold : '') + '"></label>' +
      '<label class="f">存放位置<small class="muted">格式 前缀+盒子-槽位，如 R1-01</small>' +
      '<span class="bar" style="flex-wrap:nowrap">' +
      '<input type="text" id="f-loc" placeholder="如 R1-01" value="' + U.esc(comp ? (comp.location || '') : '') + '" style="flex:1;min-width:0">' +
      '<button type="button" class="btn sm" id="f-loc-auto">自动分配</button>' +
      '</span></label>' +
      '</div>' +
      '<label class="f">同类型别名<small class="muted">（逗号分隔；按『名称+类别』自动生成等价写法，如 1uF→1000nF,105）</small><input type="text" id="f-aliases" value="' + U.esc(aliases.join(',')) + '"></label>' +
      '<div id="f-alias-hint" class="hint" style="margin-bottom:12px"></div>' +
      '<label class="f">备注<input type="text" id="f-note" value="' + U.esc(comp ? comp.note : '') + '"></label>';
    U.modal(comp ? '编辑元件' : '新增元件', body, {
      onok: (box) => {
        const thrEl = box.querySelector('#f-thr');
        const payload = {
          name: box.querySelector('#f-name').value.trim(),
          footprint: box.querySelector('#f-foot').value.trim(),
          category: box.querySelector('#f-cat').value,
          unit_price: Number(box.querySelector('#f-price').value || 0),
          aliases: box.querySelector('#f-aliases').value.split(/[,，;；]/).map(s => s.trim()).filter(Boolean),
          note: box.querySelector('#f-note').value.trim(),
          location: box.querySelector('#f-loc').value.trim(),
          threshold: thrEl && thrEl.value !== '' ? Number(thrEl.value) : null
        };
        if (!payload.name) { U.toast('名称不能为空', 'err'); return false; }
        const op = comp ? Api.put('/components/' + comp.id, payload) : Api.post('/components', payload);
        return op.then(async () => {
          U.toast('已保存');
          await this.render(document.getElementById('main'));
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });

    // 表单联动逻辑
    const box = document.getElementById('modal-root').querySelector('.box');
    const fName = box.querySelector('#f-name');
    const fCat = box.querySelector('#f-cat');
    const fAlias = box.querySelector('#f-aliases');
    const fLoc = box.querySelector('#f-loc');
    const fFoot = box.querySelector('#f-foot');
    const fpListEl = box.querySelector('#fp-list');
    const hintEl = box.querySelector('#f-alias-hint');
    let aliasDirty = false, locDirty = false;

    const datalistFor = cat => {
      fpListEl.innerHTML = (presets[cat] || []).map(f => '<option value="' + U.esc(f) + '">').join('');
      if (!comp && !(presets[cat] || []).length) fFoot.value = '';
    };

    const genAlias = () => {
      const name = fName.value.trim();
      const cat = fCat.value;
      // 自动生成别名仅限 电容 / 电阻；其它类别不自动填
      if (cat !== '电容' && cat !== '电阻') { hintEl.innerHTML = ''; return; }
      const list = U.genAliases(name, cat);
      if (list.length) {
        hintEl.innerHTML = '自动生成：<span class="pill">' + list.map(a => U.esc(a)).join('</span> <span class="pill">') + '</span>';
        // 未手动编辑过别名时：整体替换（避免中间态残留，如输入 1 再补 k 时残留 1Ω）
        if (isNew && !aliasDirty) fAlias.value = list.join(',');
      } else {
        hintEl.innerHTML = '';
      }
    };

    const autoLoc = (cat, force) => {
      if ((!isNew || locDirty) && !force) return;
      const loc = this.nextLocation(cat);
      if (loc) { fLoc.value = loc; locDirty = false; }
    };

    fCat.addEventListener('change', () => {
      datalistFor(fCat.value);
      if (isNew) { genAlias(); autoLoc(fCat.value, false); }
    });
    fName.addEventListener('input', genAlias);
    fAlias.addEventListener('input', () => { aliasDirty = true; hintEl.innerHTML = ''; });
    fLoc.addEventListener('input', () => { locDirty = true; });
    box.querySelector('#f-loc-auto').addEventListener('click', () => autoLoc(fCat.value, true));

    // 初始化
    if (isNew) {
      datalistFor(cat0);
      autoLoc(cat0, false);
      genAlias();
    } else {
      datalistFor(cat0);
    }
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
