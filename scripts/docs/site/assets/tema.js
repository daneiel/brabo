/* Tema antes do primeiro paint; ARQUIVO, nunca inline (igual a apps/web/public/theme-boot.js). Chave própria do site. */
(function () {
  var tema = 'dark';
  try {
    var s = window.localStorage.getItem('brabo.docs.theme');
    if (s === 'dark' || s === 'light') tema = s;
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', tema);
  document.documentElement.classList.toggle('dark', tema === 'dark'); // o Redoc da referência da API lê a classe
})();
