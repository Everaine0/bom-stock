'use strict';
/* 项目页：列表(按返单系列折叠) + 详情(物料/采购/PCB钢网/返单/收益) */
window.Views = window.Views || {};

window.Views.projects = {
  currentId: null,
  STATUS_NAME: { draft: '草稿', in_progress: '进行中', completed: '已完成' },
  STATUS_TAG: { draft: 'gray', in_progress: 'blue', completed: 'green' },

  async render(container) {
    if (this.currentId) await this.loadDetail(container, this.currentId);
    else await this.loadList(container);
  },

  /* ---------------- 列表 ---------------- */
  async loadList(container) {
    let list;
    try { list = await Api.get('/projects'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    this.currentId = null;

    const childrenBy = {};
    list.forEach(p => { if (p.parent_project_id) (childrenBy[p.parent_project_id] = childrenBy[p.parent_project_id] || []).push(p); });
    const roots = list.filter(p => !p.parent_project_id);

    let rows = '';
    for (const r of roots) {
      rows += this.listRow(r, childrenBy[r.id] || []);
      const kids = childrenBy[r.id] || [];
      rows += kids.map(k => this.listRow(k, [], true)).join('');
    }
    if (!rows) rows = '<tr><td colspan="8" class="empty">还没有项目，点击右上角创建一个吧（可上传立创 BOM）</td></tr>';

    container.innerHTML =
      '<div class="card"><h2>项目 <span class="sub">板数 × BOM数量 × (1+损耗) = 需求量</span></h2>' +
      '<div class="bar" style="margin-bottom:12px"><button class="btn primary" id="p-new">+ 新建项目</button>' +
      '<span class="muted small">草稿可删除；确认后「进行中」，可「完成」(需缺件补齐) 或「关闭并删除」(退回元件)</span></div>' +
      '<table><thead><tr><th>名称</th><th>状态</th><th class="num">板数</th><th class="num">损耗</th><th class="num">BOM行</th><th class="num">成本</th><th>创建时间</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    container.querySelector('#p-new').addEventListener('click', () => this.newProject());
    const self = this;
    container.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = Number(tr.dataset.id);
      tr.querySelector('.p-open').addEventListener('click', () => {
        this.currentId = id;
        this.render(container);
      });
      const del = tr.querySelector('.p-del');
      if (del) del.addEventListener('click', async () => {
        if (!await U.confirmDlg('确定删除该草稿项目？')) return;
        try { await Api.del('/projects/' + id); U.toast('已删除'); await this.loadList(container); }
        catch (e) { U.toast(e.message, 'err'); }
      });
      const tog = tr.querySelector('.p-series');
      if (tog) tog.addEventListener('click', () => {
        const kids = container.querySelectorAll('.child-series-' + tog.dataset.target);
        const showAll = kids[0] && kids[0].hidden;
        kids.forEach(k => { k.hidden = !showAll; });
        tog.innerHTML = tog.dataset.count + ' ▾';
        if (showAll) tog.innerHTML = tog.dataset.count + ' ▴';
      });
    });
    // 默认折叠返单系列
    container.querySelectorAll('.child-series').forEach(k => { k.hidden = true; });
    container.querySelectorAll('.p-series').forEach(b => { b.innerHTML = b.dataset.count + ' ▸'; });
  },

  listRow(p, kids, isChild) {
    const stName = this.STATUS_NAME[p.status] || p.status;
    const stTag = this.STATUS_TAG[p.status] || 'gray';
    const indent = isChild ? '&nbsp;&nbsp;└ ' : '';
    let actions = '<button class="btn sm primary p-open">打开</button>';
    if (!isChild && kids.length) {
      actions += '<button class="btn sm p-series" data-target="' + p.id + '" data-count="返单' + kids.length + '"></button>';
    }
    if (isChild) actions = actions;
    if (p.status === 'draft') actions += '<button class="btn sm danger p-del">删</button>';
    return '<tr data-id="' + p.id + '"' + (isChild ? ' class="child-series-' + p.parent_project_id + '"' : '') + '>' +
      '<td>' + indent + '<b>' + U.esc(p.name) + '</b>' + (isChild ? ' <span class="tag gray">返单</span>' : '') + '</td>' +
      '<td><span class="tag ' + stTag + '">' + stName + '</span></td>' +
      '<td class="num">' + U.fmtNum(p.board_count) + '</td>' +
      '<td class="num">' + (p.loss_ratio == null ? '全局' : p.loss_ratio + '%') + '</td>' +
      '<td class="num">' + U.fmtNum(p.item_count) + '</td>' +
      '<td class="num">' + U.fmtMoney(p.cost_total) + '</td>' +
      '<td class="small muted">' + U.esc((p.created_at || '').slice(0, 16)) + '</td>' +
      '<td><div class="bar">' + actions + '</div></td></tr>';
  },

  /* ---------------- 新建/编辑 ---------------- */
  newProject() {
    const body =
      '<label class="f">项目名称<input type="text" id="p-name" placeholder="如：6.2寸USB机箱副屏"></label>' +
      '<div class="row2">' +
      '<label class="f">制作块数<input type="number" id="p-board" min="1" value="1"></label>' +
      '<label class="f">损耗比 %<small class="muted">（留空用全局设置）</small><input type="number" id="p-loss" min="0" step="0.1"></label>' +
      '</div>' +
      '<label class="f"><input type="checkbox" id="p-pcb" style="width:auto"> 需 PCB 打板（采购时再记录成本）</label>' +
      '<label class="f"><input type="checkbox" id="p-sten" style="width:auto"> 需钢网（采购时再记录成本）</label>' +
      '<label class="f">其他费用<small class="muted">（如邮费/SMT费，元）</small><input type="number" id="p-other" min="0" step="0.01" value="0"></label>' +
      '<label class="f">备注<input type="text" id="p-note"></label>';
    U.modal('新建项目', body, {
      onok: (box) => {
        const d = this.collectForm(box);
        if (!d.name) { U.toast('请填写项目名称', 'err'); return false; }
        return Api.post('/projects', d).then(async r => {
          this.currentId = r.id;
          await this.render(document.getElementById('main'));
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  },

  collectForm(box) {
    return {
      name: box.querySelector('#p-name').value.trim(),
      board_count: Math.max(1, Number(box.querySelector('#p-board').value || 1)),
      loss_ratio: box.querySelector('#p-loss').value === '' ? null : Number(box.querySelector('#p-loss').value),
      needs_pcb: box.querySelector('#p-pcb').checked,
      needs_stencil: box.querySelector('#p-sten').checked,
      other_cost: Number(box.querySelector('#p-other').value || 0),
      note: box.querySelector('#p-note').value.trim()
    };
  },

  editProject(p) {
    const body =
      '<label class="f">项目名称<input type="text" id="e-name" value="' + U.esc(p.name) + '"></label>' +
      '<div class="row2">' +
      '<label class="f">制作块数<input type="number" id="e-board" min="1" value="' + p.board_count + '"></label>' +
      '<label class="f">损耗比 %（留空=全局）<input type="number" id="e-loss" min="0" step="0.1" value="' + (p.loss_ratio == null ? '' : p.loss_ratio) + '"></label>' +
      '</div>' +
      '<label class="f"><input type="checkbox" id="e-pcb" style="width:auto"' + (p.needs_pcb ? ' checked' : '') + '> 需 PCB 打板（采购时再记录成本）</label>' +
      '<label class="f"><input type="checkbox" id="e-sten" style="width:auto"' + (p.needs_stencil ? ' checked' : '') + '> 需钢网（采购时再记录成本）</label>' +
      '<label class="f">其他费用<input type="number" id="e-other" min="0" step="0.01" value="' + p.other_cost + '"></label>' +
      '<label class="f">备注<input type="text" id="e-note" value="' + U.esc(p.note) + '"></label>';
    U.modal('编辑项目', body, {
      onok: (box) => {
        const d = {
          name: box.querySelector('#e-name').value.trim(),
          board_count: Math.max(1, Number(box.querySelector('#e-board').value || 1)),
          loss_ratio: box.querySelector('#e-loss').value === '' ? null : Number(box.querySelector('#e-loss').value),
          needs_pcb: box.querySelector('#e-pcb').checked,
          needs_stencil: box.querySelector('#e-sten').checked,
          other_cost: Number(box.querySelector('#e-other').value || 0),
          note: box.querySelector('#e-note').value.trim()
        };
        return Api.put('/projects/' + p.id, d).then(async () => {
          U.toast('已保存');
          await this.loadDetail(document.getElementById('main'), p.id);
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  },

  /* ---------------- 详情 ---------------- */
  async loadDetail(container, pid) {
    let d, comps;
    try {
      d = await Api.get('/projects/' + pid);
      comps = await Api.get('/components');
    } catch (e) {
      if (String(e.message).indexOf('404') >= 0) { this.currentId = null; return this.loadList(container); }
      container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>';
      return;
    }
    const p = d.project;
    const stName = this.STATUS_NAME[p.status] || p.status;
    const stTag = this.STATUS_TAG[p.status] || 'gray';
    const isDraft = p.status === 'draft';
    const isAct = p.status === 'in_progress' || p.status === 'completed';
    const isDone = p.status === 'completed';

    let out = '<div class="card"><div class="status-row">' +
      '<button class="btn sm" id="pd-back">← 返回列表</button>' +
      '<h2 style="margin:0">' + U.esc(p.name) + '</h2>' +
      '<span class="tag ' + stTag + '">' + stName + '</span>' +
      '<span class="muted small">创建于 ' + U.esc(p.created_at) + '</span>' +
      (isDone ? '<button class="btn sm" id="pd-profit">' + (p.revenue == null ? '填写收益' : '修改收益') + '</button>' : '') +
      (isDone ? '<button class="btn sm primary" id="pd-redo">↻ 返单</button>' : '') +
      (p.status === 'in_progress' ? '<button class="btn sm danger" id="pd-close">关闭并删除</button>' : '') +
      '</div></div>';

    // 项目信息
    out += '<div class="card"><h2>项目信息 <span class="sub">板数 × BOM数量 × (1+损耗) = 需求量</span></h2>';
    if (isDraft) {
      out += '<div class="bar">' +
        '<span>板数 <b>' + U.fmtNum(p.board_count) + '</b></span>' +
        '<span>损耗 <b>' + (p.loss_ratio == null ? p.loss_ratio_effective + '% (全局)' : p.loss_ratio + '%') + '</b></span>' +
        (p.needs_pcb ? '<span class="tag org">PCB打板</span>' : '') +
        (p.needs_stencil ? '<span class="tag org">钢网</span>' : '') +
        '<button class="btn sm" id="pd-edit">编辑信息</button></div>';
    } else {
      out += '<div class="muted small">板数 ' + U.fmtNum(p.board_count) + ' · 损耗 ' + p.loss_ratio_effective + '%' +
        (p.needs_pcb ? ' · <b>需PCB打板</b>' : '') +
        (p.needs_stencil ? ' · <b>需钢网</b>' : '') +
        (p.note ? ' · 备注：' + U.esc(p.note) : '') + '</div>';
    }
    out += '<div class="grid-stats" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin:12px 0 0">' +
      '<div class="stat"><div class="k">元件采购成本</div><div class="v">' + U.fmtMoney(d.cost_bought) + '</div></div>' +
      '<div class="stat"><div class="k">PCB/钢网/其他</div><div class="v">' + U.fmtMoney(d.cost_extra) + '</div></div>' +
      '<div class="stat"><div class="k">项目总成本</div><div class="v org">' + U.fmtMoney(d.cost_total) + '</div></div>' +
      '<div class="stat"><div class="k">收益/毛利</div><div class="v grn">' + (p.revenue == null ? '未填' : U.fmtMoney(p.revenue)) + ' / ' + (p.revenue == null ? '—' : U.fmtMoney(p.revenue - d.cost_total)) + '</div></div>' +
      '</div></div>';

    // BOM 上传 / 物料对比表
    if (isDraft) {
      out += '<div class="card"><h2>上传 BOM <span class="sub">立创 .xlsx/.csv；重新上传会覆盖</span></h2>' +
        '<div class="bar"><input type="file" id="pd-bom" accept=".xlsx,.xls,.csv"><button class="btn primary" id="pd-bomgo">上传并解析</button>' +
        '<span class="muted small">匹配：名称+封装 → 别名 → 值归一化；新建元件自动按位号分类(如 R→电阻)</span></div>' +
        '<div id="pd-bom-result" class="hint"></div></div>';
    } else {
      out += '<div class="card"><h2>物料清单</h2>';
    }

    let itemsHtml = '';
    let idx = 0;
    for (const it of d.items) {
      idx++;
      const unmatched = !it.component_id;
      const rowBg = unmatched ? ' style="background:rgba(224,93,93,.07)"' : '';
      let compCell;
      if (unmatched) {
        compCell = '<span class="tag red">未匹配</span><div class="bar" style="margin-top:4px">' +
          '<button class="btn sm pd-bind" data-itid="' + it.id + '" data-name="' + U.esc(it.name) + '">绑定</button>' +
          '<button class="btn sm pd-newc" data-itid="' + it.id + '">建新元件</button></div>';
      } else {
        compCell = '<b>' + U.esc(it.component.name) + '</b> <span class="muted small">库存 ' + U.fmtNum(it.component.qty) + '</span>';
      }
      let actCell;
      if (isDraft) {
        actCell = '<button class="btn sm danger pd-del" data-itid="' + it.id + '">删行</button>';
      } else if (isAct) {
        actCell = it.shortage > 0
          ? '<button class="btn sm pd-buy" data-itid="' + it.id + '">采购 ' + U.fmtNum(it.shortage) + '</button>'
          : '<span class="tag green">已齐</span>';
      } else {
        actCell = '<span class="muted small">—</span>';
      }
      itemsHtml += '<tr data-idx="' + idx + '"' + rowBg + '>' +
        '<td class="num">' + idx + '</td>' +
        '<td>' + U.esc(it.name) + '<div class="small muted">' + U.esc(it.footprint || '封装?') + '</div></td>' +
        '<td class="small">' + U.esc(it.designator) + '</td>' +
        '<td class="num">' + U.fmtNum(it.qty_per_board) + '</td>' +
        '<td class="num"><b>' + U.fmtNum(it.needed) + '</b><div class="small muted">(×' + U.fmtNum(p.board_count) + ' ×' + p.loss_ratio_effective + '%)</div></td>' +
        '<td class="num">' + U.fmtNum(it.occupied) + '</td>' +
        '<td class="num">' + U.fmtNum(it.bought) + '</td>' +
        '<td class="num">' + (it.shortage > 0 ? '<b style="color:var(--danger)">' + U.fmtNum(it.shortage) + '</b>' : '<span class="muted">0</span>') + '</td>' +
        '<td>' + compCell + '</td>' +
        '<td>' + actCell + '</td>' +
        '</tr>';
    }
    if (!itemsHtml) itemsHtml = '<tr><td colspan="10" class="empty">尚未上传 BOM' + (isDraft ? '，请上传立创 BOM 文件' : '') + '</td></tr>';
    out += '<table><thead><tr>' +
      '<th>#</th><th>元件 / 封装</th><th>位号</th><th class="num">单板量</th><th class="num">需求量</th>' +
      '<th class="num">已占用</th><th class="num">已购买</th><th class="num">缺件</th><th>库存匹配</th><th>操作</th>' +
      '</tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
      '<div class="bar" style="margin-top:10px"><span class="muted small">缺件合计：<b style="color:var(--danger)">' + U.fmtNum(d.shortage_total) + '</b> 件</span></div></div>';

    // PCB / 钢网采购
    out += '<div class="card"><h2>PCB / 钢网采购 <span class="sub">成本在采购时填写</span></h2>';
    const kindName = { pcb: 'PCB打板', stencil: '钢网' };
    if (d.purchases.length) {
      out += '<table><thead><tr><th>类型</th><th class="num">数量</th><th class="num">成本</th><th>备注</th><th>时间</th></tr></thead><tbody>';
      for (const x of d.purchases) {
        out += '<tr><td>' + (kindName[x.kind] || x.kind) + '</td><td class="num">' + U.fmtNum(x.qty) + '</td>' +
          '<td class="num">' + U.fmtMoney(x.cost) + '</td><td class="small muted">' + U.esc(x.note) + '</td>' +
          '<td class="small muted">' + U.esc(x.created_at) + '</td></tr>';
      }
      out += '</tbody></table>';
    }
    if (d.pending_purchases.length && isAct) {
      for (const pp of d.pending_purchases) {
        out += '<div class="bar" style="margin-top:8px"><span class="tag org">待采购 ' + pp.name + ' ×' + U.fmtNum(pp.qty) + '</span>' +
          '<button class="btn sm px-buy" data-kind="' + pp.kind + '" data-qty="' + pp.qty + '">记录' + pp.name + '采购(填成本)</button></div>';
      }
    } else if (isDraft) {
      out += '<div class="muted small">确认项目后，可在此记录 PCB / 钢网的实际采购成本。</div>';
    }
    out += '</div>';

    // 返单系列
    const s = d.series;
    if (s && s.members.length) {
      let srows = '';
      for (const m of s.members) {
        const mt = this.STATUS_TAG[m.status] || 'gray';
        const mn = this.STATUS_NAME[m.status] || m.status;
        srows += '<tr data-mid="' + m.id + '">' +
          '<td><a class="link s-open">' + U.esc(m.name) + '</a>' + (m.id === pid ? ' <span class="tag blue">当前</span>' : '') + '</td>' +
          '<td><span class="tag ' + mt + '">' + mn + '</span></td>' +
          '<td class="num">' + U.fmtNum(m.board_count) + '</td>' +
          '<td class="num">' + U.fmtMoney(m.cost_total) + '</td>' +
          '<td class="num">' + (m.revenue == null ? '—' : U.fmtMoney(m.revenue)) + '</td>' +
          '<td class="num">' + (m.revenue == null ? '—' : U.fmtMoney(m.revenue - m.cost_total)) + '</td></tr>';
      }
      out += '<div class="card"><h2>返单系列 <span class="sub">同系列全部批次</span></h2>' +
        '<table><thead><tr><th>批次</th><th>状态</th><th class="num">板数</th><th class="num">成本</th><th class="num">收益</th><th class="num">毛利</th></tr></thead><tbody>' + srows + '</tbody></table>' +
        '<div class="bar" style="margin-top:10px"><span class="muted small">系列合计：成本 ' + U.fmtMoney(s.total_cost) + ' · 收益 ' + U.fmtMoney(s.total_revenue) + ' · 毛利 <b>' + U.fmtMoney(s.total_profit) + '</b></span></div>' +
        '</div>';
      // 收益趋势（简单文字）
      const paidMany = s.members.filter(m => m.revenue != null).map(m => m.revenue - m.cost_total);
      if (paidMany.length > 1) {
        const trend = paidMany.map(x => U.fmtMoney(x)).join(' → ');
        out += '<div class="card"><h2>系列毛利趋势</h2><div class="muted small">按批次顺序：' + U.esc(trend) + '</div></div>';
      }
    }

    // 操作区
    if (isDraft) {
      const unbound = d.items.filter(i => !i.component_id).length;
      out += '<div class="card"><div class="bar">' +
        '<button class="btn green" id="pd-confirm"' + (unbound || !d.items.length ? ' disabled' : '') + '>✓ 确认项目（占用库存，进入进行中）</button>' +
        (unbound ? '<span class="muted small">还有 ' + unbound + ' 行未匹配</span>' : '') +
        '</div></div>';
    } else if (p.status === 'in_progress') {
      out += '<div class="card"><div class="bar">' +
        '<button class="btn green" id="pd-complete"' + (d.shortage_total > 0 ? ' disabled' : '') + '>已完成（需缺件补齐）</button>' +
        (d.shortage_total > 0 ? '<span class="muted small">尚有 ' + U.fmtNum(d.shortage_total) + ' 件缺件，补齐后才能完成</span>' : '') +
        '<span class="muted small">｜ 关闭=退回元件并删除项目</span></div></div>';
    } else if (isDone) {
      out += '<div class="card"><div class="bar"><span class="tag green">已完成</span> ' +
        '<span class="muted small">可填写收益、或点击 ↻ 返单 制作下一批</span></div></div>';
    }

    container.innerHTML = out;

    container.querySelector('#pd-back').addEventListener('click', () => { this.currentId = null; this.loadList(container); });
    if (container.querySelector('#pd-edit')) container.querySelector('#pd-edit').addEventListener('click', () => this.editProject(p));
    if (container.querySelector('#pd-bomgo')) container.querySelector('#pd-bomgo').addEventListener('click', () => this.uploadBom(pid, container));
    if (container.querySelector('#pd-confirm')) container.querySelector('#pd-confirm').addEventListener('click', () => this.confirmProject(pid, container));
    if (container.querySelector('#pd-complete')) container.querySelector('#pd-complete').addEventListener('click', () => this.completeProject(pid, container));
    if (container.querySelector('#pd-close')) container.querySelector('#pd-close').addEventListener('click', () => this.closeProject(pid, container));
    if (container.querySelector('#pd-profit')) container.querySelector('#pd-profit').addEventListener('click', () => this.setRevenue(pid, container, p.revenue));
    if (container.querySelector('#pd-redo')) container.querySelector('#pd-redo').addEventListener('click', () => this.redoProject(pid, container));

    // PCB/钢网 记录采购
    container.querySelectorAll('.px-buy').forEach(b => {
      b.addEventListener('click', () => this.recordExtra(pid, b.dataset.kind, Number(b.dataset.qty), container));
    });
    // 系列跳转
    container.querySelectorAll('.s-open').forEach(a => {
      a.addEventListener('click', () => {
        const mid = Number(a.closest('tr[data-mid]').dataset.mid);
        this.currentId = mid;
        this.render(container);
      });
    });
    // item 级操作
    const ditems = d.items;
    container.querySelectorAll('.pd-bind').forEach(btn => this.bindItem(pid, btn, comps));
    container.querySelectorAll('.pd-newc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const it = ditems.find(x => x.id === Number(btn.dataset.itid));
        if (!it) return;
        try { await Api.post('/projects/' + pid + '/items/' + it.id + '/newcomponent'); U.toast('已创建并绑定'); await this.loadDetail(container, pid); }
        catch (e) { U.toast(e.message, 'err'); }
      });
    });
    container.querySelectorAll('.pd-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const it = ditems.find(x => x.id === Number(btn.dataset.itid));
        if (it) this.buyItem(pid, it, container);
      });
    });
    container.querySelectorAll('.pd-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const it = ditems.find(x => x.id === Number(btn.dataset.itid));
        if (!it) return;
        if (!await U.confirmDlg('删除该 BOM 行「' + it.name + '」？')) return;
        try { await Api.del('/projects/' + pid + '/items/' + it.id); U.toast('已删除'); await this.loadDetail(container, pid); }
        catch (e) { U.toast(e.message, 'err'); }
      });
    });
  },

  async uploadBom(pid, main) {
    const file = main.querySelector('#pd-bom').files[0];
    if (!file) { U.toast('请先选择 BOM 文件', 'warn'); return; }
    const fd = new FormData();
    fd.append('file', file);
    const btn = main.querySelector('#pd-bomgo');
    btn.disabled = true;
    try {
      const r = await Api.post('/projects/' + pid + '/bom', fd, true);
      U.toast('解析完成：' + r.matched + '/' + r.total + ' 自动匹配');
      await this.loadDetail(main, pid);
    } catch (e) { U.toast(e.message, 'err'); btn.disabled = false; }
  },

  bindItem(pid, btn, comps) {
    btn.addEventListener('click', () => {
      const itemId = Number(btn.dataset.itid);
      const targetName = btn.dataset.name || '';
      const options = comps.map(c => '<option value="' + c.id + '">' + U.esc(c.name) + ' · ' + U.esc(c.footprint || '无封装') + '（库存 ' + c.qty + '）</option>').join('');
      const body = '<label class="f">待匹配：<b>' + U.esc(targetName) + '</b></label>' +
        '<label class="f">搜索：<input type="text" id="bd-q" placeholder="按名称/封装过滤…"></label>' +
        '<label class="f">选择要绑定的元件：<select id="bd-sel" size="8" style="height:auto">' + (options || '<option value="0">（元件库为空）</option>') + '</select></label>';
      U.modal('绑定元件', body, {
        onok: (box) => {
          const cid = Number(box.querySelector('#bd-sel').value);
          if (!cid) { U.toast('请选择元件', 'err'); return false; }
          return Api.post('/projects/' + pid + '/items/' + itemId + '/bind', { component_id: cid }).then(async () => {
            U.toast('已绑定'); await this.loadDetail(document.getElementById('main'), pid);
          }).catch(e => { U.toast(e.message, 'err'); return false; });
        }
      });
      document.getElementById('bd-q').addEventListener('input', () => {
        const kw = document.getElementById('bd-q').value.trim().toLowerCase();
        [...document.getElementById('bd-sel').options].forEach(o => { o.hidden = !!kw && o.text.toLowerCase().indexOf(kw) < 0; });
      });
    });
  },

  async confirmProject(pid, container) {
    if (!await U.confirmDlg('确认项目后将按需求量扣除库存（不足部分即为缺件），进入「进行中」。继续？')) return;
    try { await Api.post('/projects/' + pid + '/confirm'); U.toast('已确认，项目进行中'); await this.loadDetail(container, pid); }
    catch (e) { U.toast(e.message, 'err'); }
  },

  async completeProject(pid, container) {
    if (!await U.confirmDlg('标记为已完成？消耗的元件将不再退回（缺件需全部补齐才能完成）。')) return;
    try { await Api.post('/projects/' + pid + '/complete'); U.toast('已完成'); await this.loadDetail(container, pid); }
    catch (e) { U.toast(e.message, 'err'); }
  },

  async closeProject(pid, container) {
    if (!await U.confirmDlg('关闭将退回该项目全部占用的元件，并彻底删除该项目（不可恢复）。确定？')) return;
    try {
      await Api.post('/projects/' + pid + '/close');
      U.toast('已关闭删除，元件已退回');
      this.currentId = null;
      await this.loadList(document.getElementById('main'));
    } catch (e) { U.toast(e.message, 'err'); }
  },

  async redoProject(pid, container) {
    const v = await U.ask('返单：这一批要做几块板？', '1');
    if (v == null) return;
    try {
      const r = await Api.post('/projects/' + pid + '/clone', { board_count: Number(v) || 1 });
      U.toast('已创建：' + r.name);
      this.currentId = r.id;
      await this.render(container);
    } catch (e) { U.toast(e.message, 'err'); }
  },

  async recordExtra(pid, kind, qty, container) {
    const names = { pcb: 'PCB打板', stencil: '钢网' };
    const body = '<label class="f">采购：<b>' + names[kind] + '</b></label>' +
      '<label class="f">数量<input type="number" id="x-q" min="1" value="' + qty + '"></label>' +
      '<label class="f">实际成本(元)<input type="number" id="x-c" min="0" step="0.01"></label>' +
      '<label class="f">备注<input type="text" id="x-n"></label>';
    U.modal('记录 ' + names[kind] + ' 采购', body, {
      onok: (box) => {
        const q = Math.floor(Number(box.querySelector('#x-q').value || 0));
        const c = Number(box.querySelector('#x-c').value || 0);
        if (q <= 0) { U.toast('数量需为正数', 'err'); return false; }
        return Api.post('/projects/' + pid + '/purchases', { kind: kind, qty: q, cost: c, note: box.querySelector('#x-n').value.trim() }).then(async () => {
          U.toast('已记录'); await this.loadDetail(document.getElementById('main'), pid);
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  },

  async setRevenue(pid, container, cur) {
    const v = await U.ask('填写收益 / 售价（元）', cur == null ? '' : cur);
    if (v == null) return;
    try { await Api.post('/projects/' + pid + '/revenue', { revenue: Number(v) || 0 }); U.toast('收益已更新'); await this.loadDetail(container, pid); }
    catch (e) { U.toast(e.message, 'err'); }
  },

  async buyItem(pid, it, container) {
    const body = '<label class="f">元件：<b>' + U.esc(it.name) + '</b></label>' +
      '<label class="f">缺件 <b style="color:var(--danger)">' + U.fmtNum(it.shortage) + '</b> 件 · 已购 ' + U.fmtNum(it.bought) + ' 件</label>' +
      '<label class="f">购买数量<input type="number" id="by-q" min="1" value="' + it.shortage + '"></label>' +
      '<label class="f">单价(元/个)<input type="number" id="by-p" min="0" step="0.001" value="' + (it.bought_cost && it.bought ? (it.bought_cost / it.bought).toFixed(4) : '') + '"></label>' +
      '<div class="hint">采购后自动入库并补齐缺件：缺 6 买 10 → 6 件补本项目、4 件入库存。</div>';
    U.modal('采购入库', body, {
      onok: (box) => {
        const qty = Math.floor(Number(box.querySelector('#by-q').value || 0));
        const price = Number(box.querySelector('#by-p').value || 0);
        if (qty <= 0) { U.toast('请输入正确的购买数量', 'err'); return false; }
        return Api.post('/projects/' + pid + '/purchase', { items: [{ item_id: it.id, qty: qty, unit_price: price }] }).then(async () => {
          U.toast('已入库 ' + qty + ' 件'); await this.loadDetail(document.getElementById('main'), pid);
        }).catch(e => { U.toast(e.message, 'err'); return false; });
      }
    });
  }
};
