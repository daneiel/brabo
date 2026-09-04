/*
 * Aplica o tema ANTES do primeiro paint (RN-182, ADR 0074).
 *
 * Por que é um ARQUIVO e não um `<script>` inline no `index.html`: a CSP da
 * imagem de produção (`docker/web/nginx.conf`) é `script-src 'self'` — sem
 * `'unsafe-inline'` e sem nonce. Um script inline no head funcionaria em
 * `pnpm dev:web` e seria BLOQUEADO em produção, que é exatamente a falha que o
 * ADR 0036 fechou com as fontes: o handoff pedia um `<link>` externo, a CSP o
 * barrava, e o sintoma só aparecia na imagem publicada. Arquivo próprio serve
 * do mesmo origin e passa. O `/config.js` ao lado dele já existe pelo mesmo
 * motivo.
 *
 * Por que é SÍNCRONO e vem antes do bundle: `data-theme` decide as cores de
 * TODO o `design/tokens.css`. Aplicado depois da hidratação, o usuário do tema
 * claro vê um flash escuro a cada navegação — e um flash de tema é a categoria
 * de defeito que ninguém reporta e todo mundo nota.
 *
 * Este arquivo é a metade "boot" da preferência; a metade "produto" (ler,
 * gravar, alternar, observar) é `src/lib/tema.ts`, e as duas compartilham a
 * chave e o default por CONTRATO — um teste em `src/lib/tema.test.ts` lê este
 * arquivo e reprova se os dois divergirem. Sem build: o `public/` do vite é
 * copiado como está, então aqui é ES5 puro, sem import e sem TypeScript.
 */
(function aplicarTemaSalvo() {
  var CHAVE = 'brabo.theme';
  var PADRAO = 'dark';

  var tema = PADRAO;
  try {
    var salvo = window.localStorage.getItem(CHAVE);
    // Só os dois valores conhecidos. Qualquer outra coisa — chave escrita à
    // mão, resto de uma versão antiga, `null` — cai no default em vez de virar
    // um `data-theme` que o CSS não conhece e que renderiza sem tema nenhum.
    if (salvo === 'dark' || salvo === 'light') tema = salvo;
  } catch (erro) {
    // localStorage pode lançar (modo privado, cookies de terceiros bloqueados,
    // iframe sem storage access). Tema é preferência, não função: falhar aqui
    // não pode derrubar o boot da app.
  }

  document.documentElement.setAttribute('data-theme', tema);
})();
