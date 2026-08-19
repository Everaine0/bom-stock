'use strict';
/* 后端 API 封装 */
(function () {
  async function req(method, path, body, isForm) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) {
      if (isForm) opt.body = body;
      else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    }
    var r = await fetch('/api' + path, opt);
    var ct = r.headers.get('content-type') || '';
    var data;
    if (ct.indexOf('application/json') >= 0) data = await r.json();
    else data = await r.text();
    if (!r.ok) {
      var msg = (data && (data.detail || data.message)) || ('请求失败 ' + r.status);
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      throw new Error(msg);
    }
    return data;
  }
  window.Api = {
    get: function (p) { return req('GET', p); },
    post: function (p, b, isForm) { return req('POST', p, b, isForm); },
    put: function (p, b) { return req('PUT', p, b); },
    del: function (p) { return req('DELETE', p); }
  };
})();
