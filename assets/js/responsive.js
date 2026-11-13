/* 响应式兜底：自动把所有 .table 包进 .table-scroll 横向滚动容器，
   避免表格在手机窄屏把页面撑出横向滚动条。对动态渲染的表格也生效。 */
(function () {
  function wrapTables(root) {
    (root || document).querySelectorAll('table.table').forEach(function (t) {
      if (t.parentElement && t.parentElement.classList.contains('table-scroll')) return;
      var w = document.createElement('div');
      w.className = 'table-scroll';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
  }
  function init() {
    wrapTables(document);
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType === 1) wrapTables(n);
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
