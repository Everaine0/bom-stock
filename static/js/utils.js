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

  /* ============================================================
     单位等价换算
     - 电容：uF / nF / pF / mF 互转 + EIA 三位/四位码（如 1uF -> 105）
     - 电阻：k / M / meg / 4R7 写法 → Ω + EIA 码
     - 电感：mH / uH / nH 互转
     用于：新增元件时自动生成等价别名；元件库搜索单位等价匹配
     ============================================================ */

  // 解析「数值+单位」，返回 {kind:'cap'|'res'|'ind', base: 基准值} 或 null
  function parseNumUnit(s) {
    s = String(s || '').trim().toLowerCase().replace(/[μµ]/g, 'u').replace(/\s+/g, '');
    if (!s) return null;
    function num(v) { var f = parseFloat(v); return isFinite(f) ? f : null; }
    // 电容 1uf / 100nf / 22pf / 0.47mF
    var m = s.match(/^(\d+\.?\d*)(p|n|u|m)f$/);
    if (m) { var v = num(m[1]); if (v == null) return null;
      return { kind: 'cap', base: v * ({ p: 1, n: 1000, u: 1000000, m: 1000000000 })[m[2]] }; }
    // 电感 100nh / 10uh / 2.2mh
    m = s.match(/^(\d+\.?\d*)(n|u|m)h$/);
    if (m) { var v2 = num(m[1]); if (v2 == null) return null;
      return { kind: 'ind', base: v2 * ({ n: 1, u: 1000, m: 1000000 })[m[2]] }; } // 基准 nH
    // 电阻 1k / 4.7k / 10m / 6.8meg / 100Ω / 100 / 4R7
    m = s.match(/^(\d+\.?\d*)(k|meg|m)?(Ω|\u03c9|ohm)?$/);
    if (m) { var v3 = num(m[1]); if (v3 == null) return null;
      var pre = m[2] || '';
      var base = pre === 'k' ? v3 * 1000 : (pre === 'm' || pre === 'meg') ? v3 * 1000000 : v3;
      return { kind: 'res', base: base }; }
    m = s.match(/^(\d+)r(\d+)$/);
    if (m) { return { kind: 'res', base: parseInt(m[1], 10) + parseInt(m[2], 10) / Math.pow(10, m[2].length) }; }
    return null;
  }

  // 去掉浮点尾巴：0.10000000000000001 -> 0.1 ；整数按整数输出
  function fmtNumTidy(n) {
    var r = n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    return r;
  }

  // EIA 编码：base（pF 或 Ω 整数）→ '104' / '1004' 之类
  function eiaCode(base, digits) {
    var n = Math.round(base);
    if (n <= 0 || !isFinite(n)) return null;
    var exp, mant;
    if (digits === 3) { exp = Math.floor(Math.log10(n)) - 1; mant = n / Math.pow(10, exp); if (mant < 10 || mant >= 100) return null; }
    else { exp = Math.floor(Math.log10(n)) - 2; mant = n / Math.pow(10, exp); if (mant < 100 || mant >= 1000) return null; }
    if (exp < 0 || exp > 9) return null;
    var mm = Math.round(mant);
    if (Math.abs(mant - mm) > 1e-6) return null;
    return String(mm) + String(exp);
  }

  function addU(out, x) { if (x && out.indexOf(x) < 0) out.push(x); }

  // 根据名称/规格生成等价别名（供同类型别名自动预填）
  // 规则按元件类型生成，避免歧义：
  //  电容(基准pF)：pF/nF/uF 单位互转 + EIA 三位码（如 1uF -> 1000nF,1000000pF,105）
  //  电阻(基准Ω)：Ω 展开 + k/M 简写（如 1k -> 1000Ω,1kΩ）；小阻值低位写法 4R7；不生成 EIA 码（易与电容混淆）
  //  电感(基准nH)：nH/uH/mH 单位互转
  function genAliases(value, category) {
    var out = [];
    var p = parseNumUnit(value);
    if (!p) return out;
    if (p.kind === 'cap') {
      var pf = p.base;
      addU(out, fmtNumTidy(pf) + 'pf');
      if (pf % 1000 === 0) addU(out, fmtNumTidy(pf / 1000) + 'nf');
      if (pf % 1000000 === 0) addU(out, fmtNumTidy(pf / 1000000) + 'uf');
      if (pf % 1000000000 === 0) addU(out, fmtNumTidy(pf / 1000000000) + 'mf');
      var c3 = eiaCode(pf, 3); if (c3) addU(out, c3);
    } else if (p.kind === 'res') {
      var ohm = p.base;
      addU(out, fmtNumTidy(ohm) + 'Ω');
      // k/M 简写：能整除 1e6（用 M 表示）时不再给出 2000k 式冗余
      if (ohm % 1000 === 0 && ohm % 1000000 !== 0) { addU(out, fmtNumTidy(ohm / 1000) + 'k'); addU(out, fmtNumTidy(ohm / 1000) + 'kΩ'); }
      if (ohm % 1000000 === 0) { addU(out, fmtNumTidy(ohm / 1000000) + 'M'); addU(out, fmtNumTidy(ohm / 1000000) + 'MΩ'); }
      if (ohm > 0 && ohm < 10 && (Math.round(ohm * 1000) / 1000) % 1 !== 0) { // 低位电阻 4R7 写法
        var s = String(Math.round(ohm * 1000) / 1000);
        var ip = s.indexOf('.');
        if (ip > 0) { var frac = s.slice(ip + 1); if (frac.length <= 3) addU(out, s.slice(0, ip) + 'R' + frac); }
      }
    } else if (p.kind === 'ind') {
      var nh = p.base;
      addU(out, fmtNumTidy(nh) + 'nH');
      if (nh % 1000 === 0) addU(out, fmtNumTidy(nh / 1000) + 'uH');
      if (nh % 1000000 === 0) addU(out, fmtNumTidy(nh / 1000000) + 'mH');
    }
    return out;
  }

  // 单位等价匹配：query 与文本（名称/封装/别名/位置）是否等价
  function unitEqMatch(query, text) {
    var q = parseNumUnit(query);
    if (!q) return false;
    var hit = false;
    String(text || '').toLowerCase()
      .replace(/[μµ]/g, 'u')
      .replace(/(\d+\.?\d*r\d+|\d+\.?\d*(?:[pnum]\s*f|[num]\s*h|[kmeg](?:\u03a9|Ω)?|Ω|ohm)?)/g, function (tok) {
        var p = parseNumUnit(tok);
        if (p && p.kind === q.kind && Math.abs(p.base - q.base) < 1e-9) hit = true;
        return tok;
      });
    return hit;
  }
  window.U = { esc: esc, fmtNum: fmtNum, fmtMoney: fmtMoney, toast: toast, modal: modal, closeModal: closeModal, ask: ask, confirmDlg: confirmDlg, parseNumUnit: parseNumUnit, genAliases: genAliases, unitEqMatch: unitEqMatch };
})();
