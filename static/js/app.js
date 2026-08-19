'use strict';
/* 应用入口：主题切换 + 移动端抽屉导航 + 视图切换 */
(function () {
  // ---------- 主题 ----------
  var root = document.documentElement;
  var labelEl = document.querySelectorAll('.theme-label');
  function applyThemeUI() {
    var light = root.getAttribute('data-theme') === 'light';
    labelEl.forEach(function (el) { el.textContent = light ? '浅色' : '深色'; });
  }
  function toggleTheme() {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('bom-theme', next); } catch (e) {}
    applyThemeUI();
  }
  document.querySelectorAll('.theme-toggle').forEach(function (b) {
    b.addEventListener('click', toggleTheme);
  });
  applyThemeUI();

  // ---------- 移动端抽屉 ----------
  var menuBtn = document.getElementById('menu-btn');
  var scrim = document.getElementById('scrim');
  function setNav(open) { document.body.classList.toggle('nav-open', open); }
  if (menuBtn) menuBtn.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });

  // ---------- 视图切换 ----------
  window.App = {
    currentView: 'overview',
    go(view) {
      this.currentView = view;
      document.querySelectorAll('#nav button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.view === view);
      });
      var main = document.getElementById('main');
      main.innerHTML = '<div class="loading">加载中…</div>';
      var v = window.Views[view];
      if (!v) { main.innerHTML = '<div class="danger-box">未找到视图：' + U.esc(view) + '</div>'; return; }
      v.render(main).catch(function (e) {
        main.innerHTML = '<div class="danger-box">渲染失败：' + U.esc(e.message) + '</div>';
        U.toast(e.message, 'err');
      });
      if (window.innerWidth <= 900) setNav(false); // 移到主区后收起抽屉
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('#nav button').forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.dataset.view); });
    });
    App.go('overview');
  });
})();
