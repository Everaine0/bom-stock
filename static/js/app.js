'use strict';
/* 应用入口：侧边栏导航与视图切换 */
window.App = {
  currentView: 'overview',
  go(view) {
    this.currentView = view;
    document.querySelectorAll('#nav button').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    const main = document.getElementById('main');
    main.innerHTML = '<div class="loading">加载中…</div>';
    const v = window.Views[view];
    if (!v) { main.innerHTML = '<div class="danger-box">未找到视图：' + U.esc(view) + '</div>'; return; }
    v.render(main).catch(e => {
      main.innerHTML = '<div class="danger-box">渲染失败：' + U.esc(e.message) + '</div>';
      U.toast(e.message, 'err');
    });
  }
};

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('#nav button').forEach(b => {
    b.addEventListener('click', () => App.go(b.dataset.view));
  });
  App.go('overview');
});
