'use strict';
/* 设置页：基本(损耗/阈值) + 存放位置(每类别前缀/每盒槽位数/槽位位数) + 封装预设(每类别) */
window.Views = window.Views || {};

const SET_CATS = ['电阻', '电容', '电感', 'IC', '晶振', '连接器', 'LED', '保险丝', '其他'];

window.Views.settings = {
  async render(container) {
    let s;
    try { s = await Api.get('/settings'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    const prefix = s.location_prefix || {};
    const presets = s.footprint_presets || {};

    const pfxRow = SET_CATS.map((c, i) =>
      '<div class="pfx-item"><span class="pref-k">' + U.esc(c) + '</span>' +
      '<input type="text" id="pfx-' + i + '" maxlength="4" placeholder="如 R" value="' + U.esc(prefix[c] || '') + '">' +
      '<span class="pref-exp">' + U.esc((prefix[c] || 'X') + '1-01') + '</span></div>'
    ).join('');
    const fpRow = SET_CATS.map((c, i) =>
      '<div class="fp-item"><span class="pref-k">' + U.esc(c) + '</span>' +
      '<textarea id="fp-' + i + '" rows="2" placeholder="如 C0402, C0603, C0805…">' + U.esc((presets[c] || []).join(', ')) + '</textarea></div>'
    ).join('');

    container.innerHTML =
      '<div class="card" style="max-width:980px"><h2>设置</h2>' +
      '<div class="set-sec"><h3>基本</h3>' +
      '<div class="row2">' +
      '<label class="f">全局损耗比 %<small class="muted">（新建项目默认，可单独覆盖）</small>' +
      '<input type="number" id="s-loss" min="0" step="0.1" value="' + s.default_loss_ratio + '"></label>' +
      '<label class="f">全局低库存预警阈值(件)<small class="muted">（元件未单独设阈值时用此值，绿>阈值 / 黄≥0<库存≤阈值 / 红=0）</small>' +
      '<input type="number" id="s-low" min="0" step="1" value="' + s.low_stock_threshold + '"></label>' +
      '</div></div>' +

      '<div class="set-sec"><h3>存放位置</h3>' +
      '<p class="muted small" style="margin-bottom:10px">格式：类别前缀 + 盒子序号 + 槽位编号（如 R1-01）。新增元件/从 BOM 建元件时“自动分配”会在该类别下找最小空位置。</p>' +
      '<div class="row2">' +
      '<label class="f">每个盒子的槽位数量<input type="number" id="s-slots" min="1" max="999" step="1" value="' + (s.slots_per_box || 8) + '"></label>' +
      '<label class="f">槽位编号位数<small class="muted">（如 2 → 01）</small><input type="number" id="s-digits" min="1" max="4" step="1" value="' + (s.slot_digits || 2) + '"></label>' +
      '</div>' +
      '<div class="pfx-grid">' + pfxRow + '</div></div>' +

      '<div class="set-sec"><h3>封装预设<small class="muted">（新增/编辑元件时，封装框按类别给出下拉选项）</small></h3>' +
      '<div class="fp-grid">' + fpRow + '</div></div>' +

      '<div class="bar" style="margin-top:6px"><button class="btn primary" id="s-save">保存设置</button></div>' +
      '</div>';

    container.querySelector('#s-save').addEventListener('click', async () => {
      const location_prefix = {};
      const footprint_presets = {};
      SET_CATS.forEach((c, i) => {
        const p = container.querySelector('#pfx-' + i).value.trim();
        if (p) location_prefix[c] = p;
        const fp = container.querySelector('#fp-' + i).value
          .split(/[,，;；\n]/).map(x => x.trim()).filter(Boolean);
        if (fp.length) footprint_presets[c] = fp;
      });
      const body = {
        default_loss_ratio: Number(document.getElementById('s-loss').value || 0),
        low_stock_threshold: Number(document.getElementById('s-low').value || 0),
        slots_per_box: Number(document.getElementById('s-slots').value || 8),
        slot_digits: Number(document.getElementById('s-digits').value || 2),
        location_prefix,
        footprint_presets
      };
      try {
        await Api.put('/settings', body);
        U.toast('已保存');
      } catch (e) { U.toast(e.message, 'err'); }
    });
  }
};

/* 备份页 */
window.Views.backup = {
  async render(container) {
    container.innerHTML =
      '<div class="card" style="max-width:560px"><h2>数据备份 / 恢复</h2>' +
      '<div class="bar" style="margin-bottom:18px"><a class="btn primary" href="/api/backup">⬇ 导出备份</a></div>' +
      '<div class="dropzone" id="bk-dz">' +
      '<svg class="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v7"/><path d="m8.8 13.2 3.2 3.2 3.2-3.2"/><path d="M12 3v6"/><path d="M5 9h2l2-3 2 4h2l1.5-2h4.5"/><path d="M4.5 15.5v1.8a1.7 1.7 0 0 0 1.7 1.7h11.6a1.7 1.7 0 0 0 1.7-1.7v-1.8"/></svg>' +
      '<div class="dz-name muted">选择备份 JSON 文件恢复</div>' +
      '<input type="file" id="bk-file" accept=".json" style="display:none">' +
      '</div>' +
      '<div class="bar" style="margin-top:14px;display:none" id="bk-actions">' +
      '<span class="muted small" id="bk-name"></span><span class="spacer"></span>' +
      '<button class="btn danger" id="bk-import">恢复此备份</button></div>' +
      '</div>';

    const dz = container.querySelector('#bk-dz');
    const fileInput = container.querySelector('#bk-file');
    const actions = container.querySelector('#bk-actions');
    const nameEl = container.querySelector('#bk-name');
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      nameEl.textContent = f.name;
      actions.style.display = 'flex';
    });
    container.querySelector('#bk-import').addEventListener('click', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!await U.confirmDlg('将用该备份整体替换当前数据，确定继续？')) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const r = await Api.post('/backup/import', fd, true);
        U.toast('恢复成功，元件 ' + r.restored_components + ' 种');
        App.go('overview');
      } catch (e) { U.toast(e.message, 'err'); }
    });
  }
};
