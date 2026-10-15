# ADR 0106 — Distribuição do `@brabo/runner` via `tsup` e `npm publish`, versão injetada só em CI

- **Status:** Aceito
- **Data:** 2026-08-22
- **Contexto:** backlog do [ADR 0104](0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md)
  ("distribuição do runner via `tsup` → pacote único + `npm publish
  @brabo/runner`"), desbloqueado pelo [ADR 0105](0105-personal-access-token-do-runner-escopado-por-construcao.md)
  (PAT — "nenhuma dependência restante")

## Contexto

`apps/runner/package.json` era `"private": true`, com `bin` apontando pra um
`.ts` cru (`./src/index.ts`) — só alcançável clonando o monorepo inteiro e
confiando no type-stripping nativo do Node 24 usado em dev. O backlog já
nomeava a saída literalmente: `tsup` produzindo um `dist/index.cjs` único,
publicado como `@brabo/runner`.

Esta é a PRIMEIRA vez que este repositório publica algo num registry externo
— confirmado por grep exaustivo antes de começar: zero menção a `NPM_TOKEN`,
`NODE_AUTH_TOKEN`, `registry.npmjs.org` ou `provenance` em todo o código.

## Decisão

**`tsup` empacota `src/index.ts` num `dist/index.cjs` único**
(`apps/runner/tsup.config.ts`), `format: cjs`, `target: node18` (o runtime
que `engines.node` do `package.json` promete — eixo diferente do `ES2023` do
`tsconfig.json`, que só serve o `tsc --noEmit` de dev). `node-pty` é o único
`external`: é binding NATIVO (compila via node-gyp no postinstall, o mesmo
binding que o VS Code usa — `pnpm-workspace.yaml` já o allowlista
explicitamente em `allowBuilds`) e não pode ser embutido num arquivo JS —
continua `require('node-pty')` em runtime, resolvido pelo `node_modules` de
quem instalou o pacote. `phoenix` (puro JS) é embutido automaticamente por
não estar em `external`, e por isso saiu de `dependencies` pra
`devDependencies` — o consumidor não precisa mais instalá-lo à parte. O nome
`dist/index.cjs` sai de graça de `format: ['cjs']` + `"type": "module"`
(já existente no `package.json`) — é assim que tsup decide a extensão, sem
precisar de `outExtension`. Shebang (`#!/usr/bin/env node`) e o bit de
execução (755) do artefato são tratados automaticamente pelo tsup, que
detecta o shebang na entrada e replica no output.

### O achado real: a guarda de auto-run estava quebrada pro caso que esta onda existe pra habilitar

`apps/runner/src/index.ts` decidia rodar `main()` comparando
`process.argv[1]?.endsWith('index.ts') || .endsWith('brabo-runner')` — um
teste por SUFIXO DE NOME DE ARQUIVO, frágil a qualquer rename por bundling.
A correção óbvia (`import.meta.url === pathToFileURL(process.argv[1]).href`,
o idioma padrão ESM pra "sou eu o módulo de entrada?") foi TESTADA
empiricamente com um processo Node real e um symlink antes de entrar no
código — e ela também está quebrada, pelo motivo oposto do esperado:

`process.argv[1]` **nunca** é resolvido por realpath pelo Node — é o caminho
literal que o SO usou pra invocar, só tornado absoluto. `import.meta.url`
(e o shim que o tsup gera pra `import.meta.url` em build cjs, baseado em
`__filename`) **sempre** é resolvido por realpath pelo carregador de
módulos. `npm install -g` cria exatamente essa assimetria: um symlink em
`node_modules/.bin/brabo-runner` apontando pro `dist/index.cjs` real dentro
de `node_modules/@brabo/runner/`. Rodar o CLI pelo `bin` instalado — o
CAMINHO PRINCIPAL que esta onda inteira existe pra habilitar — faria a
comparação dar `false` sempre, e `main()` nunca seria chamado. Um bug
silencioso: nenhum smoke que só rode `node dist/index.cjs` diretamente (sem
passar pelo symlink) o pegaria.

A correção final aplica `realpathSync` em `process.argv[1]` antes de
comparar:

```ts
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const invocadoDiretamente =
  !!process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
```

Verificado (com processo Node real) nos quatro casos: dev
(`node src/index.ts`), `node dist/index.cjs` direto, via symlink (o caso que
estava quebrado) e nunca dispara quando `import`ado por um teste. No
Windows, o shim `.cmd`/`.ps1` do npm já invoca `node <caminho real>` sem
symlink algum — `realpathSync` vira no-op ali, sem regressão.

### Versão: injetada só em CI, nunca commitada

A versão do repo inteiro é calculada e vive só na tag git (`vX.Y.Z`, Fase 6)
— nunca em `package.json`. `npm publish`, porém, EXIGE que `package.json`
carregue a versão sendo publicada. A saída: `npm pkg set version=<versão-da-tag>`
roda dentro do checkout DESCARTÁVEL do workflow de publicação, nunca
commitado de volta ao repositório — mesma filosofia de "a tag é a única
fonte de verdade", só satisfazendo uma exigência mecânica do próprio `npm
publish`.

### O `latest` do npm pode retroceder — mitigado antes de acontecer

Este repositório já tem **seis tags finais órfãs** (`v0.2.0`, `v0.3.0`,
`v0.3.1`, `v1.0.0`, `v1.0.1`, `v1.1.0` — nunca publicadas, documentado em
`docs/reference/rulesets.md`), e o `workflow_dispatch` de republicação
manual existe precisamente pra reparar esse tipo de buraco (mesmo padrão de
`release.yml`). `npm publish` move a dist-tag `latest` pro que acabou de
publicar por padrão, SEM checar ordem semver — republicar uma tag órfã
antiga depois de uma versão mais nova já estar publicada moveria `latest`
pra trás em silêncio, e `npm install -g @brabo/runner` passaria a instalar
código velho. `publish-runner.yml` compara a versão-alvo com
`npm view @brabo/runner version` antes de publicar: se for `>=` o `latest`
atual, publica normal; senão, publica com uma dist-tag própria
(`--tag antiga-<versão>`), nunca tocando `latest`.

### Workflow próprio, não um passo a mais em `release.yml`

`publish-runner.yml` é disparado pelo MESMO evento de `release.yml`
(`push: tags: 'v[0-9]+.[0-9]+.[0-9]+'`) mas é um arquivo separado — mesma
disciplina já registrada no ADR 0030 pro `tag-release.yml`: "workflow
PRÓPRIO disparado pela tag... nada a religar aqui". Publicar imagem Docker e
publicar pacote npm são dois produtos independentes do mesmo evento, cada um
com seu próprio modo de falhar; bolar isto dentro de `release.yml` faria uma
falha de npm derrubar (ou mascarar) a GitHub Release, ou vice-versa. Os dois
rodam em PARALELO, sem `needs:` — não há dependência real entre eles.

**Sem `NODE_AUTH_TOKEN` sozinho.** `actions/setup-node` só escreve o
`~/.npmrc` que faz `NODE_AUTH_TOKEN` autenticar de verdade quando o step
recebe `registry-url` (e `scope`) — nenhum workflow deste repo jamais
precisou disso, então nenhum já fazia. Sem o secret `NPM_TOKEN` configurado,
o workflow AVISA (`::warning::`) e PULA — nunca falha —, mesmo padrão
`TEM_PAT` já usado em `tag-release.yml`/`release.yml` (`secrets.*` não pode
ir direto num `if:`).

## Fechamento do buraco de cobertura em `ci.yml`

`apps/runner` nunca rodou teste nenhum no job `Testes TS (api + web)`
(confirmado lendo o arquivo por inteiro) — buraco pré-existente, mais grave
agora que este código é distribuído a terceiros. Quatro steps novos ali
(`test`, `typecheck`, `build`, `smoke`), sem renomear o job — o nome do job
**é** a identidade do check required no GitHub (`docs/reference/rulesets.md`
documenta isso explicitamente), e renomeá-lo apagaria um check required que
nunca mais rodaria.

`apps/runner/scripts/smoke-dist.mjs` é o único teste que exercita o
ARTEFATO EMPACOTADO de ponta a ponta — os testes unitários só chamam
funções exportadas de `src/`, nunca o `dist/index.cjs` publicado. Ele
confere existência + bit de execução, e roda o binário de DUAS formas: exec
direto (exercita o shebang de verdade — `node dist/index.cjs` sozinho NUNCA
testaria isso) e via `node dist/index.cjs` explícito. Efeito colateral que
vale registrar: como `pty.ts` importa `node-pty` no topo do módulo (hoisted
antes de qualquer parsing de argumento), este smoke também prova que o
binding nativo resolve e carrega no ambiente do CI — não é só teste de
bundling, é um smoke real do native addon. Reusado por `ci.yml` (todo PR,
pra pegar regressão de bundling ANTES do merge) e por `publish-runner.yml`
(direto antes de publicar, cinto e suspensório — nunca confiar num build de
PR antigo).

## Consequências

- Desbloqueia `npm install -g @brabo/runner` como caminho de distribuição
  real — o item que fecha a última pendência do backlog do ADR 0104.
- **Pendência operacional, fora do alcance deste PR**: o dono do produto
  precisa criar/confirmar o escopo `@brabo` no npmjs.com, gerar um npm
  Automation Token e configurar o secret `NPM_TOKEN` no repositório. Até lá,
  `publish-runner.yml` roda e avisa, sem publicar de verdade e sem falhar o
  workflow — mesmo padrão do `BRABO_BOT_TOKEN` ausente em `release.yml`.
- Branch de entrega é `breaking/` — não `feature/` — porque a publicação
  real exige essa ação de operador antes de funcionar de ponta a ponta,
  mesmo padrão do login social (ADR 0084) e da lição já registrada em
  CLAUDE.md sobre um secret de OAuth obrigatório que nasceu (errado) em
  `bugfix/`. Isso bump MAJOR a versão do repositório inteiro (a política é
  repo-wide, não por workspace) — consequência aceita conscientemente.
- Sem RN nova em `docs/business-rules.md` — isto é infraestrutura de
  distribuição, não regra de negócio do produto. Sem entrada nova em
  `docs/gates.yml` — não é um gate de decisão do produto, é mecanismo de
  CI. As duas ausências são decisão declarada.
- `docs/reference/rulesets.md` não muda — a tabela "Checks obrigatórios" é
  escopada a checks de workflow disparado por `pull_request`, e
  `publish-runner.yml` dispara só em push de tag final/`workflow_dispatch`.
- Fora do escopo, por decisão declarada: binário standalone
  (`pkg`/`bun build --compile`, item separado do backlog, custo maior, sem
  gatilho definido); exclusividade do runner por `{project_id, machine_id}`
  (adiada); revogação de PAT de outro usuário por `maintainer` (fora de
  escopo desde o ADR 0105); `guard.ts` best-effort (invariante reafirmado,
  não uma lacuna).
