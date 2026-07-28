# 0034 — Documentação publicada por degrau, em subdiretório do Pages

## Contexto

A documentação só existia publicada da `main`. O `docs-deploy.yml` disparava em
`push` para `main`, construía o site e entregava um artefato ao
`actions/deploy-pages`.

Isso deixava um vão em toda a esteira: **entre um merge em `dev` e a promoção
final, ninguém consegue ler a documentação daquele estado** sem clonar o
repositório e rodar `pnpm docs:start`. E é justamente aí que ela é mais
necessária — em homologação, para conferir o que mudou; em `dev`, para revisar
um documento novo com o site aplicado, não com o Markdown cru do diff.

O `docs-check.yml` já constrói o site em todo PR, mas ele **descarta o build**:
o veredito dele é "constrói sem link quebrado", nunca "está publicado em algum
lugar onde eu possa abrir".

Um segundo fato pesou na decisão. As **117 páginas de operação da referência de
API subiram quebradas** nas releases `v1.0.0` e `v1.0.1`, e ninguém viu por dois
meses de trabalho — porque a única forma de ver era abrir o site publicado, que
só existia depois de a mudança atravessar os três degraus. Publicar cada degrau
não é conforto: é encurtar a distância entre escrever e olhar.

## Decisão

Cada branch permanente publica no seu próprio lugar, no mesmo GitHub Pages:

| degrau | URL | indexado por buscador |
|---|---|---|
| `main` | `https://daneiel.github.io/brabo/` | ✅ |
| `qa` | `https://daneiel.github.io/brabo/qa/` | ❌ |
| `dev` | `https://daneiel.github.io/brabo/dev/` | ❌ |

A `main` **não muda de URL** — links existentes continuam valendo. Esse foi um
requisito, não uma consequência: quebrar a URL da documentação para ganhar
pré-visualização seria trocar o certo pelo conveniente.

### Consequências que precisam estar escritas

#### 1. A publicação passa a ser push direto, e essa é a terceira exceção

O `actions/deploy-pages` publica **um artefato como o site inteiro** e não sabe
atualizar parte de uma árvore. Com ele, publicar `dev` num subdiretório
significaria reconstruir os três degraus a cada push de qualquer um. Então a
publicação passa a `peaceiris/actions-gh-pages`, que **commita na branch
`gh-pages`**.

Isso abre a **terceira exceção** à porta única de PR, ao lado das tags e do
`.release/gate.json` — e ela está registrada na
[política de branches](../explanation/branching-policy.md#push-direto-é-bloqueado),
porque exceção que não está documentada vira precedente.

O que torna esta exceção diferente das outras duas, e mais fácil de aceitar: a
`gh-pages` **não é branch de código**. Nada nela é fonte, tudo é gerado a partir
de `docs/` e `website/`, e apagá-la inteira não perde informação — o próximo push
a reconstrói. O `git log` dela é o registro de cada publicação, com data e sha de
origem.

#### 2. A `main` monta a árvore em vez de preservar por omissão

A `main` publica na raiz. Publicar na raiz apagando o que havia levaria `/dev/` e
`/qa/` junto: cada deploy de produção derrubaria os outros dois degraus até o
próximo push deles.

A saída **não** é `keep_files: true`. Aquilo nunca remove nada, e uma página
apagada do repositório ficaria publicada para sempre — o problema de órfão que o
gerador da referência de API já resolve com `clean-api-docs`. Trocar "some o que
não devia" por "fica o que não devia" não é conserto.

Então a árvore é **montada**: antes de publicar, o job da `main` traz `/dev/` e
`/qa/` da `gh-pages` para dentro do build e publica o conjunto completo com
`keep_files: false`. Aí a semântica fica exata — **o que não está na árvore nova
não deveria estar publicado**.

#### 3. `baseUrl` deixa de ser constante

O `baseUrl` entra em toda URL de asset que o Docusaurus emite. Um site servido de
`/brabo/dev/` com `baseUrl: '/brabo/'` carrega o HTML e nada mais: CSS, JS e busca
dão 404, e a página parece *quebrada sem erro*. Por isso `baseUrl` passa a vir de
`DOCS_BASE_URL`, com o valor de produção como default — `pnpm docs:build` sem
variável nenhuma continua produzindo exatamente o que sempre produziu.

#### 4. `noIndex` e a busca local se anulavam, e isso teve que ser descoberto

`dev` e `qa` são o mesmo conteúdo da produção em outro estágio de maturidade.
Indexados pelo Google, competiriam com a documentação real, e quem chegasse pela
busca leria a versão não validada sem perceber. Daí `noIndex: true` fora da
`main`.

**Só que o `@easyops-cn/docusaurus-search-local` descarta toda página que tenha
`<meta name="robots" content="noindex">`** (`parse.js`, comentário *"Unlisted
content"*) — exatamente o que o `noIndex` emite. O efeito, medido: índice de
**666 bytes com `documents: []`**, e a caixa de busca respondendo *"No results"*
para qualquer termo. Os degraus publicariam com a busca morta, e o sintoma não
apareceria em build nenhum.

A opção `forceIgnoreNoIndex: true` do plugin resolve, e a resolução vale ser
explicada porque parece contradição: **`noIndex` fala com buscador EXTERNO;
`forceIgnoreNoIndex` fala com o índice LOCAL.** Querer os degraus fora do Google
não é querer os degraus sem busca.

Medido nos três modos depois da correção: **2318 documentos indexados** em
produção, `dev` e `qa`, com o `meta robots` presente só nos dois últimos.

#### 5. "Por branch que passar" não precisou de mecanismo

`push` numa permanente só acontece por merge de PR, e o ruleset exige os checks
required antes do merge. **O gatilho de push já É o "passou"** — não existe
caminho em que este workflow publique código que não atravessou a esteira.
Registrar isso aqui evita que alguém acrescente depois uma verificação de
"os checks passaram?" que seria redundante e daria a impressão de que sem ela
haveria buraco.

#### 6. O gate de renderização roda antes de publicar

O `api-render-check.mjs` (ver
[documentation-workflow](../explanation/documentation-workflow.md)) roda no
`docs-deploy` além do `docs-check`. É o passo que **publica**: se a página não
renderiza, é melhor não publicar do que publicar quebrada. Foi a falta disso que
deixou duas releases saírem com a referência de API morta.

## Alternativas consideradas

**Artefato por execução, sem URL.** Cada degrau subiria o site como artifact do
Actions, baixável em zip. Zero exceção de push, zero mudança em Settings — e zero
utilidade para o caso de uso real, que é *abrir um link e olhar*. Baixar e
descompactar para revisar uma página é atrito suficiente para ninguém fazer.

**Preview por PR.** Mais útil na revisão que o site por branch, e o mesmo custo de
mecanismo. Não foi descartada por mérito: fica como possível complemento, e o
mecanismo desta ADR (subdiretório + `DOCS_BASE_URL`) é exatamente o que ela
precisaria. O que pesou é que o vão descrito no Contexto é *entre degraus*, não
dentro do PR — o PR já tem o `docs-check` construindo o site.

**Manter `actions/deploy-pages` e reconstruir os três degraus a cada push.** Sem
exceção de push, sem `gh-pages`. Mas cada push em `dev` reconstruiria `qa` e
`main` a partir de outras branches — três checkouts e três builds por publicação,
e um deploy de `dev` capaz de republicar `main` com conteúdo que ninguém pediu.
Acoplamento entre degraus é o oposto do que a esteira inteira existe para evitar.

## Consequências

- **Ação manual do usuário:** trocar a fonte do Pages em Settings de "GitHub
  Actions" para branch `gh-pages` / `root`. Está em
  [Rulesets](../reference/rulesets.md), com o resto do que é aplicação manual.
- A `gh-pages` **não entra** nos rulesets das permanentes: ela não é permanente, e
  o bot precisa empurrar nela.
- O `github-pages` environment deixa de ser usado pelo fluxo. Ele existe porque o
  Pages o cria, não porque o projeto o declarou — o `CLAUDE.md` mantém a regra de
  não criar Environments.
- O cache do Rspack passa a ser chaveado por degrau: o `baseUrl` entra no bundle,
  então o cache de `dev` não serve para `main`. Sem isso os três se invalidariam
  em rodízio e o cache viraria enfeite.
- Três degraus escrevendo na mesma `gh-pages` precisam de serialização: o
  `concurrency` do workflow passa a ser do repositório inteiro, não por branch.
