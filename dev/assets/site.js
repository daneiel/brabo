/* Menu móvel, alternar tema, seletores de idioma/degrau, Mermaid nas cores do tema. A busca é da lane A4. */
(function () {
  var d = document;
  d.querySelectorAll('[data-seletor]').forEach(function (s) {
    s.addEventListener('change', function () { window.location.href = s.value; });
  });
  var menu = d.querySelector('[data-menu-alternar]');
  if (menu) menu.addEventListener('click', function () { d.body.classList.toggle('menu-aberto'); });
  function mermaidTema() {
    if (!window.mermaid) return;
    var cs = getComputedStyle(d.documentElement);
    var v = function (n) { return cs.getPropertyValue(n).trim(); };
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        background: v('--surface-0'), primaryColor: v('--surface-2'), primaryTextColor: v('--text-primary'),
        primaryBorderColor: v('--border-strong'), lineColor: v('--text-secondary'), fontFamily: v('--font-body'),
      },
    });
    d.querySelectorAll('[data-mermaid]').forEach(function (el) {
      if (!el.dataset.fonte) el.dataset.fonte = el.textContent;
      el.removeAttribute('data-processed');
      el.textContent = el.dataset.fonte;
    });
    window.mermaid.run({ querySelector: '[data-mermaid]' });
  }
  var alt = d.querySelector('[data-tema-alternar]');
  if (alt) alt.addEventListener('click', function () {
    var novo = d.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    d.documentElement.setAttribute('data-theme', novo);
    try { window.localStorage.setItem('brabo.docs.theme', novo); } catch (e) {}
    mermaidTema();
  });
  mermaidTema();
})();
