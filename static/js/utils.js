'use strict';
/* 通用工具 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) {
    n = Number(n || 0);
    return isFinite(n) ? n.toLocaleString('zh-CN') : '0';
  }
  function fmtMoney(n) {
    n = Number(n || 0);
    return '¥' + (isFinite(n) ? n.toFixed(2) : '0.00');
  }
  function toast(msg, type) {
    var r = document.getElementById('toast-root');
    var d = document.createElement('div');
    d.className = 'toast' + (type === 'err' ? ' err' : type === 'warn' ? ' warn' : '');
    d.textContent = msg;
    r.appendChild(d);
    setTimeout(function () { d.remove(); }, type === 'err' ? 5000 : 3000);
  }
  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
  }
  // 打开模态框；opts.onok(body) 返回 false 阻止关闭
  function modal(title, bodyHTML, opts) {
    opts = opts || {};
    var root = document.getElementById('modal-root');
    closeModal();
    var box = document.createElement('div');
    box.className = 'box' + (opts.wide ? ' wide' : '');
    box.innerHTML =
      '<div class="mh"><span>' + esc(title) + '</span><button class="mx" title="关闭">×</button></div>' +
      '<div class="mb">' + bodyHTML + '</div>' +
      (opts.footer === false ? '' :
        '<div class="mf"><button class="btn mk">' + esc(opts.okText || '确定') + '</button></div>');
    var ov = document.createElement('div');
    ov.className = 'ov';
    ov.appendChild(box);
    root.appendChild(ov);
    function bye() { if (!opts.onClose || opts.onClose() !== false) closeModal(); }
    box.querySelector('.mx').addEventListener('click', bye);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) bye(); });
    var ok = box.querySelector('.mk');
    if (ok) {
      ok.addEventListener('click', function () {
        if (opts.onok) {
          var r = opts.onok(box);
          if (r === false) return;
        }
        closeModal();
      });
    }
    return box;
  }
  function ask(question, def) {
    return new Promise(function (resolve) {
      var box = modal(question, '<input type="text" id="askval" value="' + esc(def == null ? '' : def) + '" placeholder="请输入">',
        {
          okText: '确定',
          onok: function (b) {
            var v = b.querySelector('#askval').value.trim();
            if (!v) { toast('不能为空', 'err'); return false; }
            resolve(v);
          }
        });
      // 允许关闭如果不填
      box.querySelector('.mx').addEventListener('click', function () { resolve(null); });
    });
  }
  function confirmDlg(message) {
    return new Promise(function (resolve) {
      modal('确认', '<p>' + esc(message) + '</p>',
        {
          okText: '确认',
          onClose: function () { resolve(false); },
          onok: function () { resolve(true); }
        });
    });
  }
  window.U = { esc: esc, fmtNum: fmtNum, fmtMoney: fmtMoney, toast: toast, modal: modal, closeModal: closeModal, ask: ask, confirmDlg: confirmDlg };
})();
