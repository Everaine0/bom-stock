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
      '<label class="f">全局损耗比 %<small class="muted">（新建项目默认使用；每个项目可单独覆盖）</small>' +
      '<input type="number" id="s-loss" min="0" step="0.1" value="' + s.default_loss_ratio + '"></label>' +
      '<div class="bar"><button class="btn primary" id="s-save">保存</button></div>' +
      '<div class="hint">说明：需求量 = BOM数量 × 板数 × (1 + 损耗%)，向上取整；缺件与扣库存均按此计算。</div>' +
      '</div>';
    container.querySelector('#s-save').addEventListener('click', async () => {
      const v = Number(document.getElementById('s-loss').value || 0);
      try {
        await Api.put('/settings', { default_loss_ratio: v });
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
      '<p class="muted small">导出的 JSON 包含元件库、出入库流水、全部项目与设置。恢复会<b>整体替换</b>当前数据（恢复前会自动在当前数据目录留一份 pre-import 备份）。</p>' +
      '<div class="bar" style="margin:14px 0 8px"><a class="btn primary" href="/api/backup">⬇ 导出备份 JSON</a></div>' +
      '<div class="bar"><input type="file" id="bk-file" accept=".json"><button class="btn" id="bk-import">恢复此备份</button></div>' +
      '<div class="hint">数据文件位于运行目录的 data/ 下（Docker 模式挂载到宿主机 ./data/），整个复制该目录也可离线备份。</div>' +
      '</div>';
    container.querySelector('#bk-import').addEventListener('click', async () => {
      const file = document.getElementById('bk-file').files[0];
      if (!file) { U.toast('请先选择备份 JSON 文件', 'warn'); return; }
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
