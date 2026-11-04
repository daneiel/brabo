// Busca do site: substring normalizada sobre o índice do locale, carregado ao focar o campo.
(function (g) {
  var norm = function (s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  // Título casa primeiro; limite de 20 resultados.
  function buscar(indice, termo) {
    var q = norm(termo);
    if (!q) return [];
    var a = [], b = [];
    indice.forEach(function (p) {
      if (norm(p.t).indexOf(q) >= 0) a.push(p);
      else if (p.x.indexOf(q) >= 0) b.push(p);
    });
    return a.concat(b).slice(0, 20);
  }
  g.BrabuBusca = { normalizar: norm, buscar: buscar };
  if (typeof document === 'undefined') return;
  var s = document.currentScript;
  var campo = document.querySelector('[data-busca]');
  var lista = document.querySelector('[data-busca-lista]');
  if (!s || !campo || !lista) return;
  var indice = null, carregando = false;
  function desenhar() {
    lista.textContent = '';
    if (!indice) return;
    buscar(indice, campo.value).forEach(function (p) {
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = s.dataset.base + p.u + '.html';
      a.textContent = p.t;
      li.appendChild(a);
      lista.appendChild(li);
    });
  }
  function carregar() {
    if (indice || carregando) return;
    carregando = true;
    fetch(s.dataset.indice).then(function (r) { return r.json(); }).then(function (j) { indice = j; desenhar(); })
      .catch(function () { carregando = false; });
  }
  campo.addEventListener('focus', carregar);
  campo.addEventListener('input', function () { carregar(); desenhar(); });
})(typeof window !== 'undefined' ? window : globalThis);
