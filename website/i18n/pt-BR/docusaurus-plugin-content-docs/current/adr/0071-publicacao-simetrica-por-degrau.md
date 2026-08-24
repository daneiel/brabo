# ADR 0071 — Publicação simétrica por degrau, e uma raiz que escolhe

- **Status:** aceito
- **Data:** 2026-08-14
- **Estende:** [ADR 0034](0034-documentacao-publicada-por-degrau.md)

## Contexto

O [ADR 0034](0034-documentacao-publicada-por-degrau.md) estabeleceu que cada
permanente publica a própria documentação. O que ele deixou assimétrico foi o
endereço: `main` publicava na **raiz** (`/brabo/`) e só `qa` e `dev` tinham
sufixo (`/brabo/qa/`, `/brabo/dev/`).

A assimetria cobrava três preços, todos pagos por quem lia:

1. **A raiz não dizia que existiam outros degraus.** Os três sites não se
   enxergavam: quem caía em `/brabo/` não tinha como chegar em `/qa/`, e quem
   caía em `/dev/` pelo Google — antes do `noIndex` — não sabia que estava lendo
   a versão não validada.
2. **O caso especial contaminava o mecanismo.** Publicar na raiz apagando o que
   havia levaria `/dev/` e `/qa/` junto, então o workflow tinha um passo que
   rodava **só na `main`** para trazer os outros dois de volta para dentro da
   árvore. Um caminho diferente dos outros dois é um caminho que se exercita um
   terço das vezes.
3. **Não havia onde declarar a maturidade.** "Estável", "candidata" e "em
   desenvolvimento" eram conhecimento de quem já sabia.

## Decisão

### 1. Os três degraus em `/brabo/<branch>/`

`main`, `qa` e `dev` publicam simetricamente. O caso especial da `main` some, e
com ele o passo condicional do workflow.

### 2. A raiz é um índice gerado, não um redirecionamento

Redirecionar `/brabo/` para `/brabo/main/` seria mais simples e responderia
menos: a pergunta que leva alguém a olhar mais de um degrau é "a `qa` já tem o
que eu preciso?", e o redirecionamento engole essa pergunta.

`scripts/docs/landing.mjs` gera a página com os três, o selo de maturidade de
cada um e a **versão carimbada**, lida das tags do próprio repositório
(`vX.Y.Z` para `main`, `vX.Y.Z-<estagio>.N` para os outros — o formato do
`scripts/ci/tag-release.ts`).

Ela oferece **o que existe na árvore**, não uma lista fixa: um degrau ausente
não vira link, porque link que dá 404 é pior que ausência. E sai do índice de
busca com canônico apontando para `/main/` — a raiz é um índice, não conteúdo,
e indexada competiria com a documentação real.

### 3. Um `404.html` na raiz segura os links antigos

Mover a `main` quebraria **todo link profundo já salvo**: `/brabo/architecture`
deixaria de existir. O GitHub Pages serve o `404.html` da raiz para caminho
desconhecido, então ele reencaminha `/brabo/<algo>` para `/brabo/main/<algo>`.

Tem uma guarda que não é detalhe: um 404 **dentro** de um degrau (página que
realmente não existe) não pode ser reencaminhado de novo, senão o navegador
gira. Por isso o teste da guarda existe.

### 4. O degrau é declarado, não deduzido do caminho

Esta é a mudança que mais importa, e é invisível.

O site sabia se era produção comparando `BASE_URL === '/brabo/'`. Com os três em
subdiretório essa comparação passa a ser falsa **para a `main` também** — e o
efeito seria `noIndex: true` na documentação real: ela sairia do Google em
silêncio, com o CI verde, porque nada no build reprova por indexar de menos.

`DOCS_BRANCH` acompanha `DOCS_BASE_URL`, e `E_PRODUCAO` passa a ser
`DOCS_BRANCH === 'main'`. Deduzir ambiente de uma string de caminho é o tipo de
acoplamento que só aparece quando o caminho muda.

### 5. A árvore é montada, para os três

O passo que existia só na `main` vira o caminho único: os outros dois degraus
vêm da `gh-pages` atual, o degrau do push vem do build novo, a raiz é gerada, e
publica-se o conjunto com `keep_files: false`.

Não é `keep_files: true`: aquilo nunca remove nada, e página apagada do
repositório ficaria publicada para sempre. Montar preserva o que deve continuar
e remove o que não deve — inclusive, de graça, **a migração**: os arquivos que a
`main` deixou na raiz no layout antigo não estão na árvore montada, então o
primeiro push os leva embora. Não há limpeza manual da `gh-pages` a fazer.

### 6. A transição semeia `/main/` da raiz antiga

No layout antigo não existe `gh-pages:main`. Sem tratamento, o primeiro push de
`dev` ou `qa` deixaria `/brabo/main/` inexistente — e como o `404.html`
reencaminha justamente para lá, **todo link antigo apontaria para um 404** até a
próxima promoção até `main`, que pode demorar dias.

A raiz publicada hoje é, literalmente, o build da `main`. Então ela semeia
`/main/` na primeira montagem, e o site nunca fica sem a documentação estável.
Na publicação seguinte de `main` o caminho normal assume e este bloco não roda
mais.

### 7. O seletor usa `href` absoluto

O link atravessa sites com `baseUrl` diferente. Relativo resolveria dentro do
próprio degrau — `/brabo/dev/main/`, que não existe.

## Consequências

- **O About do repositório continua apontando para a raiz**, que agora é o
  índice. Nenhuma mudança de configuração foi necessária — e é bom que não
  fosse: nenhum token do CI tem escopo de administrar o repositório
  (`BRABO_BOT_TOKEN` é `repo` + `workflow`), então automatizar isso pediria
  credencial nova.
- **`/brabo/` deixa de ser a documentação** e passa a ser um clique a mais para
  quem quer só a estável. É o preço da escolha registrada aqui: mostrar os três.
- O `README.md` e `apps/web/src/routes/AuthLayout.tsx` continuam apontando para
  a raiz, que é o ponto de entrada.
- A publicação continua sendo push direto na `gh-pages` — a terceira exceção à
  porta única de PR, já documentada na política de branches. Este ADR **depende
  mais** disso que o 0034: montar a árvore inteira é exatamente o que
  `actions/deploy-pages` não sabe fazer.

## Alternativas descartadas

- **Redirecionar a raiz para `/main/`**: mais simples, e responde menos (item 2).
- **Manter `main` na raiz e só `qa`/`dev` com sufixo**: é o estado atual, e
  mantém o caso especial que se exercita um terço das vezes.
- **Versionamento do Docusaurus (`docs:version`)**: eixo diferente. Degrau da
  esteira é maturidade do MESMO conteúdo; versão de documentação é conteúdo
  congelado. O `CONTRIBUTING.md` já registra que numa `0.x` versionar adiciona
  manutenção sem dar nada em troca.
- **Publicar `main` na raiz E em `/main/`**: manteria os links antigos sem
  `404.html`, ao custo de duplicar o site inteiro a cada publicação e de ter
  dois endereços indexáveis com o mesmo conteúdo.
