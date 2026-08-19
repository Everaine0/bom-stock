'use strict';
/* 设置页 */
window.Views = window.Views || {};

window.Views.settings = {
  async render(container) {
    let s;
    try { s = await Api.get('/settings'); }
    catch (e) { container.innerHTML = '<div class="danger-box">加载失败：' + U.esc(e.message) + '</div>'; return; }
    container.innerHTML =
      '<div class="card" style="max-width:560px"><h2>设置</h2>' +
      '<label class="f">全局损耗比 %<small class="muted">（新建项目默认，可单独覆盖）</small>' +
      '<input type="number" id="s-loss" min="0" step="0.1" value="' + s.default_loss_ratio + '"></label>' +
      '<label class="f">低库存预警阈值（件）' +
      '<input type="number" id="s-low" min="0" step="1" value="' + s.low_stock_threshold + '"></label>' +
      '<button class="btn primary" id="s-save">保存</button>' +
      '</div>';
    container.querySelector('#s-save').addEventListener('click', async () => {
      const v = Number(document.getElementById('s-loss').value || 0);
      const low = Number(document.getElementById('s-low').value || 0);
      try {
        await Api.put('/settings', { default_loss_ratio: v, low_stock_threshold: low });
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
